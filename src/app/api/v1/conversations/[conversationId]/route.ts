import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertTenantAccess } from "@/lib/tenant";

export async function GET(
  _request: Request,
  { params }: { params: { conversationId: string } }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      turns: {
        orderBy: { timestamp: "asc" },
        include: {
          turnScores: true,
        },
      },
      arcScores: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      flags: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const tenantError = assertTenantAccess(
    conversation.clientId,
    session.user.clientId
  );
  if (tenantError) return tenantError;

  return NextResponse.json({ conversation });
}
