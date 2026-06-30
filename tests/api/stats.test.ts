import { GET } from "@/app/api/v1/stats/route";

// Mock dependencies
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { count: jest.fn() },
    conversationTurn: { count: jest.fn() },
    flag: { findMany: jest.fn() },
    action: { findMany: jest.fn() },
    crisisRouteEvent: { count: jest.fn(), findMany: jest.fn() },
    reviewDecision: { findMany: jest.fn() },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/v1/stats");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString(), { method: "GET" });
}

describe("GET /api/v1/stats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(createRequest());
    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBe("Authentication required");
  });

  it("should return aggregate stats for the authenticated client", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(150);
    (mockPrisma.conversationTurn.count as jest.Mock).mockResolvedValue(2500);
    (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([
      { category: "self_harm", severity: "HIGH" },
      { category: "self_harm", severity: "CRITICAL" },
      { category: "sexual_content", severity: "HIGH" },
      { category: "emotional_intensity", severity: "MEDIUM" },
    ]);
    (mockPrisma.action.findMany as jest.Mock).mockResolvedValue([
      { type: "SOFT_FLAG" },
      { type: "SOFT_FLAG" },
      { type: "HARD_BLOCK" },
      { type: "CRISIS_ROUTE" },
    ]);
    (mockPrisma.crisisRouteEvent.count as jest.Mock).mockResolvedValue(3);
    (mockPrisma.crisisRouteEvent.findMany as jest.Mock).mockResolvedValue([
      { latencyMs: 100 },
      { latencyMs: 200 },
      { latencyMs: 150 },
    ]);
    (mockPrisma.reviewDecision.findMany as jest.Mock).mockResolvedValue([
      { outcome: "TRUE_POSITIVE" },
      { outcome: "TRUE_POSITIVE" },
      { outcome: "FALSE_POSITIVE" },
      { outcome: "TRUE_POSITIVE" },
    ]);

    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.conversation_count).toBe(150);
    expect(data.turn_count).toBe(2500);
    expect(data.flag_count).toBe(4);
    expect(data.flags_by_category).toEqual({
      self_harm: 2,
      sexual_content: 1,
      emotional_intensity: 1,
    });
    expect(data.flags_by_severity).toEqual({
      HIGH: 2,
      CRITICAL: 1,
      MEDIUM: 1,
    });
    expect(data.action_count).toBe(4);
    expect(data.actions_by_type).toEqual({
      SOFT_FLAG: 2,
      HARD_BLOCK: 1,
      CRISIS_ROUTE: 1,
    });
    expect(data.average_response_time_ms).toBe(150);
    expect(data.false_positive_rate).toBe(0.25);
    expect(data.crisis_route_count).toBe(3);
  });

  it("should enforce tenant isolation on all queries", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-42" },
      expires: "",
    });

    (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.conversationTurn.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.action.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.crisisRouteEvent.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.crisisRouteEvent.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.reviewDecision.findMany as jest.Mock).mockResolvedValue([]);

    await GET(createRequest());

    // All queries should include clientId filter
    expect(mockPrisma.conversation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: "client-42" }),
      })
    );
    expect(mockPrisma.flag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: "client-42" }),
      })
    );
    expect(mockPrisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: "client-42" }),
      })
    );
    expect(mockPrisma.crisisRouteEvent.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: "client-42" }),
      })
    );
  });

  it("should support date range filtering", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(50);
    (mockPrisma.conversationTurn.count as jest.Mock).mockResolvedValue(800);
    (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.action.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.crisisRouteEvent.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.crisisRouteEvent.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.reviewDecision.findMany as jest.Mock).mockResolvedValue([]);

    const from = "2024-01-01T00:00:00Z";
    const to = "2024-01-31T23:59:59Z";

    const response = await GET(createRequest({ from, to }));
    expect(response.status).toBe(200);

    // Verify date filter is applied to queries
    expect(mockPrisma.conversation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: "client-1",
          createdAt: {
            gte: new Date(from),
            lte: new Date(to),
          },
        }),
      })
    );
  });

  it("should return 0 for average response time when no crisis events exist", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(10);
    (mockPrisma.conversationTurn.count as jest.Mock).mockResolvedValue(100);
    (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.action.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.crisisRouteEvent.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.crisisRouteEvent.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.reviewDecision.findMany as jest.Mock).mockResolvedValue([]);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.average_response_time_ms).toBe(0);
    expect(data.false_positive_rate).toBe(0);
  });
});
