import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const QuerySchema = z.object({
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  category: z.string().optional(),
  status: z.enum(["PENDING", "IN_REVIEW", "RESOLVED"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!hasRole(session.user.role, "REVIEWER")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const rawParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    rawParams[key] = value;
  });

  const parseResult = QuerySchema.safeParse(rawParams);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parseResult.error.issues },
      { status: 422 }
    );
  }

  const { severity, category, status, dateFrom, dateTo, page, limit } = parseResult.data;
  const clientId = session.user.clientId;

  // Build where clause with tenant isolation
  const where: Record<string, unknown> = { clientId };

  if (status) {
    where.status = status;
  }

  if (severity || category || dateFrom || dateTo) {
    const flagWhere: Record<string, unknown> = {};
    if (severity) flagWhere.severity = severity;
    if (category) flagWhere.category = category;
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo);
      flagWhere.createdAt = createdAt;
    }
    where.flag = flagWhere;
  }

  const [items, total] = await Promise.all([
    prisma.reviewItem.findMany({
      where,
      include: {
        flag: {
          include: {
            turn: { select: { content: true } },
          },
        },
        assignee: { select: { name: true, email: true } },
      },
      orderBy: [
        { flag: { severity: "desc" } },
        { createdAt: "asc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reviewItem.count({ where }),
  ]);

  const responseItems = items.map((item) => ({
    id: item.id,
    severity: item.flag.severity,
    category: item.flag.category,
    snippet: item.flag.turn?.content?.slice(0, 100) ?? "",
    flaggedAt: item.createdAt.toISOString(),
    assignee: item.assignee?.name ?? item.assignee?.email ?? null,
    status: item.status,
  }));

  return NextResponse.json({
    items: responseItems,
    total,
    page,
    limit,
  });
}
