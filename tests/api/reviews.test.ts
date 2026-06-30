import { GET } from "@/app/api/v1/reviews/route";
import { GET as GET_DETAIL, PATCH } from "@/app/api/v1/reviews/[reviewId]/route";
import { POST as POST_DECIDE } from "@/app/api/v1/reviews/[reviewId]/decide/route";

// Mock dependencies
jest.mock("@/lib/prisma", () => ({
  prisma: {
    reviewItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    reviewDecision: {
      create: jest.fn(),
    },
    labeledDataEntry: {
      create: jest.fn(),
    },
    auditLogEntry: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/audit/instance", () => ({
  auditLogger: {
    log: jest.fn().mockResolvedValue({
      id: "audit-1",
      clientId: "client-1",
      actor: "user-1",
      action: "review.decided",
      resource: "review:review-1",
      payload: {},
      timestamp: new Date(),
      previousHash: "GENESIS",
      entryHash: "hash-1",
    }),
  },
}));

jest.mock("@/lib/labeled-dataset/pipeline", () => ({
  createLabeledDataEntry: jest.fn().mockResolvedValue({ id: "labeled-1" }),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { auditLogger } from "@/lib/audit/instance";
import { createLabeledDataEntry } from "@/lib/labeled-dataset/pipeline";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockAuditLogger = auditLogger as jest.Mocked<typeof auditLogger>;
const mockCreateLabeledDataEntry = createLabeledDataEntry as jest.MockedFunction<
  typeof createLabeledDataEntry
>;

function createRequest(url: string, options?: RequestInit) {
  return new Request(url, {
    method: "GET",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
}

describe("GET /api/v1/reviews", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("RBAC enforcement", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest("http://localhost/api/v1/reviews");
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Authentication required");
    });

    it("should return 403 when user lacks REVIEWER role", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "test@test.com", role: "VIEWER", clientId: "client-1" },
        expires: "",
      });

      const request = createRequest("http://localhost/api/v1/reviews");
      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Insufficient permissions");
    });

    it("should allow REVIEWER role to access", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "test@test.com", role: "REVIEWER", clientId: "client-1" },
        expires: "",
      });
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.reviewItem.count as jest.Mock).mockResolvedValue(0);

      const request = createRequest("http://localhost/api/v1/reviews");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("should allow ADMIN role to access", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "admin@test.com", role: "ADMIN", clientId: "client-1" },
        expires: "",
      });
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.reviewItem.count as jest.Mock).mockResolvedValue(0);

      const request = createRequest("http://localhost/api/v1/reviews");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Filtering and response", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "test@test.com", role: "REVIEWER", clientId: "client-1" },
        expires: "",
      });
    });

    it("should return review items with correct structure", async () => {
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([
        {
          id: "review-1",
          status: "PENDING",
          createdAt: new Date("2024-01-15T00:00:00Z"),
          flag: {
            severity: "HIGH",
            category: "self_harm",
            turn: { content: "I feel terrible and want to end it all" },
          },
          assignee: { name: "John Doe", email: "john@test.com" },
        },
      ]);
      (mockPrisma.reviewItem.count as jest.Mock).mockResolvedValue(1);

      const request = createRequest("http://localhost/api/v1/reviews");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0]).toEqual({
        id: "review-1",
        severity: "HIGH",
        category: "self_harm",
        snippet: "I feel terrible and want to end it all",
        flaggedAt: "2024-01-15T00:00:00.000Z",
        assignee: "John Doe",
        status: "PENDING",
      });
      expect(data.total).toBe(1);
    });

    it("should pass severity filter to query", async () => {
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.reviewItem.count as jest.Mock).mockResolvedValue(0);

      const request = createRequest(
        "http://localhost/api/v1/reviews?severity=CRITICAL"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPrisma.reviewItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clientId: "client-1",
            flag: expect.objectContaining({ severity: "CRITICAL" }),
          }),
        })
      );
    });

    it("should pass status filter to query", async () => {
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.reviewItem.count as jest.Mock).mockResolvedValue(0);

      const request = createRequest(
        "http://localhost/api/v1/reviews?status=PENDING"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPrisma.reviewItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clientId: "client-1",
            status: "PENDING",
          }),
        })
      );
    });
  });
});

describe("POST /api/v1/reviews/:reviewId/decide", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("RBAC enforcement", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest(
        "http://localhost/api/v1/reviews/review-1/decide",
        {
          method: "POST",
          body: JSON.stringify({ outcome: "TRUE_POSITIVE" }),
        }
      );
      const response = await POST_DECIDE(request, { params: { reviewId: "review-1" } });

      expect(response.status).toBe(401);
    });

    it("should return 403 for non-reviewer", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "test@test.com", role: "VIEWER", clientId: "client-1" },
        expires: "",
      });

      const request = createRequest(
        "http://localhost/api/v1/reviews/review-1/decide",
        {
          method: "POST",
          body: JSON.stringify({ outcome: "TRUE_POSITIVE" }),
        }
      );
      const response = await POST_DECIDE(request, { params: { reviewId: "review-1" } });

      expect(response.status).toBe(403);
    });
  });

  describe("Classification flow", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "reviewer@test.com", role: "REVIEWER", clientId: "client-1" },
        expires: "",
      });
    });

    it("should return 404 if review item not found", async () => {
      (mockPrisma.reviewItem.findUnique as jest.Mock).mockResolvedValue(null);

      const request = createRequest(
        "http://localhost/api/v1/reviews/nonexistent/decide",
        {
          method: "POST",
          body: JSON.stringify({ outcome: "TRUE_POSITIVE" }),
        }
      );
      const response = await POST_DECIDE(request, { params: { reviewId: "nonexistent" } });

      expect(response.status).toBe(404);
    });

    it("should return 403 if review belongs to different client", async () => {
      (mockPrisma.reviewItem.findUnique as jest.Mock).mockResolvedValue({
        id: "review-1",
        clientId: "other-client",
        flag: { turn: null },
      });

      const request = createRequest(
        "http://localhost/api/v1/reviews/review-1/decide",
        {
          method: "POST",
          body: JSON.stringify({ outcome: "TRUE_POSITIVE" }),
        }
      );
      const response = await POST_DECIDE(request, { params: { reviewId: "review-1" } });

      expect(response.status).toBe(403);
    });

    it("should create decision, update status, and create labeled data on valid classification", async () => {
      (mockPrisma.reviewItem.findUnique as jest.Mock).mockResolvedValue({
        id: "review-1",
        clientId: "client-1",
        status: "PENDING",
        flag: {
          turn: {
            content: "Harmful content",
            turnScores: [
              {
                selfHarm: 0.9,
                sexualContent: 0.1,
                ageSignal: 0.3,
                emotionalIntensity: 0.8,
                dependencyLanguage: 0.2,
                romanticEscalation: 0.1,
              },
            ],
            conversation: {
              turns: [
                { role: "user", content: "Hello", timestamp: new Date("2024-01-01") },
                { role: "companion", content: "Hi", timestamp: new Date("2024-01-01") },
              ],
            },
          },
        },
      });
      (mockPrisma.reviewDecision.create as jest.Mock).mockResolvedValue({
        id: "decision-1",
        reviewItemId: "review-1",
        reviewerId: "user-1",
        outcome: "TRUE_POSITIVE",
        notes: "Confirmed self-harm indicators",
      });
      (mockPrisma.reviewItem.update as jest.Mock).mockResolvedValue({
        id: "review-1",
        status: "RESOLVED",
      });

      const request = createRequest(
        "http://localhost/api/v1/reviews/review-1/decide",
        {
          method: "POST",
          body: JSON.stringify({
            outcome: "TRUE_POSITIVE",
            notes: "Confirmed self-harm indicators",
          }),
        }
      );
      const response = await POST_DECIDE(request, { params: { reviewId: "review-1" } });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe("decision-1");
      expect(data.status).toBe("RESOLVED");

      // Verify review decision was created
      expect(mockPrisma.reviewDecision.create).toHaveBeenCalledWith({
        data: {
          reviewItemId: "review-1",
          reviewerId: "user-1",
          outcome: "TRUE_POSITIVE",
          notes: "Confirmed self-harm indicators",
        },
      });

      // Verify review item status was updated to RESOLVED
      expect(mockPrisma.reviewItem.update).toHaveBeenCalledWith({
        where: { id: "review-1" },
        data: { status: "RESOLVED" },
      });

      // Verify labeled data entry was created
      expect(mockCreateLabeledDataEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "client-1",
          turnContent: "Harmful content",
          reviewerDecision: "TRUE_POSITIVE",
          reviewerNotes: "Confirmed self-harm indicators",
          scoresAtFlag: expect.objectContaining({
            selfHarm: 0.9,
          }),
        })
      );

      // Verify audit log was created
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "client-1",
          actor: "user-1",
          action: "review.decided",
          resource: "review:review-1",
          payload: expect.objectContaining({
            outcome: "TRUE_POSITIVE",
          }),
        })
      );
    });

    it("should validate outcome enum", async () => {
      const request = createRequest(
        "http://localhost/api/v1/reviews/review-1/decide",
        {
          method: "POST",
          body: JSON.stringify({ outcome: "INVALID_OUTCOME" }),
        }
      );
      const response = await POST_DECIDE(request, { params: { reviewId: "review-1" } });

      expect(response.status).toBe(422);
    });
  });
});

describe("PATCH /api/v1/reviews/:reviewId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "reviewer@test.com", role: "REVIEWER", clientId: "client-1" },
      expires: "",
    });
  });

  it("should update status and log audit entry", async () => {
    (mockPrisma.reviewItem.findUnique as jest.Mock).mockResolvedValue({
      id: "review-1",
      clientId: "client-1",
    });
    (mockPrisma.reviewItem.update as jest.Mock).mockResolvedValue({
      id: "review-1",
      status: "IN_REVIEW",
      assigneeId: null,
    });

    const request = createRequest(
      "http://localhost/api/v1/reviews/review-1",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_REVIEW" }),
      }
    );
    const response = await PATCH(request, { params: { reviewId: "review-1" } });

    expect(response.status).toBe(200);
    expect(mockAuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "review.updated",
        resource: "review:review-1",
      })
    );
  });

  it("should return 404 if review item not found", async () => {
    (mockPrisma.reviewItem.findUnique as jest.Mock).mockResolvedValue(null);

    const request = createRequest(
      "http://localhost/api/v1/reviews/nonexistent",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_REVIEW" }),
      }
    );
    const response = await PATCH(request, { params: { reviewId: "nonexistent" } });

    expect(response.status).toBe(404);
  });
});
