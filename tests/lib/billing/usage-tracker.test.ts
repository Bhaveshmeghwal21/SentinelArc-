import {
  checkUsageAlert,
  getCurrentBillingPeriod,
  getOrCreateUsageRecord,
  incrementConversationCount,
  incrementTurnCount,
  trackTurnUsage,
} from "@/lib/billing/usage-tracker";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    billingUsage: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    client: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("Usage Tracker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getCurrentBillingPeriod", () => {
    it("should return first of current month to first of next month", () => {
      const { start, end } = getCurrentBillingPeriod();
      const now = new Date();

      expect(start.getFullYear()).toBe(now.getFullYear());
      expect(start.getMonth()).toBe(now.getMonth());
      expect(start.getDate()).toBe(1);

      // End should be first of next month
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      expect(end.getFullYear()).toBe(nextMonth.getFullYear());
      expect(end.getMonth()).toBe(nextMonth.getMonth());
      expect(end.getDate()).toBe(1);
    });
  });

  describe("getOrCreateUsageRecord", () => {
    it("should return existing record if found", async () => {
      const mockRecord = {
        id: "usage-1",
        clientId: "client-1",
        conversationCount: 100,
        turnCount: 500,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      };

      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue(
        mockRecord
      );

      const result = await getOrCreateUsageRecord("client-1");

      expect(result.conversationCount).toBe(100);
      expect(result.turnCount).toBe(500);
    });

    it("should create a new record if none exists", async () => {
      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.billingUsage.create as jest.Mock).mockResolvedValue({
        id: "usage-new",
        clientId: "client-1",
        conversationCount: 0,
        turnCount: 0,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      });

      const result = await getOrCreateUsageRecord("client-1");

      expect(mockPrisma.billingUsage.create).toHaveBeenCalled();
      expect(result.conversationCount).toBe(0);
      expect(result.turnCount).toBe(0);
    });
  });

  describe("incrementConversationCount", () => {
    it("should increment the conversation count", async () => {
      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue({
        id: "usage-1",
        clientId: "client-1",
        conversationCount: 50,
        turnCount: 200,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      });

      (mockPrisma.billingUsage.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await incrementConversationCount("client-1");
      expect(result.conversationCount).toBe(51);
    });
  });

  describe("incrementTurnCount", () => {
    it("should increment the turn count", async () => {
      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue({
        id: "usage-1",
        clientId: "client-1",
        conversationCount: 50,
        turnCount: 200,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      });

      (mockPrisma.billingUsage.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await incrementTurnCount("client-1");
      expect(result.turnCount).toBe(201);
    });
  });

  describe("checkUsageAlert", () => {
    it("should return null when usage is below warning threshold", () => {
      // STARTER plan has 10K limit; 7000 = 70% (below 80% warning)
      const alert = checkUsageAlert(7000, "STARTER");
      expect(alert).toBeNull();
    });

    it("should return warning when usage is at 80%", () => {
      // STARTER: 10K limit; 8000 = 80%
      const alert = checkUsageAlert(8000, "STARTER");
      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("warning");
      expect(alert!.percentUsed).toBeCloseTo(0.8);
    });

    it("should return critical when usage is at 95%", () => {
      // STARTER: 10K limit; 9500 = 95%
      const alert = checkUsageAlert(9500, "STARTER");
      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("critical");
    });

    it("should return exceeded when usage is at or above 100%", () => {
      // STARTER: 10K limit; 10000 = 100%
      const alert = checkUsageAlert(10000, "STARTER");
      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("exceeded");
    });

    it("should return exceeded for usage over 100%", () => {
      const alert = checkUsageAlert(12000, "STARTER");
      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("exceeded");
      expect(alert!.percentUsed).toBe(1.2);
    });

    it("should return null for unknown plan tier", () => {
      const alert = checkUsageAlert(5000, "UNKNOWN");
      expect(alert).toBeNull();
    });

    it("should use correct limits for GROWTH plan", () => {
      // GROWTH: 50K limit; 40K = 80%
      const alert = checkUsageAlert(40000, "GROWTH");
      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("warning");
      expect(alert!.limit).toBe(50000);
    });

    it("should use correct limits for ENTERPRISE plan", () => {
      // ENTERPRISE: 250K limit; 200K = 80%
      const alert = checkUsageAlert(200000, "ENTERPRISE");
      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("warning");
      expect(alert!.limit).toBe(250000);
    });
  });

  describe("trackTurnUsage", () => {
    it("should increment turn count and conversation count for new conversations", async () => {
      // Mock for getOrCreateUsageRecord (called by incrementTurnCount)
      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue({
        id: "usage-1",
        clientId: "client-1",
        conversationCount: 10,
        turnCount: 50,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      });

      (mockPrisma.billingUsage.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
        planTier: "STARTER",
      });

      const { usage, alert } = await trackTurnUsage("client-1", true);

      expect(usage.conversationCount).toBe(11);
      expect(alert).toBeNull(); // 11/10000 is well below 80%
    });

    it("should only increment turn count for existing conversations", async () => {
      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue({
        id: "usage-1",
        clientId: "client-1",
        conversationCount: 10,
        turnCount: 50,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      });

      (mockPrisma.billingUsage.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
        planTier: "STARTER",
      });

      const { usage } = await trackTurnUsage("client-1", false);

      // Turn count incremented but not conversation count
      expect(usage.turnCount).toBe(51);
      expect(usage.conversationCount).toBe(10);
    });

    it("should return alert when approaching limit", async () => {
      (mockPrisma.billingUsage.findFirst as jest.Mock).mockResolvedValue({
        id: "usage-1",
        clientId: "client-1",
        conversationCount: 8500,
        turnCount: 50000,
        periodStart: new Date("2024-01-01"),
        periodEnd: new Date("2024-02-01"),
        createdAt: new Date(),
      });

      (mockPrisma.billingUsage.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
        planTier: "STARTER",
      });

      const { alert } = await trackTurnUsage("client-1", true);

      expect(alert).not.toBeNull();
      expect(alert!.alertLevel).toBe("warning");
      expect(alert!.clientId).toBe("client-1");
    });
  });
});
