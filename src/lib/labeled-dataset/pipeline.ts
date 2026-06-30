/**
 * Labeled Dataset Pipeline.
 *
 * When a reviewer makes a classification decision, this module creates a
 * LabeledDataEntry containing all data needed for future model training:
 * - Original turn content
 * - Scores at time of flag
 * - Arc context (surrounding turns)
 * - Reviewer decision and notes
 * - Version number for dataset versioning
 *
 * Includes an export function that produces versioned JSONL format for ML training.
 */

import { prisma } from "@/lib/prisma";

export interface LabeledDataInput {
  clientId: string;
  turnContent: string;
  scoresAtFlag: {
    selfHarm: number;
    sexualContent: number;
    ageSignal: number;
    emotionalIntensity: number;
    dependencyLanguage: number;
    romanticEscalation: number;
  };
  arcContext: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  reviewerDecision: string; // TRUE_POSITIVE, FALSE_POSITIVE, ESCALATE
  reviewerNotes: string;
  version: number;
}

export interface LabeledDataExportEntry {
  id: string;
  turn_content: string;
  scores_at_flag: {
    self_harm: number;
    sexual_content: number;
    age_signal: number;
    emotional_intensity: number;
    dependency_language: number;
    romantic_escalation: number;
  };
  arc_context: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  reviewer_decision: string;
  reviewer_notes: string;
  version: number;
  scoring_model_version: string;
  created_at: string;
}

const SCORING_MODEL_VERSION = "sentinelarc-v1.0.0";

/**
 * Creates a labeled data entry from reviewer classification.
 */
export async function createLabeledDataEntry(
  input: LabeledDataInput
): Promise<{ id: string }> {
  const entry = await prisma.labeledDataEntry.create({
    data: {
      clientId: input.clientId,
      turnContent: input.turnContent,
      scoresAtFlag: {
        ...input.scoresAtFlag,
        arcContext: input.arcContext,
        reviewerNotes: input.reviewerNotes,
        scoringModelVersion: SCORING_MODEL_VERSION,
      },
      reviewerDecision: input.reviewerDecision,
      version: input.version,
    },
  });

  return { id: entry.id };
}

/**
 * Export labeled dataset as JSONL format for ML training.
 * Returns an array of export entries that can be serialized to JSONL.
 */
export async function exportLabeledDataset(
  clientId: string
): Promise<LabeledDataExportEntry[]> {
  const entries = await prisma.labeledDataEntry.findMany({
    where: { clientId },
    orderBy: { createdAt: "asc" },
  });

  return entries.map((entry) => {
    const scoresData = entry.scoresAtFlag as Record<string, unknown>;

    return {
      id: entry.id,
      turn_content: entry.turnContent,
      scores_at_flag: {
        self_harm: (scoresData.selfHarm as number) ?? 0,
        sexual_content: (scoresData.sexualContent as number) ?? 0,
        age_signal: (scoresData.ageSignal as number) ?? 0,
        emotional_intensity: (scoresData.emotionalIntensity as number) ?? 0,
        dependency_language: (scoresData.dependencyLanguage as number) ?? 0,
        romantic_escalation: (scoresData.romanticEscalation as number) ?? 0,
      },
      arc_context: (scoresData.arcContext as Array<{
        role: string;
        content: string;
        timestamp: string;
      }>) ?? [],
      reviewer_decision: entry.reviewerDecision,
      reviewer_notes: (scoresData.reviewerNotes as string) ?? "",
      version: entry.version,
      scoring_model_version:
        (scoresData.scoringModelVersion as string) ?? SCORING_MODEL_VERSION,
      created_at: entry.createdAt.toISOString(),
    };
  });
}

/**
 * Converts labeled data entries to JSONL string format.
 */
export function toJSONL(entries: LabeledDataExportEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}
