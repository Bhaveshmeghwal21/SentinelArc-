import {
  createLabeledDataEntry,
  exportLabeledDataset,
  toJSONL,
  type LabeledDataExportEntry,
} from "@/lib/labeled-dataset/pipeline";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    labeledDataEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("Labeled Dataset Pipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createLabeledDataEntry", () => {
    it("should create entry with all required fields", async () => {
      (mockPrisma.labeledDataEntry.create as jest.Mock).mockResolvedValue({
        id: "labeled-1",
      });

      const result = await createLabeledDataEntry({
        clientId: "client-1",
        turnContent: "I feel terrible",
        scoresAtFlag: {
          selfHarm: 0.9,
          sexualContent: 0.1,
          ageSignal: 0.3,
          emotionalIntensity: 0.8,
          dependencyLanguage: 0.2,
          romanticEscalation: 0.1,
        },
        arcContext: [
          { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" },
          { role: "companion", content: "Hi there", timestamp: "2024-01-01T00:00:01Z" },
        ],
        reviewerDecision: "TRUE_POSITIVE",
        reviewerNotes: "Confirmed self-harm risk",
        version: 1,
      });

      expect(result.id).toBe("labeled-1");
      expect(mockPrisma.labeledDataEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: "client-1",
          turnContent: "I feel terrible",
          reviewerDecision: "TRUE_POSITIVE",
          version: 1,
        }),
      });
    });
  });

  describe("exportLabeledDataset", () => {
    it("should export entries with all required fields", async () => {
      (mockPrisma.labeledDataEntry.findMany as jest.Mock).mockResolvedValue([
        {
          id: "labeled-1",
          clientId: "client-1",
          turnContent: "Test content",
          scoresAtFlag: {
            selfHarm: 0.9,
            sexualContent: 0.1,
            ageSignal: 0.3,
            emotionalIntensity: 0.8,
            dependencyLanguage: 0.2,
            romanticEscalation: 0.1,
            arcContext: [
              { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" },
            ],
            reviewerNotes: "Some notes",
            scoringModelVersion: "sentinelarc-v1.0.0",
          },
          reviewerDecision: "TRUE_POSITIVE",
          version: 1,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
      ]);

      const entries = await exportLabeledDataset("client-1");

      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.id).toBe("labeled-1");
      expect(entry.turn_content).toBe("Test content");
      expect(entry.reviewer_decision).toBe("TRUE_POSITIVE");
      expect(entry.version).toBe(1);
      expect(entry.scoring_model_version).toBe("sentinelarc-v1.0.0");
      expect(entry.scores_at_flag.self_harm).toBe(0.9);
      expect(entry.arc_context).toHaveLength(1);
      expect(entry.reviewer_notes).toBe("Some notes");
      expect(entry.created_at).toBe("2024-01-15T10:00:00.000Z");
    });

    it("should filter by clientId for tenant isolation", async () => {
      (mockPrisma.labeledDataEntry.findMany as jest.Mock).mockResolvedValue([]);

      await exportLabeledDataset("client-1");

      expect(mockPrisma.labeledDataEntry.findMany).toHaveBeenCalledWith({
        where: { clientId: "client-1" },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("toJSONL", () => {
    it("should produce valid JSONL format", () => {
      const entries: LabeledDataExportEntry[] = [
        {
          id: "1",
          turn_content: "Content 1",
          scores_at_flag: {
            self_harm: 0.9,
            sexual_content: 0.1,
            age_signal: 0.3,
            emotional_intensity: 0.8,
            dependency_language: 0.2,
            romantic_escalation: 0.1,
          },
          arc_context: [],
          reviewer_decision: "TRUE_POSITIVE",
          reviewer_notes: "",
          version: 1,
          scoring_model_version: "v1.0.0",
          created_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "2",
          turn_content: "Content 2",
          scores_at_flag: {
            self_harm: 0.1,
            sexual_content: 0.9,
            age_signal: 0.2,
            emotional_intensity: 0.3,
            dependency_language: 0.1,
            romantic_escalation: 0.4,
          },
          arc_context: [],
          reviewer_decision: "FALSE_POSITIVE",
          reviewer_notes: "Not risky",
          version: 1,
          scoring_model_version: "v1.0.0",
          created_at: "2024-01-02T00:00:00.000Z",
        },
      ];

      const jsonl = toJSONL(entries);
      const lines = jsonl.split("\n");

      expect(lines).toHaveLength(2);

      // Each line should be valid JSON
      const parsed1 = JSON.parse(lines[0]);
      expect(parsed1.id).toBe("1");
      expect(parsed1.turn_content).toBe("Content 1");

      const parsed2 = JSON.parse(lines[1]);
      expect(parsed2.id).toBe("2");
      expect(parsed2.reviewer_decision).toBe("FALSE_POSITIVE");
    });

    it("should produce empty string for empty array", () => {
      const jsonl = toJSONL([]);
      expect(jsonl).toBe("");
    });
  });
});
