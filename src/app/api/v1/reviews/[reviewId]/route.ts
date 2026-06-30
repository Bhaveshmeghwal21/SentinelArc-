import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { auditLogger } from "@/lib/audit/instance";

const PatchSchema = z.object({
  status: z.enum(["PENDING", "IN_REVIEW", "RESOLVED"]).optional(),
  assigneeId: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: { reviewId: string } }
): Promise<NextResponse> {
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

  const reviewItem = await prisma.reviewItem.findUnique({
    where: { id: params.reviewId },
    include: {
      flag: {
        include: {
          turn: {
            include: {
              turnScores: { take: 1, orderBy: { createdAt: "desc" } },
            },
          },
          conversation: {
            include: {
              turns: { orderBy: { timestamp: "asc" } },
              arcScores: { take: 1, orderBy: { createdAt: "desc" } },
            },
          },
        },
      },
      assignee: { select: { name: true, email: true, id: true } },
    },
  });

  if (!reviewItem) {
    return NextResponse.json(
      { error: "Review item not found" },
      { status: 404 }
    );
  }

  // Tenant isolation check
  if (reviewItem.clientId !== session.user.clientId) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 }
    );
  }

  const turnScore = reviewItem.flag.turn?.turnScores?.[0];
  const arcScore = reviewItem.flag.conversation.arcScores?.[0] ?? null;

  const response = {
    id: reviewItem.id,
    status: reviewItem.status,
    severity: reviewItem.flag.severity,
    category: reviewItem.flag.category,
    flagMessage: reviewItem.flag.message ?? "",
    scores: {
      selfHarm: turnScore?.selfHarm ?? 0,
      sexualContent: turnScore?.sexualContent ?? 0,
      ageSignal: turnScore?.ageSignal ?? 0,
      emotionalIntensity: turnScore?.emotionalIntensity ?? 0,
      dependencyLanguage: turnScore?.dependencyLanguage ?? 0,
      romanticEscalation: turnScore?.romanticEscalation ?? 0,
    },
    arcScores: arcScore
      ? {
          selfHarm: arcScore.selfHarm,
          sexualContent: arcScore.sexualContent,
          ageSignal: arcScore.ageSignal,
          emotionalIntensity: arcScore.emotionalIntensity,
          dependencyLanguage: arcScore.dependencyLanguage,
          romanticEscalation: arcScore.romanticEscalation,
          trendDirection: arcScore.trendDirection,
        }
      : null,
    conversationTurns: reviewItem.flag.conversation.turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      timestamp: turn.timestamp.toISOString(),
      isFlagged: turn.id === reviewItem.flag.turnId,
    })),
    assignee: reviewItem.assignee?.name ?? reviewItem.assignee?.email ?? null,
    triggeredRules: [reviewItem.flag.category],
    suggestedAction:
      reviewItem.flag.severity === "CRITICAL"
        ? "Immediate escalation recommended"
        : reviewItem.flag.severity === "HIGH"
        ? "Urgent review required"
        : "Standard review",
  };

  return NextResponse.json(response);
}

export async function PATCH(
  request: Request,
  { params }: { params: { reviewId: string } }
): Promise<NextResponse> {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parseResult = PatchSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parseResult.error.issues },
      { status: 422 }
    );
  }

  // Check ownership
  const existing = await prisma.reviewItem.findUnique({
    where: { id: params.reviewId },
    select: { clientId: true },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Review item not found" },
      { status: 404 }
    );
  }

  if (existing.clientId !== session.user.clientId) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (parseResult.data.status) updateData.status = parseResult.data.status;
  if (parseResult.data.assigneeId) updateData.assigneeId = parseResult.data.assigneeId;

  const updated = await prisma.reviewItem.update({
    where: { id: params.reviewId },
    data: updateData,
  });

  // Audit log
  await auditLogger.log({
    clientId: session.user.clientId,
    actor: session.user.id,
    action: "review.updated",
    resource: `review:${params.reviewId}`,
    payload: { changes: parseResult.data },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    assigneeId: updated.assigneeId,
  });
}
