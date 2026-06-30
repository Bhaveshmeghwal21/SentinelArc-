/**
 * Arc-level rolling scorer.
 *
 * Analyzes conversation history (not just the latest turn) to detect
 * escalation patterns that are invisible at the single-turn level.
 *
 * Tracks:
 * - Emotional intensity trend (increasing/stable/decreasing over last N turns)
 * - Romantic escalation + age signals (flags when both appear in same conversation)
 * - Dependency language deepening (increasing attachment patterns)
 * - Suicidal ideation escalation (passive to active progression)
 */

import type { TurnScores } from "./turn-scorer";

export type TrendDirection = "rising" | "stable" | "falling";

export interface EscalationFlags {
  /** Romantic content detected in a conversation where age signals are present */
  romanticWithMinor: boolean;
  /** Dependency language has increased over the conversation window */
  dependencyDeepening: boolean;
  /** Suicidal ideation has progressed from passive to active */
  suicidalEscalation: boolean;
  /** Emotional intensity is persistently high or rising */
  emotionalEscalation: boolean;
}

export interface ArcScoreResult {
  /** Composite risk level (0-1) */
  compositeRisk: number;
  /** Individual category scores (max across window) */
  selfHarm: number;
  sexualContent: number;
  ageSignal: number;
  emotionalIntensity: number;
  romanticEscalation: number;
  dependencyLanguage: number;
  /** Trend direction of emotional intensity */
  trendDirection: TrendDirection;
  /** Number of turns analyzed */
  turnCount: number;
  /** Specific escalation flags */
  escalationFlags: EscalationFlags;
}

export interface ArcScorerConfig {
  /** Number of most recent turns to consider in the sliding window */
  windowSize: number;
  /** Threshold for trend detection: minimum slope to count as rising/falling */
  trendThreshold: number;
  /** Minimum score to count as "present" for a category */
  presenceThreshold: number;
}

const DEFAULT_ARC_CONFIG: ArcScorerConfig = {
  windowSize: 10,
  trendThreshold: 0.1,
  presenceThreshold: 0.3,
};

/**
 * Score a conversation arc by analyzing the history of turn scores.
 *
 * @param turnScoresHistory - Array of turn scores in chronological order (oldest first)
 * @param config - Arc scorer configuration
 */
export function scoreArc(
  turnScoresHistory: TurnScores[],
  config: ArcScorerConfig = DEFAULT_ARC_CONFIG
): ArcScoreResult {
  if (turnScoresHistory.length === 0) {
    return createEmptyArcScore();
  }

  // Apply sliding window
  const window = turnScoresHistory.slice(-config.windowSize);
  const turnCount = window.length;

  // Compute max scores across the window
  const maxScores = computeMaxScores(window);

  // Compute trend direction for emotional intensity
  const trendDirection = computeTrend(
    window.map((t) => t.emotionalIntensity),
    config.trendThreshold
  );

  // Detect escalation flags
  const escalationFlags = detectEscalationFlags(
    window,
    turnScoresHistory,
    config
  );

  // Compute composite risk
  const compositeRisk = computeCompositeRisk(
    maxScores,
    trendDirection,
    escalationFlags
  );

  return {
    compositeRisk,
    selfHarm: maxScores.selfHarm,
    sexualContent: maxScores.sexualContent,
    ageSignal: maxScores.ageSignal,
    emotionalIntensity: maxScores.emotionalIntensity,
    romanticEscalation: maxScores.romanticEscalation,
    dependencyLanguage: maxScores.dependencyLanguage,
    trendDirection,
    turnCount,
    escalationFlags,
  };
}

function createEmptyArcScore(): ArcScoreResult {
  return {
    compositeRisk: 0,
    selfHarm: 0,
    sexualContent: 0,
    ageSignal: 0,
    emotionalIntensity: 0,
    romanticEscalation: 0,
    dependencyLanguage: 0,
    trendDirection: "stable",
    turnCount: 0,
    escalationFlags: {
      romanticWithMinor: false,
      dependencyDeepening: false,
      suicidalEscalation: false,
      emotionalEscalation: false,
    },
  };
}

/**
 * Compute the maximum score for each category across the window.
 */
function computeMaxScores(window: TurnScores[]): TurnScores {
  return window.reduce(
    (max, turn) => ({
      selfHarm: Math.max(max.selfHarm, turn.selfHarm),
      sexualContent: Math.max(max.sexualContent, turn.sexualContent),
      ageSignal: Math.max(max.ageSignal, turn.ageSignal),
      emotionalIntensity: Math.max(max.emotionalIntensity, turn.emotionalIntensity),
      romanticEscalation: Math.max(max.romanticEscalation, turn.romanticEscalation),
      dependencyLanguage: Math.max(max.dependencyLanguage, turn.dependencyLanguage),
    }),
    {
      selfHarm: 0,
      sexualContent: 0,
      ageSignal: 0,
      emotionalIntensity: 0,
      romanticEscalation: 0,
      dependencyLanguage: 0,
    }
  );
}

/**
 * Compute trend direction using linear regression slope on a series of values.
 */
function computeTrend(
  values: number[],
  threshold: number
): TrendDirection {
  if (values.length < 3) return "stable";

  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  if (slope > threshold) return "rising";
  if (slope < -threshold) return "falling";
  return "stable";
}

/**
 * Detect escalation patterns that span multiple turns.
 */
function detectEscalationFlags(
  window: TurnScores[],
  fullHistory: TurnScores[],
  config: ArcScorerConfig
): EscalationFlags {
  const presenceThreshold = config.presenceThreshold;

  // Romantic + minor: any romantic/sexual content in a conversation where age signals exist
  const hasAgeSignal = fullHistory.some((t) => t.ageSignal >= presenceThreshold);
  const hasRomantic = fullHistory.some(
    (t) => t.romanticEscalation >= presenceThreshold || t.sexualContent >= presenceThreshold
  );
  const romanticWithMinor = hasAgeSignal && hasRomantic;

  // Dependency deepening: is dependency language increasing over the window?
  const dependencyValues = window.map((t) => t.dependencyLanguage);
  const dependencyTrend = computeTrend(dependencyValues, config.trendThreshold);
  const hasDependency = window.some((t) => t.dependencyLanguage >= presenceThreshold);
  const dependencyDeepening = dependencyTrend === "rising" || (hasDependency && dependencyValues[dependencyValues.length - 1] > dependencyValues[0] + 0.1);

  // Suicidal escalation: self-harm scores increasing, especially from low to high
  const selfHarmValues = window.map((t) => t.selfHarm);
  const selfHarmTrend = computeTrend(selfHarmValues, config.trendThreshold);
  const latestSelfHarm = selfHarmValues[selfHarmValues.length - 1] ?? 0;
  const earliestSelfHarm = selfHarmValues[0] ?? 0;
  const suicidalEscalation =
    selfHarmTrend === "rising" ||
    (latestSelfHarm >= 0.5 && latestSelfHarm - earliestSelfHarm >= 0.2);

  // Emotional escalation: intensity is rising or persistently high
  const emotionalValues = window.map((t) => t.emotionalIntensity);
  const emotionalTrend = computeTrend(emotionalValues, config.trendThreshold);
  const avgEmotional =
    emotionalValues.reduce((s, v) => s + v, 0) / emotionalValues.length;
  const emotionalEscalation =
    emotionalTrend === "rising" || avgEmotional >= 0.6;

  return {
    romanticWithMinor,
    dependencyDeepening,
    suicidalEscalation,
    emotionalEscalation,
  };
}

/**
 * Compute composite risk from max scores, trend, and escalation flags.
 */
function computeCompositeRisk(
  maxScores: TurnScores,
  trendDirection: TrendDirection,
  flags: EscalationFlags
): number {
  // Start with weighted max scores
  let risk =
    maxScores.selfHarm * 0.35 +
    maxScores.sexualContent * 0.15 +
    maxScores.ageSignal * 0.1 +
    maxScores.emotionalIntensity * 0.15 +
    maxScores.romanticEscalation * 0.1 +
    maxScores.dependencyLanguage * 0.15;

  // Escalation flags add risk
  if (flags.romanticWithMinor) risk += 0.2;
  if (flags.suicidalEscalation) risk += 0.15;
  if (flags.dependencyDeepening) risk += 0.1;
  if (flags.emotionalEscalation) risk += 0.05;

  // Rising trend adds risk
  if (trendDirection === "rising") risk += 0.05;

  return Math.min(1, Math.round(risk * 1000) / 1000);
}
