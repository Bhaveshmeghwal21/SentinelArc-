import { POST } from "@/app/api/v1/ingest/route";

// Mock dependencies
jest.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      upsert: jest.fn(),
    },
    conversationTurn: {
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/api-keys", () => ({
  validateApiKey: jest.fn(),
}));

jest.mock("@/lib/queue", () => ({
  enqueueScoringJob: jest.fn(),
}));

jest.mock("@/lib/billing/usage-tracker", () => ({
  trackTurnUsage: jest.fn().mockResolvedValue({ usage: {}, alert: null }),
}));

import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-keys";
import { enqueueScoringJob } from "@/lib/queue";
import { trackTurnUsage } from "@/lib/billing/usage-tracker";

const mockValidateApiKey = validateApiKey as jest.MockedFunction<
  typeof validateApiKey
>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockEnqueueScoringJob = enqueueScoringJob as jest.MockedFunction<
  typeof enqueueScoringJob
>;
const mockTrackTurnUsage = trackTurnUsage as jest.MockedFunction<
  typeof trackTurnUsage
>;

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/ingest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Authentication", () => {
    it("should return 401 when X-API-Key header is missing", async () => {
      mockValidateApiKey.mockResolvedValue(null);

      const request = createRequest({
        conversation_id: "conv-1",
        end_user_id: "user-1",
        turn: {
          role: "user",
          content: "Hello",
          timestamp: "2024-01-01T00:00:00Z",
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBe("Invalid or missing API key");
    });

    it("should return 401 when API key is invalid", async () => {
      mockValidateApiKey.mockResolvedValue(null);

      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "invalid_key" }
      );

      const response = await POST(request);
      expect(response.status).toBe(401);
    });
  });

  describe("Validation", () => {
    beforeEach(() => {
      mockValidateApiKey.mockResolvedValue({
        clientId: "client-1",
        apiKeyId: "key-1",
      });
    });

    it("should return 400 for invalid JSON", async () => {
      const request = new Request("http://localhost/api/v1/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "sa_live_validkey",
        },
        body: "not json",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe("Invalid JSON body");
    });

    it("should return 422 for missing conversation_id", async () => {
      const request = createRequest(
        {
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.error).toBe("Validation failed");
    });

    it("should return 422 for missing end_user_id", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(422);
    });

    it("should return 422 for invalid turn role", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "admin",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(422);
    });

    it("should return 422 for empty content", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(422);
    });

    it("should return 422 for invalid timestamp format", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "not-a-date",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(422);
    });

    it("should return 422 for missing turn object", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(422);
    });
  });

  describe("Successful Ingestion", () => {
    const now = new Date();

    beforeEach(() => {
      mockValidateApiKey.mockResolvedValue({
        clientId: "client-1",
        apiKeyId: "key-1",
      });
      (mockPrisma.conversation.upsert as jest.Mock).mockResolvedValue({
        id: "internal-conv-1",
        externalId: "conv-1",
        endUserId: "user-1",
        clientId: "client-1",
        createdAt: now,
        lastActiveAt: now,
      });
      (mockPrisma.conversationTurn.create as jest.Mock).mockResolvedValue({
        id: "turn-1",
        conversationId: "internal-conv-1",
        role: "user",
        content: "Hello",
        timestamp: new Date("2024-01-01T00:00:00Z"),
      });
      mockEnqueueScoringJob.mockResolvedValue("job-1");
      mockTrackTurnUsage.mockResolvedValue({ usage: {} as any, alert: null });
    });

    it("should return 202 with turn_id for valid request", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello there",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(202);

      const data = await response.json();
      expect(data.turn_id).toBe("turn-1");
      expect(data.conversation_id).toBe("internal-conv-1");
      expect(data.status).toBe("accepted");
    });

    it("should not include misleading rate-limit headers", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.headers.get("X-RateLimit-Limit")).toBeNull();
      expect(response.headers.get("X-RateLimit-Remaining")).toBeNull();
      expect(response.headers.get("X-RateLimit-Reset")).toBeNull();
    });

    it("should upsert the conversation with correct client_id", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      await POST(request);

      expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId_externalId: {
              clientId: "client-1",
              externalId: "conv-1",
            },
          },
        })
      );
    });

    it("should enqueue a scoring job after ingestion", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      await POST(request);

      expect(mockEnqueueScoringJob).toHaveBeenCalledWith({
        type: "SCORE_TURN",
        turnId: "turn-1",
        conversationId: "internal-conv-1",
        clientId: "client-1",
      });
    });

    it("should accept optional metadata in turn", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "companion",
            content: "How can I help?",
            timestamp: "2024-01-01T00:00:01Z",
            metadata: { platform: "ios", version: "1.2.3" },
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    it("should call trackTurnUsage for billing after ingestion", async () => {
      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello there",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      await POST(request);

      expect(mockTrackTurnUsage).toHaveBeenCalledWith(
        "client-1",
        expect.any(Boolean)
      );
    });

    it("should detect new conversation for usage tracking", async () => {
      // When createdAt === lastActiveAt, it is a new conversation
      const createdTime = new Date("2024-01-01T00:00:00Z");
      (mockPrisma.conversation.upsert as jest.Mock).mockResolvedValue({
        id: "internal-conv-1",
        externalId: "conv-1",
        endUserId: "user-1",
        clientId: "client-1",
        createdAt: createdTime,
        lastActiveAt: createdTime,
      });

      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      await POST(request);

      expect(mockTrackTurnUsage).toHaveBeenCalledWith("client-1", true);
    });

    it("should detect existing conversation for usage tracking", async () => {
      // When lastActiveAt !== createdAt, it is an existing conversation
      (mockPrisma.conversation.upsert as jest.Mock).mockResolvedValue({
        id: "internal-conv-1",
        externalId: "conv-1",
        endUserId: "user-1",
        clientId: "client-1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        lastActiveAt: new Date("2024-01-02T00:00:00Z"),
      });

      const request = createRequest(
        {
          conversation_id: "conv-1",
          end_user_id: "user-1",
          turn: {
            role: "user",
            content: "Hello again",
            timestamp: "2024-01-02T00:00:00Z",
          },
        },
        { "X-API-Key": "sa_live_validkey" }
      );

      await POST(request);

      expect(mockTrackTurnUsage).toHaveBeenCalledWith("client-1", false);
    });
  });
});
