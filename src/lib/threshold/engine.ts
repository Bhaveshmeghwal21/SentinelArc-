/**
 * Threshold and Action Engine.
 *
 * Takes turn scores and arc scores, applies client-specific threshold configuration,
 * and determines actions. CRITICAL INVARIANT: no code path can suppress crisis routing
 * for scores above the system minimum threshold.
 *
 * Action types:
 * - SOFT_FLAG: Logged, queued for review
 * - HARD_BLOCK: Conversation interrupted immediately
 * - CRISIS_ROUTE: Crisis resources shown immediately + hard block + same-day human review
 *
 * Safety philosophy: Clients can only RAISE thresholds for soft flags. They can NEVER
 * lower crisis routing thresholds below system minimums.
 */

import type { TurnScores } from "../scoring/turn-scorer";
import type { ArcScoreResult } from "../scoring/arc-scorer";

export type ActionSeverity = "SOFT_FLAG" | "HARD_BLOCK" | "CRISIS_ROUTE";

export interface ThresholdAction {
  type: ActionSeverity;
  category: string;
  score: number;
  threshold: number;
  reason: string;
}

/**
 * System minimum thresholds - these CANNOT be lowered by client configuration.
 * This is the safety floor of the entire system.
 */
export const SYSTEM_MINIMUM_THRESHOLDS = {
  /** Self-harm score at or above this ALWAYS triggers CRISIS_ROUTE */
  crisisRoute_selfHarm: 0.7,
  /** Combined sexual + age signal at or above this ALWAYS triggers HARD_BLOCK */
  hardBlock_sexualWithMinor: 0.6,
  /** Self-harm score at or above this ALWAYS triggers at minimum SOFT_FLAG */
  softFlag_selfHarm: 0.4,
} as const;

export interface ClientThresholdConfig {
  /** Threshold for self-harm CRISIS_ROUTE - cannot be below system minimum of 0.7 */
  crisisRoute_selfHarm?: number;
  /** Threshold for self-harm SOFT_FLAG - cannot be below system minimum of 0.4 */
  softFlag_selfHarm?: number;
  /** Threshold for HARD_BLOCK on sexual content with minor - cannot be below 0.6 */
  hardBlock_sexualWithMinor?: number;
  /** Threshold for soft flag on emotional intensity (client can raise only) */
  softFlag_emotionalIntensity?: number;
  /** Threshold for soft flag on dependency language (client can raise only) */
  softFlag_dependencyLanguage?: number;
  /** Threshold for soft flag on romantic escalation (client can raise only) */
  softFlag_romanticEscalation?: number;
}

/**
 * Default thresholds - safety-conservative.
 */
const DEFAULT_THRESHOLDS: Required<ClientThresholdConfig> = {
  crisisRoute_selfHarm: 0.7,
  softFlag_selfHarm: 0.4,
  hardBlock_sexualWithMinor: 0.6,
  softFlag_emotionalIntensity: 0.5,
  softFlag_dependencyLanguage: 0.5,
  softFlag_romanticEscalation: 0.5,
};

/**
 * Enforce system minimum thresholds.
 * Client can only RAISE soft flag thresholds, NEVER lower crisis/block thresholds
 * below system minimums.
 */
export function enforceThresholds(
  clientConfig?: ClientThresholdConfig
): Required<ClientThresholdConfig> {
  if (!clientConfig) return { ...DEFAULT_THRESHOLDS };

  return {
    // Crisis thresholds: enforce minimum (client can lower to minimum but not below)
    crisisRoute_selfHarm: Math.max(
      SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm,
      Math.min(
        clientConfig.crisisRoute_selfHarm ?? DEFAULT_THRESHOLDS.crisisRoute_selfHarm,
        1.0
      )
    ),
    // Hard block thresholds: enforce minimum
    hardBlock_sexualWithMinor: Math.max(
      SYSTEM_MINIMUM_THRESHOLDS.hardBlock_sexualWithMinor,
      Math.min(
        clientConfig.hardBlock_sexualWithMinor ?? DEFAULT_THRESHOLDS.hardBlock_sexualWithMinor,
        1.0
      )
    ),
    // Self-harm soft flag: enforce minimum
    softFlag_selfHarm: Math.max(
      SYSTEM_MINIMUM_THRESHOLDS.softFlag_selfHarm,
      Math.min(
        clientConfig.softFlag_selfHarm ?? DEFAULT_THRESHOLDS.softFlag_selfHarm,
        1.0
      )
    ),
    // Other soft flag thresholds: client can only raise these
    softFlag_emotionalIntensity: Math.max(
      clientConfig.softFlag_emotionalIntensity ?? DEFAULT_THRESHOLDS.softFlag_emotionalIntensity,
      DEFAULT_THRESHOLDS.softFlag_emotionalIntensity
    ),
    softFlag_dependencyLanguage: Math.max(
      clientConfig.softFlag_dependencyLanguage ?? DEFAULT_THRESHOLDS.softFlag_dependencyLanguage,
      DEFAULT_THRESHOLDS.softFlag_dependencyLanguage
    ),
    softFlag_romanticEscalation: Math.max(
      clientConfig.softFlag_romanticEscalation ?? DEFAULT_THRESHOLDS.softFlag_romanticEscalation,
      DEFAULT_THRESHOLDS.softFlag_romanticEscalation
    ),
  };
}

/**
 * Evaluate turn scores against thresholds and determine actions.
 *
 * CRITICAL INVARIANT: If self_harm >= system minimum crisis threshold (0.7),
 * CRISIS_ROUTE is ALWAYS produced regardless of any other configuration.
 * This invariant is tested with property-based tests to ensure it cannot
 * be violated by any combination of inputs.
 */
export function evaluateThresholds(
  turnScores: TurnScores,
  arcScore: ArcScoreResult | null,
  clientConfig?: ClientThresholdConfig
): ThresholdAction[] {
  const thresholds = enforceThresholds(clientConfig);
  const actions: ThresholdAction[] = [];

  // ================================================================
  // CRITICAL PATH: Crisis routing check - this runs FIRST, ALWAYS
  // ================================================================
  if (turnScores.selfHarm >= SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm) {
    // INVARIANT: This block can NEVER be skipped or suppressed.
    // Even if thresholds are misconfigured, the system minimum guarantees this fires.
    actions.push({
      type: "CRISIS_ROUTE",
      category: "self_harm",
      score: turnScores.selfHarm,
      threshold: SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm,
      reason: "Self-harm score exceeds crisis routing threshold",
    });
  } else if (turnScores.selfHarm >= thresholds.crisisRoute_selfHarm) {
    // Client's threshold (if above system minimum) also triggers crisis route
    actions.push({
      type: "CRISIS_ROUTE",
      category: "self_harm",
      score: turnScores.selfHarm,
      threshold: thresholds.crisisRoute_selfHarm,
      reason: "Self-harm score exceeds client crisis routing threshold",
    });
  }

  // ================================================================
  // HARD BLOCK: Sexual content with age signal
  // ================================================================
  const sexualWithMinorScore =
    (turnScores.sexualContent + turnScores.ageSignal) / 2 +
    Math.min(turnScores.sexualContent, turnScores.ageSignal) * 0.5;

  if (sexualWithMinorScore >= thresholds.hardBlock_sexualWithMinor) {
    actions.push({
      type: "HARD_BLOCK",
      category: "sexual_content_with_minor",
      score: sexualWithMinorScore,
      threshold: thresholds.hardBlock_sexualWithMinor,
      reason: "Sexual content combined with age signal exceeds hard block threshold",
    });
  }

  // Also check romantic escalation + age signal from arc level
  if (
    arcScore?.escalationFlags.romanticWithMinor &&
    turnScores.romanticEscalation >= 0.3
  ) {
    // If arc detected romantic-with-minor pattern, lower the bar for hard block
    if (!actions.some((a) => a.type === "HARD_BLOCK")) {
      actions.push({
        type: "HARD_BLOCK",
        category: "romantic_escalation_with_minor",
        score: turnScores.romanticEscalation,
        threshold: 0.3,
        reason: "Romantic escalation in conversation with detected minor",
      });
    }
  }

  // ================================================================
  // SOFT FLAGS
  // ================================================================

  // Self-harm soft flag (below crisis threshold but above soft flag threshold)
  if (
    turnScores.selfHarm >= thresholds.softFlag_selfHarm &&
    !actions.some((a) => a.category === "self_harm")
  ) {
    actions.push({
      type: "SOFT_FLAG",
      category: "self_harm",
      score: turnScores.selfHarm,
      threshold: thresholds.softFlag_selfHarm,
      reason: "Self-harm score exceeds soft flag threshold",
    });
  }

  // Emotional intensity soft flag
  if (turnScores.emotionalIntensity >= thresholds.softFlag_emotionalIntensity) {
    actions.push({
      type: "SOFT_FLAG",
      category: "emotional_intensity",
      score: turnScores.emotionalIntensity,
      threshold: thresholds.softFlag_emotionalIntensity,
      reason: "Emotional intensity exceeds soft flag threshold",
    });
  }

  // Dependency language soft flag
  if (turnScores.dependencyLanguage >= thresholds.softFlag_dependencyLanguage) {
    actions.push({
      type: "SOFT_FLAG",
      category: "dependency_language",
      score: turnScores.dependencyLanguage,
      threshold: thresholds.softFlag_dependencyLanguage,
      reason: "Dependency language exceeds soft flag threshold",
    });
  }

  // Romantic escalation soft flag
  if (turnScores.romanticEscalation >= thresholds.softFlag_romanticEscalation) {
    actions.push({
      type: "SOFT_FLAG",
      category: "romantic_escalation",
      score: turnScores.romanticEscalation,
      threshold: thresholds.softFlag_romanticEscalation,
      reason: "Romantic escalation exceeds soft flag threshold",
    });
  }

  // ================================================================
  // ARC-LEVEL ESCALATION FLAGS always produce at minimum SOFT_FLAG
  // ================================================================
  if (arcScore) {
    if (arcScore.escalationFlags.suicidalEscalation) {
      // Suicidal escalation at arc level bumps to CRISIS_ROUTE if turn score is moderate
      if (turnScores.selfHarm >= 0.3) {
        if (!actions.some((a) => a.type === "CRISIS_ROUTE")) {
          actions.push({
            type: "CRISIS_ROUTE",
            category: "suicidal_escalation_arc",
            score: arcScore.compositeRisk,
            threshold: 0.3,
            reason: "Arc-level suicidal escalation detected with moderate turn score",
          });
        }
      } else if (!actions.some((a) => a.category.includes("self_harm"))) {
        actions.push({
          type: "SOFT_FLAG",
          category: "suicidal_escalation_arc",
          score: arcScore.compositeRisk,
          threshold: 0,
          reason: "Arc-level suicidal escalation pattern detected",
        });
      }
    }

    if (
      arcScore.escalationFlags.dependencyDeepening &&
      !actions.some((a) => a.category === "dependency_language")
    ) {
      actions.push({
        type: "SOFT_FLAG",
        category: "dependency_deepening_arc",
        score: arcScore.compositeRisk,
        threshold: 0,
        reason: "Arc-level dependency language deepening detected",
      });
    }

    if (
      arcScore.escalationFlags.emotionalEscalation &&
      !actions.some((a) => a.category === "emotional_intensity")
    ) {
      actions.push({
        type: "SOFT_FLAG",
        category: "emotional_escalation_arc",
        score: arcScore.compositeRisk,
        threshold: 0,
        reason: "Arc-level emotional escalation detected",
      });
    }
  }

  // Sort by severity: CRISIS_ROUTE > HARD_BLOCK > SOFT_FLAG
  return actions.sort((a, b) => severityOrder(b.type) - severityOrder(a.type));
}

/**
 * Get the highest severity action from a list.
 */
export function getHighestSeverity(actions: ThresholdAction[]): ActionSeverity | null {
  if (actions.length === 0) return null;
  // Actions are already sorted by severity
  return actions[0].type;
}

function severityOrder(type: ActionSeverity): number {
  switch (type) {
    case "CRISIS_ROUTE":
      return 3;
    case "HARD_BLOCK":
      return 2;
    case "SOFT_FLAG":
      return 1;
  }
}
