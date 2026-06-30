import { generateReport, toCSV, type ReportRequest } from "@/lib/compliance/report-generator";

// Mock Prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLogEntry: {
      findMany: jest.fn(),
    },
    flag: {
      findMany: jest.fn(),
    },
    reviewItem: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("Compliance Report Generator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Full Audit Report", () => {
    it("should generate CSV with correct headers", async () => {
      (mockPrisma.auditLogEntry.findMany as jest.Mock).mockResolvedValue([
        {
          id: "audit-1",
          clientId: "client-1",
          actor: "user-1",
          action: "flag.created",
          resource: "flag:flag-1",
          payload: { severity: "HIGH" },
          timestamp: new Date("2024-01-15T10:00:00Z"),
        },
        {
          id: "audit-2",
          clientId: "client-1",
          actor: "system",
          action: "review.decided",
          resource: "review:review-1",
          payload: { outcome: "TRUE_POSITIVE" },
          timestamp: new Date("2024-01-15T11:00:00Z"),
        },
      ]);

      const result = await generateReport({
        reportType: "full_audit",
        clientId: "client-1",
        dateRange: {},
        format: "csv",
      });

      expect(result.contentType).toBe("text/csv");
      expect(result.filename).toBe("full-audit-report.csv");

      // Check CSV headers
      const lines = result.content.split("\n");
      expect(lines[0]).toBe("timestamp,actor,action,resource,details");
      expect(lines).toHaveLength(3); // header + 2 rows
    });

    it("should filter by date range", async () => {
      (mockPrisma.auditLogEntry.findMany as jest.Mock).mockResolvedValue([]);

      await generateReport({
        reportType: "full_audit",
        clientId: "client-1",
        dateRange: { from: "2024-01-01", to: "2024-01-31" },
        format: "csv",
      });

      expect(mockPrisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clientId: "client-1",
            timestamp: {
              gte: new Date("2024-01-01"),
              lte: new Date("2024-01-31"),
            },
          }),
        })
      );
    });

    it("should generate JSON format", async () => {
      (mockPrisma.auditLogEntry.findMany as jest.Mock).mockResolvedValue([
        {
          id: "audit-1",
          clientId: "client-1",
          actor: "user-1",
          action: "flag.created",
          resource: "flag:flag-1",
          payload: {},
          timestamp: new Date("2024-01-15T10:00:00Z"),
        },
      ]);

      const result = await generateReport({
        reportType: "full_audit",
        clientId: "client-1",
        dateRange: {},
        format: "json",
      });

      expect(result.contentType).toBe("application/json");
      const parsed = JSON.parse(result.content);
      expect(parsed.report_type).toBe("full_audit");
      expect(parsed.rows).toHaveLength(1);
    });
  });

  describe("Incident Report", () => {
    it("should generate incident report with SB 243 fields", async () => {
      (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([
        {
          id: "flag-1",
          severity: "HIGH",
          category: "self_harm",
          createdAt: new Date("2024-01-15T10:00:00Z"),
          actions: [
            { type: "SOFT_FLAG", createdAt: new Date("2024-01-15T10:00:05Z") },
          ],
          reviewItems: [
            {
              decisions: [
                { outcome: "TRUE_POSITIVE", createdAt: new Date("2024-01-15T11:00:00Z") },
              ],
            },
          ],
          conversation: { externalId: "conv-1", endUserId: "user-1" },
        },
      ]);

      const result = await generateReport({
        reportType: "incident_report",
        clientId: "client-1",
        dateRange: {},
        format: "csv",
      });

      expect(result.contentType).toBe("text/csv");
      const lines = result.content.split("\n");
      const headers = lines[0].split(",");

      // Verify SB 243 fields are present
      expect(headers).toContain("sb243_minor_involved");
      expect(headers).toContain("sb243_content_type");
      expect(headers).toContain("sb243_platform_action");
      expect(headers).toContain("sb243_notification_sent");

      // Verify data row
      expect(lines[1]).toContain("flag-1");
      expect(lines[1]).toContain("HIGH");
      expect(lines[1]).toContain("self_harm");
    });

    it("should calculate response time correctly", async () => {
      const flagTime = new Date("2024-01-15T10:00:00Z");
      const actionTime = new Date("2024-01-15T10:00:30Z"); // 30 seconds later

      (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([
        {
          id: "flag-1",
          severity: "CRITICAL",
          category: "self_harm",
          createdAt: flagTime,
          actions: [{ type: "CRISIS_ROUTE", createdAt: actionTime }],
          reviewItems: [{ decisions: [] }],
          conversation: { externalId: "conv-1", endUserId: "user-1" },
        },
      ]);

      const result = await generateReport({
        reportType: "incident_report",
        clientId: "client-1",
        dateRange: {},
        format: "json",
      });

      const parsed = JSON.parse(result.content);
      expect(parsed.rows[0].response_time_seconds).toBe(30);
    });
  });

  describe("Response Time Report", () => {
    it("should calculate time to first action and resolution", async () => {
      const flagTime = new Date("2024-01-15T10:00:00Z");
      const actionTime = new Date("2024-01-15T10:05:00Z"); // 5 minutes
      const resolveTime = new Date("2024-01-15T11:00:00Z"); // 1 hour

      (mockPrisma.flag.findMany as jest.Mock).mockResolvedValue([
        {
          id: "flag-1",
          severity: "HIGH",
          category: "sexual_content",
          createdAt: flagTime,
          actions: [{ type: "SOFT_FLAG", createdAt: actionTime }],
          reviewItems: [
            {
              decisions: [{ outcome: "TRUE_POSITIVE", createdAt: resolveTime }],
            },
          ],
        },
      ]);

      const result = await generateReport({
        reportType: "response_time",
        clientId: "client-1",
        dateRange: {},
        format: "json",
      });

      const parsed = JSON.parse(result.content);
      expect(parsed.rows[0].time_to_first_action_seconds).toBe(300); // 5 minutes
      expect(parsed.rows[0].time_to_resolution_seconds).toBe(3600); // 1 hour
    });
  });

  describe("Review Outcomes Report", () => {
    it("should calculate TP/FP rates by category", async () => {
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([
        {
          flag: { category: "self_harm" },
          decisions: [{ outcome: "TRUE_POSITIVE" }],
        },
        {
          flag: { category: "self_harm" },
          decisions: [{ outcome: "TRUE_POSITIVE" }],
        },
        {
          flag: { category: "self_harm" },
          decisions: [{ outcome: "FALSE_POSITIVE" }],
        },
        {
          flag: { category: "sexual_content" },
          decisions: [{ outcome: "ESCALATE" }],
        },
      ]);

      const result = await generateReport({
        reportType: "review_outcomes",
        clientId: "client-1",
        dateRange: {},
        format: "json",
      });

      const parsed = JSON.parse(result.content);
      const selfHarmRow = parsed.rows.find(
        (r: { category: string }) => r.category === "self_harm"
      );
      expect(selfHarmRow.total_reviews).toBe(3);
      expect(selfHarmRow.true_positives).toBe(2);
      expect(selfHarmRow.false_positives).toBe(1);
      expect(selfHarmRow.true_positive_rate).toBeCloseTo(2 / 3, 5);
      expect(selfHarmRow.false_positive_rate).toBeCloseTo(1 / 3, 5);
    });

    it("should generate CSV with correct grouping", async () => {
      (mockPrisma.reviewItem.findMany as jest.Mock).mockResolvedValue([
        {
          flag: { category: "self_harm" },
          decisions: [{ outcome: "TRUE_POSITIVE" }],
        },
      ]);

      const result = await generateReport({
        reportType: "review_outcomes",
        clientId: "client-1",
        dateRange: {},
        format: "csv",
      });

      const lines = result.content.split("\n");
      expect(lines[0]).toBe(
        "category,total_reviews,true_positives,false_positives,escalated,true_positive_rate,false_positive_rate"
      );
      expect(lines).toHaveLength(2); // header + 1 category
    });
  });

  describe("CSV format validity", () => {
    it("should escape fields with commas", () => {
      const result = toCSV(["header"], [['value, with comma']]);
      expect(result).toBe('header\n"value, with comma"');
    });

    it("should escape fields with quotes", () => {
      const result = toCSV(["header"], [['value "with" quotes']]);
      expect(result).toBe('header\n"value ""with"" quotes"');
    });

    it("should handle normal fields without escaping", () => {
      const result = toCSV(["a", "b"], [["val1", "val2"]]);
      expect(result).toBe("a,b\nval1,val2");
    });
  });
});
