/**
 * Turn-level scoring module.
 *
 * Produces scores across safety categories for a single conversation turn:
 * - self_harm: 0-1
 * - sexual_content: 0-1
 * - age_signal: 0-1
 * - emotional_intensity: 0-1
 * - romantic_escalation: 0-1
 * - dependency_language: 0-1
 *
 * Combines rule-based pattern matching with a pluggable external moderation API.
 */

import {
  evaluatePatterns,
  SELF_HARM_PATTERNS,
  SUICIDAL_IDEATION_PATTERNS,
  AGE_SIGNAL_PATTERNS,
  ROMANTIC_ESCALATION_PATTERNS,
  DEPENDENCY_LANGUAGE_PATTERNS,
} from "./patterns";

export interface TurnScores {
  selfHarm: number;
  sexualContent: number;
  ageSignal: number;
  emotionalIntensity: number;
  romanticEscalation: number;
  dependencyLanguage: number;
}

export interface ModerationApiScores {
  selfHarm?: number;
  sexualContent?: number;
  ageSignal?: number;
  emotionalIntensity?: number;
  romanticEscalation?: number;
  dependencyLanguage?: number;
}

/**
 * Pluggable interface for external moderation API calls.
 * Implementations can wrap OpenAI Moderation, Perspective API, etc.
 */
export interface ModerationApiProvider {
  /** Analyze content and return category scores */
  analyze(content: string): Promise<ModerationApiScores>;
  /** Whether this provider is currently available */
  isAvailable(): boolean;
}

/**
 * Mock moderation provider for testing purposes.
 * Always returns zero scores - the rule-based layer handles detection.
 */
export class MockModerationProvider implements ModerationApiProvider {
  analyze(_content: string): Promise<ModerationApiScores> {
    return Promise.resolve({
      selfHarm: 0,
      sexualContent: 0,
      ageSignal: 0,
      emotionalIntensity: 0,
      romanticEscalation: 0,
      dependencyLanguage: 0,
    });
  }

  isAvailable(): boolean {
    return true;
  }
}

export interface TurnScorerConfig {
  /** Weight for rule-based scores (0-1), remainder goes to API scores */
  ruleWeight: number;
  /** External moderation API provider */
  moderationProvider: ModerationApiProvider;
}

const DEFAULT_CONFIG: TurnScorerConfig = {
  ruleWeight: 0.8,
  moderationProvider: new MockModerationProvider(),
};

/**
 * Score a single turn's content across all safety categories.
 */
export async function scoreTurn(
  content: string,
  config: TurnScorerConfig = DEFAULT_CONFIG
): Promise<TurnScores> {
  // Handle edge cases
  if (!content || content.trim().length === 0) {
    return {
      selfHarm: 0,
      sexualContent: 0,
      ageSignal: 0,
      emotionalIntensity: 0,
      romanticEscalation: 0,
      dependencyLanguage: 0,
    };
  }

  // Normalize content for consistent matching
  const normalizedContent = content.toLowerCase();

  // Rule-based scoring
  const ruleScores = computeRuleBasedScores(normalizedContent);

  // External API scoring (if available)
  let apiScores: ModerationApiScores = {};
  if (config.moderationProvider.isAvailable()) {
    try {
      apiScores = await config.moderationProvider.analyze(content);
    } catch {
      // If API fails, rely entirely on rule-based scores
      // This is a safety-first design: we never suppress scoring due to API failure
      apiScores = {};
    }
  }

  // Combine scores with configurable weights
  const ruleWeight = config.ruleWeight;
  const apiWeight = 1 - ruleWeight;

  return {
    selfHarm: combineScores(ruleScores.selfHarm, apiScores.selfHarm, ruleWeight, apiWeight),
    sexualContent: combineScores(ruleScores.sexualContent, apiScores.sexualContent, ruleWeight, apiWeight),
    ageSignal: combineScores(ruleScores.ageSignal, apiScores.ageSignal, ruleWeight, apiWeight),
    emotionalIntensity: combineScores(ruleScores.emotionalIntensity, apiScores.emotionalIntensity, ruleWeight, apiWeight),
    romanticEscalation: combineScores(ruleScores.romanticEscalation, apiScores.romanticEscalation, ruleWeight, apiWeight),
    dependencyLanguage: combineScores(ruleScores.dependencyLanguage, apiScores.dependencyLanguage, ruleWeight, apiWeight),
  };
}

/**
 * Compute rule-based scores using curated pattern lists.
 */
function computeRuleBasedScores(normalizedContent: string): TurnScores {
  // Self-harm combines self-harm patterns and suicidal ideation patterns
  const selfHarmScore = evaluatePatterns(normalizedContent, SELF_HARM_PATTERNS);
  const suicidalScore = evaluatePatterns(normalizedContent, SUICIDAL_IDEATION_PATTERNS);
  const selfHarm = Math.min(1, Math.max(selfHarmScore, suicidalScore));

  const ageSignal = evaluatePatterns(normalizedContent, AGE_SIGNAL_PATTERNS);
  const romanticEscalation = evaluatePatterns(normalizedContent, ROMANTIC_ESCALATION_PATTERNS);
  const dependencyLanguage = evaluatePatterns(normalizedContent, DEPENDENCY_LANGUAGE_PATTERNS);

  // Sexual content scoring: romantic escalation with explicit sexual elements
  // Score higher when romantic patterns are explicit/sexual in nature
  const sexualContent = computeSexualContentScore(normalizedContent, romanticEscalation);

  // Emotional intensity: derived from presence of intense emotional language
  const emotionalIntensity = computeEmotionalIntensityScore(normalizedContent);

  return {
    selfHarm,
    sexualContent,
    ageSignal,
    emotionalIntensity,
    romanticEscalation,
    dependencyLanguage,
  };
}

/**
 * Compute sexual content score based on explicit patterns.
 */
function computeSexualContentScore(
  content: string,
  romanticScore: number
): number {
  const explicitPatterns = [
    { regex: /\b(nude|nudes|naked|undress)\b/i, weight: 0.85 },
    { regex: /\b(sex|sexual|sexually)\b/i, weight: 0.7 },
    { regex: /\b(send (me )?(pics|pictures|photos|nudes))\b/i, weight: 0.9 },
    { regex: /\b(what are you wearing)\b/i, weight: 0.6 },
    { regex: /\b(take (off|your clothes))\b/i, weight: 0.85 },
    { regex: /\b(want to see (you|your body))\b/i, weight: 0.7 },
    { regex: /\b(turn(s|ed)? (me )?on)\b/i, weight: 0.5 },
  ];

  let maxWeight = 0;
  for (const pattern of explicitPatterns) {
    if (pattern.regex.test(content)) {
      maxWeight = Math.max(maxWeight, pattern.weight);
    }
  }

  // If romantic score is high and some explicit content, boost
  if (romanticScore > 0.5 && maxWeight > 0) {
    return Math.min(1, maxWeight + 0.1);
  }

  return maxWeight;
}

/**
 * Compute emotional intensity score.
 * Measures the intensity/urgency of emotional language.
 */
function computeEmotionalIntensityScore(content: string): number {
  const intensityPatterns = [
    { regex: /\b(i can'?t (take|handle|deal with|bear) (it|this))\b/i, weight: 0.7 },
    { regex: /\b(so (scared|afraid|terrified|anxious|depressed|sad|lonely))\b/i, weight: 0.6 },
    { regex: /\b(overwhelm(ed|ing))\b/i, weight: 0.5 },
    { regex: /\b(desperate|hopeless|helpless|worthless)\b/i, weight: 0.7 },
    { regex: /\b(i hate (myself|my life|everything))\b/i, weight: 0.75 },
    { regex: /\b(nobody (cares|loves me|understands))\b/i, weight: 0.65 },
    { regex: /\b(all alone|so alone|completely alone)\b/i, weight: 0.6 },
    { regex: /\b(crying|sobbing|can'?t stop crying)\b/i, weight: 0.55 },
    { regex: /\b(panic|panicking|panic attack)\b/i, weight: 0.6 },
    { regex: /\b(breaking down|falling apart)\b/i, weight: 0.55 },
    { regex: /!(.*!){2,}/i, weight: 0.3 }, // Multiple exclamation marks
  ];

  let maxWeight = 0;
  let matchCount = 0;
  for (const pattern of intensityPatterns) {
    if (pattern.regex.test(content)) {
      maxWeight = Math.max(maxWeight, pattern.weight);
      matchCount++;
    }
  }

  if (matchCount === 0) return 0;

  // Multiple emotional intensity signals compound
  const compoundBonus = Math.min(0.2, matchCount * 0.05);
  return Math.min(1, maxWeight + compoundBonus);
}

/**
 * Combine rule-based and API scores.
 * If API score is not available, use rule-based score at full weight.
 * Uses max(rule, api) combined with weighted average for safety-conservative behavior.
 */
function combineScores(
  ruleScore: number,
  apiScore: number | undefined,
  ruleWeight: number,
  apiWeight: number
): number {
  if (apiScore === undefined || apiScore === 0) {
    return ruleScore;
  }

  // Safety-first: take the higher of weighted average and max signal
  const weightedAverage = ruleScore * ruleWeight + apiScore * apiWeight;
  const maxSignal = Math.max(ruleScore, apiScore);

  // Bias toward max signal (safety-conservative)
  return Math.round(Math.max(weightedAverage, maxSignal * 0.9) * 1000) / 1000;
}
