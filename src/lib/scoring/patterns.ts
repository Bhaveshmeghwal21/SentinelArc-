/**
 * Curated pattern lists for safety scoring.
 *
 * Known limitations of pattern-based detection:
 * - Patterns cannot fully understand context, sarcasm, or nuance.
 * - Multi-language content is not covered (English only in v1).
 * - Sophisticated obfuscation (leetspeak, spacing tricks) may evade detection.
 * - False positives are possible with educational/clinical/literary content.
 * - These patterns supplement (not replace) ML-based moderation APIs.
 *
 * Each pattern includes:
 * - regex: The matching pattern (case-insensitive by default)
 * - weight: Contribution to category score (0-1)
 * - contextRules: Optional rules to adjust scoring based on context
 */

export interface PatternEntry {
  regex: RegExp;
  weight: number;
  contextRules?: {
    /** If true, reduce weight when third-person language is detected nearby */
    reduceOnThirdPerson?: boolean;
    /** If true, reduce weight when educational/clinical framing is detected */
    reduceOnEducational?: boolean;
    /** If true, only score when first-person language is present */
    requireFirstPerson?: boolean;
  };
}

// Patterns indicating negation or third-person framing
export const NEGATION_PATTERNS: RegExp[] = [
  /\b(never|don'?t|do not|won'?t|will not|wouldn'?t|not going to)\b/i,
];

export const THIRD_PERSON_PATTERNS: RegExp[] = [
  /\b(he|she|they|them|someone|a person|a friend|my friend|people who|those who|a student)\b/i,
  /\b(the patient|the client|the individual|studies show|research|according to)\b/i,
];

export const EDUCATIONAL_PATTERNS: RegExp[] = [
  /\b(learn|study|research|school project|paper|article|book|class|course|teacher|professor)\b/i,
  /\b(according to|statistics|prevention|awareness|training|clinical|therapeutic)\b/i,
  /\b(what (is|are)|define|definition|explain|how does|why do people)\b/i,
];

export const FIRST_PERSON_PATTERNS: RegExp[] = [
  /\b(i|i'm|i am|i've|i have|i want|i need|i feel|i can't|i cannot|me|my|myself)\b/i,
];

/**
 * Self-harm patterns: cutting, self-injury, expressions of active self-harm.
 * Weighted higher for first-person statements.
 */
export const SELF_HARM_PATTERNS: PatternEntry[] = [
  {
    regex: /\b(cut(ting)? (myself|my (wrist|arm|leg|thigh)))\b/i,
    weight: 0.9,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(hurt(ing)? myself)\b/i,
    weight: 0.85,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(burn(ing)? myself)\b/i,
    weight: 0.85,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(self[- ]harm|self[- ]injur(y|e|ing))\b/i,
    weight: 0.7,
    contextRules: { reduceOnEducational: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(scratch(ing)? (myself|my skin|until))\b/i,
    weight: 0.7,
    contextRules: { requireFirstPerson: true },
  },
  {
    regex: /\b(i (deserve|need) (to be hurt|pain|punishment))\b/i,
    weight: 0.8,
    contextRules: { requireFirstPerson: true },
  },
  {
    regex: /\b(want to feel (the )?pain)\b/i,
    weight: 0.75,
    contextRules: { requireFirstPerson: true },
  },
];

/**
 * Suicidal ideation patterns: passive ideation to active planning.
 * These receive the highest priority in the system.
 */
export const SUICIDAL_IDEATION_PATTERNS: PatternEntry[] = [
  // Active ideation - highest weight
  {
    regex: /\b(kill(ing)? myself)\b/i,
    weight: 0.95,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(end (my|this) life)\b/i,
    weight: 0.95,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(take my (own )?life)\b/i,
    weight: 0.95,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(suicide (plan|method|note|letter))\b/i,
    weight: 0.95,
    contextRules: { reduceOnEducational: true },
  },
  {
    regex: /\b(want(ing)? to die)\b/i,
    weight: 0.9,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(don'?t want to (be alive|live|exist|wake up))\b/i,
    weight: 0.9,
    contextRules: { requireFirstPerson: true },
  },
  // Passive ideation
  {
    regex: /\b(better off (dead|without me|if i (was|were) gone))\b/i,
    weight: 0.85,
    contextRules: { requireFirstPerson: true, reduceOnThirdPerson: true },
  },
  {
    regex: /\b(no (reason|point) (to|in) (liv(e|ing)|go(ing)? on))\b/i,
    weight: 0.8,
    contextRules: { requireFirstPerson: true },
  },
  {
    regex: /\b(goodbye (letter|note|everyone|world|forever))\b/i,
    weight: 0.9,
    contextRules: { reduceOnEducational: true },
  },
  {
    regex: /\b(final goodbye)\b/i,
    weight: 0.85,
    contextRules: { reduceOnThirdPerson: true },
  },
  {
    regex: /\b(can'?t (go on|take (it|this) anymore|keep (going|living)))\b/i,
    weight: 0.75,
    contextRules: { requireFirstPerson: true },
  },
  {
    regex: /\b(wish i (was|were) (dead|never born))\b/i,
    weight: 0.9,
    contextRules: { requireFirstPerson: true },
  },
  {
    regex: /\b(no one (would|will) (miss me|care|notice))\b/i,
    weight: 0.8,
    contextRules: { requireFirstPerson: true },
  },
];

/**
 * Age signal patterns: indicators that the user is a minor.
 * Used in combination with other categories (especially romantic/sexual content).
 */
export const AGE_SIGNAL_PATTERNS: PatternEntry[] = [
  {
    regex: /\b(i'?m|i am) (1[0-7]|[1-9])\b/i,
    weight: 0.9,
    contextRules: {},
  },
  {
    regex: /\b(i'?m|i am) (in )?(middle school|junior high|high school|6th|7th|8th|9th|10th|11th|12th) (grade|grader)?\b/i,
    weight: 0.85,
    contextRules: {},
  },
  {
    regex: /\b(my (mom|dad|parents) (don'?t|won'?t) (let|allow) me)\b/i,
    weight: 0.6,
    contextRules: {},
  },
  {
    regex: /\b((school|class|homework|teacher) (is|was|are))\b/i,
    weight: 0.3,
    contextRules: {},
  },
  {
    regex: /\b(i'?m a (kid|minor|teen|teenager|student))\b/i,
    weight: 0.8,
    contextRules: {},
  },
  {
    regex: /\b(my age is (1[0-7]|[1-9]))\b/i,
    weight: 0.9,
    contextRules: {},
  },
  {
    regex: /\b(i (just )?turned (1[0-7]|[1-9]))\b/i,
    weight: 0.9,
    contextRules: {},
  },
  {
    regex: /\b(in (6th|7th|8th|9th|10th|11th|12th) grade)\b/i,
    weight: 0.8,
    contextRules: {},
  },
];

/**
 * Romantic escalation patterns: progression of romantic/sexual language.
 * Most concerning when combined with age signals.
 */
export const ROMANTIC_ESCALATION_PATTERNS: PatternEntry[] = [
  {
    regex: /\b(i love you|i'?m in love with you)\b/i,
    weight: 0.5,
    contextRules: {},
  },
  {
    regex: /\b(want to (kiss|hold|touch|be with) you)\b/i,
    weight: 0.7,
    contextRules: {},
  },
  {
    regex: /\b(you'?re (so )?(hot|sexy|beautiful|handsome))\b/i,
    weight: 0.6,
    contextRules: {},
  },
  {
    regex: /\b(we should (date|be together|meet up))\b/i,
    weight: 0.55,
    contextRules: {},
  },
  {
    regex: /\b(send (me )?(pics|pictures|photos|nudes))\b/i,
    weight: 0.9,
    contextRules: {},
  },
  {
    regex: /\b(what are you wearing)\b/i,
    weight: 0.7,
    contextRules: {},
  },
  {
    regex: /\b(want to see (you|your body))\b/i,
    weight: 0.75,
    contextRules: {},
  },
  {
    regex: /\b(let'?s (roleplay|rp) (something )?(romantic|sexual|intimate))\b/i,
    weight: 0.8,
    contextRules: {},
  },
];

/**
 * Dependency language patterns: unhealthy attachment/enmeshment.
 * Concerning when deepening over time (tracked at arc level).
 */
export const DEPENDENCY_LANGUAGE_PATTERNS: PatternEntry[] = [
  {
    regex: /\b(can'?t live without you)\b/i,
    weight: 0.8,
    contextRules: {},
  },
  {
    regex: /\b(you'?re (the )?only (one|person|thing) (i|that))\b/i,
    weight: 0.7,
    contextRules: {},
  },
  {
    regex: /\b(need you (so|so much|more than anything))\b/i,
    weight: 0.7,
    contextRules: {},
  },
  {
    regex: /\b(don'?t (ever )?leave me)\b/i,
    weight: 0.65,
    contextRules: {},
  },
  {
    regex: /\b(i('?d| would) die without you)\b/i,
    weight: 0.85,
    contextRules: {},
  },
  {
    regex: /\b(you'?re (my )?everything)\b/i,
    weight: 0.5,
    contextRules: {},
  },
  {
    regex: /\b(nothing matters (without|except) you)\b/i,
    weight: 0.7,
    contextRules: {},
  },
  {
    regex: /\b(only (happy|feel good|feel alive) (when|with) you)\b/i,
    weight: 0.65,
    contextRules: {},
  },
  {
    regex: /\b(promise (me )?you'?ll never leave)\b/i,
    weight: 0.6,
    contextRules: {},
  },
];

/**
 * Evaluate a text against a pattern list with context awareness.
 * Returns a score between 0 and 1.
 */
export function evaluatePatterns(
  text: string,
  patterns: PatternEntry[]
): number {
  const hasFirstPerson = FIRST_PERSON_PATTERNS.some((p) => p.test(text));
  const hasThirdPerson = THIRD_PERSON_PATTERNS.some((p) => p.test(text));
  const hasEducational = EDUCATIONAL_PATTERNS.some((p) => p.test(text));

  let maxScore = 0;
  let totalWeightedScore = 0;
  let matchCount = 0;

  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      let weight = pattern.weight;
      const rules = pattern.contextRules;

      if (rules) {
        // If first-person is required but not present, heavily reduce weight
        if (rules.requireFirstPerson && !hasFirstPerson) {
          weight *= 0.3;
        }

        // If third-person language is detected, reduce weight
        // When both first-person and third-person are present, still reduce
        // (indicates discussing someone else's situation, e.g. "How can I help her?")
        if (rules.reduceOnThirdPerson && hasThirdPerson) {
          weight *= 0.3;
        }

        // If educational context is detected, reduce weight
        if (rules.reduceOnEducational && hasEducational) {
          weight *= 0.3;
        }
      }

      maxScore = Math.max(maxScore, weight);
      totalWeightedScore += weight;
      matchCount++;
    }
  }

  if (matchCount === 0) return 0;

  // Use a combination of max match and average, biased toward the max
  // This ensures a single strong signal is not diluted, but multiple weak signals compound
  const averageScore = totalWeightedScore / matchCount;
  const compoundBonus = Math.min(0.15, matchCount * 0.03);
  const score = Math.min(1, maxScore * 0.7 + averageScore * 0.3 + compoundBonus);

  return Math.round(score * 1000) / 1000;
}
