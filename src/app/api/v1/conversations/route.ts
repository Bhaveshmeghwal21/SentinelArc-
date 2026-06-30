import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTenantFilter } from "@/lib/tenant";

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const filter = getTenantFilter(session.user.clientId);

  const conversations = await prisma.conversation.findMany({
    where: filter,
    select: {
      id: true,
      externalId: true,
      endUserId: true,
      startedAt: true,
      lastActiveAt: true,
      _count: {
        select: { turns: true },
      },
    },
    orderBy: { lastActiveAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ conversations });
}
