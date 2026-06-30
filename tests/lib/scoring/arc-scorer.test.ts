import { scoreArc, type ArcScoreResult } from "@/lib/scoring/arc-scorer";
import type { TurnScores } from "@/lib/scoring/turn-scorer";

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

describe("Arc Scorer", () => {
  describe("Empty/minimal input", () => {
    it("should return empty arc score for no history", () => {
      const result = scoreArc([]);
      expect(result.compositeRisk).toBe(0);
      expect(result.turnCount).toBe(0);
      expect(result.trendDirection).toBe("stable");
      expect(result.escalationFlags.romanticWithMinor).toBe(false);
      expect(result.escalationFlags.suicidalEscalation).toBe(false);
    });

    it("should handle a single turn", () => {
      const result = scoreArc([makeTurnScores({ selfHarm: 0.5 })]);
      expect(result.selfHarm).toBe(0.5);
      expect(result.turnCount).toBe(1);
    });
  });

  describe("Multi-turn escalation detection", () => {
    it("should detect rising emotional intensity", () => {
      const history: TurnScores[] = [
        makeTurnScores({ emotionalIntensity: 0.1 }),
        makeTurnScores({ emotionalIntensity: 0.2 }),
        makeTurnScores({ emotionalIntensity: 0.3 }),
        makeTurnScores({ emotionalIntensity: 0.5 }),
        makeTurnScores({ emotionalIntensity: 0.7 }),
      ];
      const result = scoreArc(history);
      expect(result.trendDirection).toBe("rising");
      expect(result.escalationFlags.emotionalEscalation).toBe(true);
    });

    it("should detect stable/falling emotional intensity", () => {
      const history: TurnScores[] = [
        makeTurnScores({ emotionalIntensity: 0.9 }),
        makeTurnScores({ emotionalIntensity: 0.7 }),
        makeTurnScores({ emotionalIntensity: 0.5 }),
        makeTurnScores({ emotionalIntensity: 0.3 }),
        makeTurnScores({ emotionalIntensity: 0.1 }),
      ];
      const result = scoreArc(history);
      expect(result.trendDirection).toBe("falling");
    });

    it("should detect suicidal ideation escalation (passive to active)", () => {
      const history: TurnScores[] = [
        makeTurnScores({ selfHarm: 0.1 }),
        makeTurnScores({ selfHarm: 0.2 }),
        makeTurnScores({ selfHarm: 0.3 }),
        makeTurnScores({ selfHarm: 0.5 }),
        makeTurnScores({ selfHarm: 0.7 }),
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.suicidalEscalation).toBe(true);
    });

    it("should detect dependency language deepening", () => {
      const history: TurnScores[] = [
        makeTurnScores({ dependencyLanguage: 0.1 }),
        makeTurnScores({ dependencyLanguage: 0.2 }),
        makeTurnScores({ dependencyLanguage: 0.3 }),
        makeTurnScores({ dependencyLanguage: 0.4 }),
        makeTurnScores({ dependencyLanguage: 0.6 }),
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.dependencyDeepening).toBe(true);
    });
  });

  describe("Romantic escalation with age signals", () => {
    it("should flag when romantic content and age signal appear in same conversation", () => {
      const history: TurnScores[] = [
        makeTurnScores({ ageSignal: 0.8 }), // Minor identifies themselves
        makeTurnScores({}), // Normal turn
        makeTurnScores({}), // Normal turn
        makeTurnScores({ romanticEscalation: 0.6 }), // Romantic content later
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.romanticWithMinor).toBe(true);
    });

    it("should flag when age signal appears AFTER romantic content", () => {
      const history: TurnScores[] = [
        makeTurnScores({ romanticEscalation: 0.5 }), // Romantic first
        makeTurnScores({}),
        makeTurnScores({ ageSignal: 0.7 }), // Then age signal
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.romanticWithMinor).toBe(true);
    });

    it("should NOT flag romantic content without age signals", () => {
      const history: TurnScores[] = [
        makeTurnScores({ romanticEscalation: 0.6 }),
        makeTurnScores({ romanticEscalation: 0.7 }),
        makeTurnScores({ romanticEscalation: 0.5 }),
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.romanticWithMinor).toBe(false);
    });

    it("should NOT flag age signals without romantic content", () => {
      const history: TurnScores[] = [
        makeTurnScores({ ageSignal: 0.8 }),
        makeTurnScores({}),
        makeTurnScores({}),
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.romanticWithMinor).toBe(false);
    });
  });

  describe("Conversations safe turn-by-turn but concerning at arc level", () => {
    it("should detect slow escalation that individual turns would miss", () => {
      // Each individual turn has low self-harm, but the trend is clearly rising
      const history: TurnScores[] = [
        makeTurnScores({ selfHarm: 0.05, emotionalIntensity: 0.2 }),
        makeTurnScores({ selfHarm: 0.1, emotionalIntensity: 0.3 }),
        makeTurnScores({ selfHarm: 0.15, emotionalIntensity: 0.4 }),
        makeTurnScores({ selfHarm: 0.2, emotionalIntensity: 0.5 }),
        makeTurnScores({ selfHarm: 0.3, emotionalIntensity: 0.6 }),
        makeTurnScores({ selfHarm: 0.4, emotionalIntensity: 0.7 }),
        makeTurnScores({ selfHarm: 0.5, emotionalIntensity: 0.8 }),
      ];
      const result = scoreArc(history);
      // Even though no single turn hits crisis threshold, escalation should be detected
      expect(result.escalationFlags.suicidalEscalation).toBe(true);
      expect(result.escalationFlags.emotionalEscalation).toBe(true);
      expect(result.compositeRisk).toBeGreaterThan(0.3);
    });

    it("should detect romantic grooming pattern (safe individually)", () => {
      // Individual turns seem innocent, but the combination is concerning
      const history: TurnScores[] = [
        makeTurnScores({ ageSignal: 0.5 }), // "I'm in 8th grade"
        makeTurnScores({}), // Normal
        makeTurnScores({}), // Normal
        makeTurnScores({ romanticEscalation: 0.3 }), // Mild compliment
        makeTurnScores({}), // Normal
        makeTurnScores({ romanticEscalation: 0.4 }), // More romantic
        makeTurnScores({ dependencyLanguage: 0.3 }), // Dependency building
      ];
      const result = scoreArc(history);
      expect(result.escalationFlags.romanticWithMinor).toBe(true);
    });
  });

  describe("Sliding window", () => {
    it("should respect window size configuration", () => {
      const history: TurnScores[] = Array(20)
        .fill(null)
        .map((_, i) => makeTurnScores({ selfHarm: i < 15 ? 0.8 : 0.1 }));

      // With window of 5, only the last 5 turns matter (all 0.1)
      const result = scoreArc(history, {
        windowSize: 5,
        trendThreshold: 0.1,
        presenceThreshold: 0.3,
      });
      expect(result.selfHarm).toBe(0.1);
    });

    it("should still check full history for age signals (safety)", () => {
      // Age signal was many turns ago, but romantic content is recent
      const history: TurnScores[] = [
        makeTurnScores({ ageSignal: 0.8 }), // Turn 1: age signal
        ...Array(12).fill(null).map(() => makeTurnScores({})), // 12 normal turns
        makeTurnScores({ romanticEscalation: 0.5 }), // Turn 14: romantic
      ];
      const result = scoreArc(history, {
        windowSize: 5,
        trendThreshold: 0.1,
        presenceThreshold: 0.3,
      });
      // Full history is checked for romanticWithMinor (safety critical)
      expect(result.escalationFlags.romanticWithMinor).toBe(true);
    });
  });

  describe("Composite risk calculation", () => {
    it("should produce higher composite risk when escalation flags fire", () => {
      const safeHistory: TurnScores[] = [
        makeTurnScores({ selfHarm: 0.3 }),
        makeTurnScores({ selfHarm: 0.3 }),
        makeTurnScores({ selfHarm: 0.3 }),
      ];
      const escalatingHistory: TurnScores[] = [
        makeTurnScores({ selfHarm: 0.1 }),
        makeTurnScores({ selfHarm: 0.3 }),
        makeTurnScores({ selfHarm: 0.5 }),
      ];

      const safeResult = scoreArc(safeHistory);
      const escalatingResult = scoreArc(escalatingHistory);

      // Escalating should have higher risk despite similar max score
      expect(escalatingResult.compositeRisk).toBeGreaterThan(
        safeResult.compositeRisk
      );
    });

    it("should cap composite risk at 1.0", () => {
      const extremeHistory: TurnScores[] = Array(10)
        .fill(null)
        .map((_, i) =>
          makeTurnScores({
            selfHarm: 0.9,
            sexualContent: 0.9,
            ageSignal: 0.9,
            emotionalIntensity: 0.5 + i * 0.05,
            romanticEscalation: 0.9,
            dependencyLanguage: 0.5 + i * 0.05,
          })
        );
      const result = scoreArc(extremeHistory);
      expect(result.compositeRisk).toBeLessThanOrEqual(1);
    });
  });
});
