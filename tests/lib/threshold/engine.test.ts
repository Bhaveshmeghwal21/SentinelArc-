import {
  evaluateThresholds,
  enforceThresholds,
  getHighestSeverity,
  SYSTEM_MINIMUM_THRESHOLDS,
  type ClientThresholdConfig,
} from "@/lib/threshold/engine";
import type { TurnScores } from "@/lib/scoring/turn-scorer";
import type { ArcScoreResult } from "@/lib/scoring/arc-scorer";
import fc from "fast-check";

function makeTurnScores(overrides: Partial<TurnScores> = {}): TurnScores {
  return {
    selfHarm: 0,
    sexualContent: 0,
    ageSignal: 0,
    emotionalIntensity: 0,
    romanticEscalation: 0,
    dependencyLanguage: 0,
    ...overrides,
  };
}

function makeArcScore(overrides: Partial<ArcScoreResult> = {}): ArcScoreResult {
  return {
    compositeRisk: 0,
    selfHarm: 0,
    sexualContent: 0,
    ageSignal: 0,
    emotionalIntensity: 0,
    romanticEscalation: 0,
    dependencyLanguage: 0,
    trendDirection: "stable",
    turnCount: 5,
    escalationFlags: {
      romanticWithMinor: false,
      dependencyDeepening: false,
      suicidalEscalation: false,
      emotionalEscalation: false,
    },
    ...overrides,
  };
}

describe("Threshold Engine", () => {
  describe("enforceThresholds", () => {
    it("should return defaults when no client config", () => {
      const thresholds = enforceThresholds(undefined);
      expect(thresholds.crisisRoute_selfHarm).toBe(0.7);
      expect(thresholds.hardBlock_sexualWithMinor).toBe(0.6);
      expect(thresholds.softFlag_selfHarm).toBe(0.4);
    });

    it("should not allow crisis threshold below system minimum", () => {
      const thresholds = enforceThresholds({
        crisisRoute_selfHarm: 0.3, // Trying to lower below 0.7
      });
      expect(thresholds.crisisRoute_selfHarm).toBe(0.7);
    });

    it("should not allow hard block threshold below system minimum", () => {
      const thresholds = enforceThresholds({
        hardBlock_sexualWithMinor: 0.2, // Trying to lower below 0.6
      });
      expect(thresholds.hardBlock_sexualWithMinor).toBe(0.6);
    });

    it("should not allow soft flag threshold below system minimum", () => {
      const thresholds = enforceThresholds({
        softFlag_selfHarm: 0.1, // Trying to lower below 0.4
      });
      expect(thresholds.softFlag_selfHarm).toBe(0.4);
    });

    it("should allow raising soft flag thresholds", () => {
      const thresholds = enforceThresholds({
        softFlag_emotionalIntensity: 0.8, // Raising is allowed
      });
      expect(thresholds.softFlag_emotionalIntensity).toBe(0.8);
    });
  });

  describe("evaluateThresholds - basic scenarios", () => {
    it("should produce CRISIS_ROUTE when self_harm >= 0.7", () => {
      const actions = evaluateThresholds(
        makeTurnScores({ selfHarm: 0.75 }),
        null
      );
      expect(actions.some((a) => a.type === "CRISIS_ROUTE")).toBe(true);
    });

    it("should produce SOFT_FLAG for self_harm between 0.4 and 0.7", () => {
      const actions = evaluateThresholds(
        makeTurnScores({ selfHarm: 0.5 }),
        null
      );
      expect(actions.some((a) => a.type === "SOFT_FLAG" && a.category === "self_harm")).toBe(true);
      expect(actions.some((a) => a.type === "CRISIS_ROUTE")).toBe(false);
    });

    it("should produce HARD_BLOCK for sexual content + age signal combined", () => {
      const actions = evaluateThresholds(
        makeTurnScores({ sexualContent: 0.8, ageSignal: 0.8 }),
        null
      );
      expect(actions.some((a) => a.type === "HARD_BLOCK")).toBe(true);
    });

    it("should produce no actions for all-zero scores", () => {
      const actions = evaluateThresholds(makeTurnScores(), null);
      expect(actions).toHaveLength(0);
    });

    it("should produce SOFT_FLAG for elevated emotional intensity", () => {
      const actions = evaluateThresholds(
        makeTurnScores({ emotionalIntensity: 0.6 }),
        null
      );
      expect(actions.some((a) => a.type === "SOFT_FLAG" && a.category === "emotional_intensity")).toBe(true);
    });
  });

  describe("evaluateThresholds - arc-level flags", () => {
    it("should produce SOFT_FLAG when arc detects dependency deepening", () => {
      const arcScore = makeArcScore({
        escalationFlags: {
          romanticWithMinor: false,
          dependencyDeepening: true,
          suicidalEscalation: false,
          emotionalEscalation: false,
        },
      });
      const actions = evaluateThresholds(makeTurnScores(), arcScore);
      expect(actions.some((a) => a.category === "dependency_deepening_arc")).toBe(true);
    });

    it("should produce CRISIS_ROUTE when arc detects suicidal escalation with moderate turn score", () => {
      const arcScore = makeArcScore({
        compositeRisk: 0.6,
        escalationFlags: {
          romanticWithMinor: false,
          dependencyDeepening: false,
          suicidalEscalation: true,
          emotionalEscalation: false,
        },
      });
      const actions = evaluateThresholds(
        makeTurnScores({ selfHarm: 0.35 }),
        arcScore
      );
      expect(actions.some((a) => a.type === "CRISIS_ROUTE")).toBe(true);
    });

    it("should produce HARD_BLOCK when arc detects romantic with minor", () => {
      const arcScore = makeArcScore({
        escalationFlags: {
          romanticWithMinor: true,
          dependencyDeepening: false,
          suicidalEscalation: false,
          emotionalEscalation: false,
        },
      });
      const actions = evaluateThresholds(
        makeTurnScores({ romanticEscalation: 0.4 }),
        arcScore
      );
      expect(actions.some((a) => a.type === "HARD_BLOCK")).toBe(true);
    });
  });

  describe("getHighestSeverity", () => {
    it("should return null for empty actions", () => {
      expect(getHighestSeverity([])).toBeNull();
    });

    it("should return CRISIS_ROUTE when present", () => {
      const actions = evaluateThresholds(
        makeTurnScores({ selfHarm: 0.9 }),
        null
      );
      expect(getHighestSeverity(actions)).toBe("CRISIS_ROUTE");
    });
  });

  describe("Severity monotonicity", () => {
    it("should never produce less severe action for higher score", () => {
      const scores = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      let previousMaxSeverity = 0;

      for (const score of scores) {
        const actions = evaluateThresholds(
          makeTurnScores({ selfHarm: score }),
          null
        );
        const maxSeverity =
          actions.length === 0
            ? 0
            : Math.max(...actions.map((a) => severityToNumber(a.type)));
        expect(maxSeverity).toBeGreaterThanOrEqual(previousMaxSeverity);
        previousMaxSeverity = maxSeverity;
      }
    });
  });

  // ================================================================
  // PROPERTY-BASED TESTS - proving safety invariants
  // ================================================================
  describe("Property-based tests: safety invariants", () => {
    it("PROPERTY: self_harm >= crisis threshold ALWAYS produces CRISIS_ROUTE regardless of config", () => {
      fc.assert(
        fc.property(
          // Generate any self-harm score at or above the crisis threshold
          fc.double({
            min: SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm,
            max: 1,
            noNaN: true,
          }),
          // Generate random other scores
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          // Generate arbitrary client config that tries to suppress crisis routing
          fc.record({
            crisisRoute_selfHarm: fc.double({ min: 0, max: 1, noNaN: true }),
            softFlag_selfHarm: fc.double({ min: 0, max: 1, noNaN: true }),
            hardBlock_sexualWithMinor: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          (selfHarm, sexual, age, emotional, romantic, dependency, config) => {
            const scores = makeTurnScores({
              selfHarm,
              sexualContent: sexual,
              ageSignal: age,
              emotionalIntensity: emotional,
              romanticEscalation: romantic,
              dependencyLanguage: dependency,
            });

            const actions = evaluateThresholds(scores, null, config);

            // INVARIANT: CRISIS_ROUTE must be present
            const hasCrisisRoute = actions.some(
              (a) => a.type === "CRISIS_ROUTE"
            );
            return hasCrisisRoute;
          }
        ),
        { numRuns: 500 }
      );
    });

    it("PROPERTY: no configuration can suppress crisis routing for scores above system minimum", () => {
      fc.assert(
        fc.property(
          // Generate self-harm above system minimum
          fc.double({
            min: SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm,
            max: 1,
            noNaN: true,
          }),
          // Generate config with any values (including adversarial)
          fc.record({
            crisisRoute_selfHarm: fc.oneof(
              fc.constant(0), // Try to set to 0
              fc.constant(0.01), // Try to set very low
              fc.double({ min: 0, max: 1, noNaN: true }), // Any value
              fc.constant(1.0), // Try to set impossibly high
              fc.constant(999), // Try obviously invalid
            ),
          }),
          (selfHarmScore, config) => {
            const scores = makeTurnScores({ selfHarm: selfHarmScore });
            const actions = evaluateThresholds(scores, null, config as ClientThresholdConfig);
            return actions.some((a) => a.type === "CRISIS_ROUTE");
          }
        ),
        { numRuns: 500 }
      );
    });

    it("PROPERTY: action severity is monotonically non-decreasing with self_harm score", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (score1, score2) => {
            const lowerScore = Math.min(score1, score2);
            const higherScore = Math.max(score1, score2);

            const actionsLow = evaluateThresholds(
              makeTurnScores({ selfHarm: lowerScore }),
              null
            );
            const actionsHigh = evaluateThresholds(
              makeTurnScores({ selfHarm: higherScore }),
              null
            );

            const severityLow = getMaxSeverityValue(actionsLow);
            const severityHigh = getMaxSeverityValue(actionsHigh);

            return severityHigh >= severityLow;
          }
        ),
        { numRuns: 300 }
      );
    });

    it("PROPERTY: all actions (when produced) would generate at least one audit log entry", () => {
      // This test verifies the design constraint - every action type implies audit logging.
      // We test this by verifying that every action has the required fields for audit logging.
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (selfHarm, sexual, age, emotional, romantic, dependency) => {
            const scores = makeTurnScores({
              selfHarm,
              sexualContent: sexual,
              ageSignal: age,
              emotionalIntensity: emotional,
              romanticEscalation: romantic,
              dependencyLanguage: dependency,
            });
            const actions = evaluateThresholds(scores, null);

            // Every action must have the fields needed for audit logging
            for (const action of actions) {
              if (!action.type) return false;
              if (!action.category) return false;
              if (typeof action.score !== "number") return false;
              if (typeof action.threshold !== "number") return false;
              if (!action.reason) return false;
            }
            return true;
          }
        ),
        { numRuns: 300 }
      );
    });

    it("PROPERTY: enforceThresholds always returns values >= system minimums", () => {
      fc.assert(
        fc.property(
          fc.record({
            crisisRoute_selfHarm: fc.double({ min: -10, max: 10, noNaN: true }),
            softFlag_selfHarm: fc.double({ min: -10, max: 10, noNaN: true }),
            hardBlock_sexualWithMinor: fc.double({ min: -10, max: 10, noNaN: true }),
            softFlag_emotionalIntensity: fc.double({ min: -10, max: 10, noNaN: true }),
            softFlag_dependencyLanguage: fc.double({ min: -10, max: 10, noNaN: true }),
            softFlag_romanticEscalation: fc.double({ min: -10, max: 10, noNaN: true }),
          }),
          (config) => {
            const enforced = enforceThresholds(config);
            return (
              enforced.crisisRoute_selfHarm >= SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm &&
              enforced.hardBlock_sexualWithMinor >= SYSTEM_MINIMUM_THRESHOLDS.hardBlock_sexualWithMinor &&
              enforced.softFlag_selfHarm >= SYSTEM_MINIMUM_THRESHOLDS.softFlag_selfHarm
            );
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});

function severityToNumber(type: string): number {
  switch (type) {
    case "CRISIS_ROUTE":
      return 3;
    case "HARD_BLOCK":
      return 2;
    case "SOFT_FLAG":
      return 1;
    default:
      return 0;
  }
}

function getMaxSeverityValue(
  actions: Array<{ type: string }>
): number {
  if (actions.length === 0) return 0;
  return Math.max(...actions.map((a) => severityToNumber(a.type)));
}
