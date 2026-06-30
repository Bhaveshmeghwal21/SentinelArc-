import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { auditLogger } from "@/lib/audit/instance";
import { createLabeledDataEntry } from "@/lib/labeled-dataset/pipeline";

const DecisionSchema = z.object({
  outcome: z.enum(["TRUE_POSITIVE", "FALSE_POSITIVE", "ESCALATE"]),
  notes: z.string().optional().default(""),
});

export async function POST(
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

  const parseResult = DecisionSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parseResult.error.issues },
      { status: 422 }
    );
  }

  const { outcome, notes } = parseResult.data;

  // Check review item exists and belongs to this client
  const reviewItem = await prisma.reviewItem.findUnique({
    where: { id: params.reviewId },
    include: {
      flag: {
        include: {
          turn: {
            include: {
              turnScores: { take: 1, orderBy: { createdAt: "desc" } },
              conversation: {
                include: {
                  turns: {
                    orderBy: { timestamp: "asc" },
                    take: 10,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!reviewItem) {
    return NextResponse.json(
      { error: "Review item not found" },
      { status: 404 }
    );
  }

  if (reviewItem.clientId !== session.user.clientId) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 }
    );
  }

  // Create the decision
  const decision = await prisma.reviewDecision.create({
    data: {
      reviewItemId: params.reviewId,
      reviewerId: session.user.id,
      outcome,
      notes,
    },
  });

  // Update review item status to RESOLVED
  await prisma.reviewItem.update({
    where: { id: params.reviewId },
    data: { status: "RESOLVED" },
  });

  // Create labeled data entry for ML training pipeline
  const turnContent = reviewItem.flag.turn?.content ?? "";
  const turnScore = reviewItem.flag.turn?.turnScores?.[0];
  const arcContext = reviewItem.flag.turn?.conversation?.turns?.map((t) => ({
    role: t.role,
    content: t.content,
    timestamp: t.timestamp.toISOString(),
  })) ?? [];

  await createLabeledDataEntry({
    clientId: session.user.clientId,
    turnContent,
    scoresAtFlag: {
      selfHarm: turnScore?.selfHarm ?? 0,
      sexualContent: turnScore?.sexualContent ?? 0,
      ageSignal: turnScore?.ageSignal ?? 0,
      emotionalIntensity: turnScore?.emotionalIntensity ?? 0,
      dependencyLanguage: turnScore?.dependencyLanguage ?? 0,
      romanticEscalation: turnScore?.romanticEscalation ?? 0,
    },
    arcContext,
    reviewerDecision: outcome,
    reviewerNotes: notes,
    version: 1,
  });

  // Audit log the decision
  await auditLogger.log({
    clientId: session.user.clientId,
    actor: session.user.id,
    action: "review.decided",
    resource: `review:${params.reviewId}`,
    payload: {
      outcome,
      notes,
      decisionId: decision.id,
    },
  });

  return NextResponse.json({
    id: decision.id,
    reviewItemId: params.reviewId,
    outcome,
    status: "RESOLVED",
  });
}
