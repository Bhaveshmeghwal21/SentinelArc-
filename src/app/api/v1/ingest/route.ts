import { NextResponse } from "next/server";
import { z } from "zod";
import { type Prisma } from "@prisma/client";
import { validateApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { enqueueScoringJob } from "@/lib/queue";

const TurnSchema = z.object({
  role: z.enum(["user", "companion"]),
  content: z.string().min(1).max(50000),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

const IngestRequestSchema = z.object({
  conversation_id: z.string().min(1).max(255),
  end_user_id: z.string().min(1).max(255),
  turn: TurnSchema,
});

export async function POST(request: Request): Promise<NextResponse> {
  // Authenticate via API key
  const apiKey = request.headers.get("X-API-Key");
  const keyContext = await validateApiKey(apiKey);

  if (!keyContext) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parseResult = IngestRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parseResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 }
    );
  }

  const { conversation_id, end_user_id, turn } = parseResult.data;
  const { clientId } = keyContext;

  // Upsert conversation
  const conversation = await prisma.conversation.upsert({
    where: {
      clientId_externalId: {
        clientId,
        externalId: conversation_id,
      },
    },
    update: {
      lastActiveAt: new Date(),
    },
    create: {
      externalId: conversation_id,
      endUserId: end_user_id,
      clientId,
    },
  });

  // Create conversation turn
  const conversationTurn = await prisma.conversationTurn.create({
    data: {
      conversationId: conversation.id,
      role: turn.role,
      content: turn.content,
      timestamp: new Date(turn.timestamp),
      metadata: (turn.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });

  // Enqueue scoring job
  await enqueueScoringJob({
    type: "SCORE_TURN",
    turnId: conversationTurn.id,
    conversationId: conversation.id,
    clientId,
  });

  return NextResponse.json(
    {
      turn_id: conversationTurn.id,
      conversation_id: conversation.id,
      status: "accepted",
    },
    {
      status: 202,
      headers: {
        "X-RateLimit-Limit": "1000",
        "X-RateLimit-Remaining": "999",
        "X-RateLimit-Reset": String(
          Math.floor(Date.now() / 1000) + 3600
        ),
      },
    }
  );
}
