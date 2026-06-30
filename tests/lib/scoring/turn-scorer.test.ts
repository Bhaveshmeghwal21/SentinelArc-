import { scoreTurn, MockModerationProvider, type TurnScorerConfig } from "@/lib/scoring/turn-scorer";

const testConfig: TurnScorerConfig = {
  ruleWeight: 1.0, // Use only rule-based scoring for deterministic tests
  moderationProvider: new MockModerationProvider(),
};

describe("Turn Scorer", () => {
  describe("Self-harm language detection", () => {
    it("should score high for clear first-person self-harm language", async () => {
      const scores = await scoreTurn(
        "I've been cutting myself on my wrists. I can't stop.",
        testConfig
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.7);
    });

    it("should score high for active suicidal ideation", async () => {
      const scores = await scoreTurn(
        "I want to kill myself. I've made a plan.",
        testConfig
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.8);
    });

    it("should score high for wanting to die", async () => {
      const scores = await scoreTurn("I don't want to be alive anymore.", testConfig);
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.7);
    });

    it("should score high for goodbye letter language", async () => {
      const scores = await scoreTurn(
        "This is my goodbye letter to everyone. I've made up my mind.",
        testConfig
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.7);
    });

    it("should score high for 'better off dead' statements", async () => {
      const scores = await scoreTurn(
        "Everyone would be better off if I was gone.",
        testConfig
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect passive suicidal ideation", async () => {
      const scores = await scoreTurn(
        "I wish I were never born. There's no point in going on.",
        testConfig
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.7);
    });

    it("should detect burning self-harm", async () => {
      const scores = await scoreTurn(
        "I've been burning myself with cigarettes. It makes me feel better.",
        testConfig
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("False positive prevention (educational/third-person)", () => {
    it("should score low for third-person discussion of self-harm", async () => {
      const scores = await scoreTurn(
        "A friend of mine has been struggling with self-harm. She mentioned cutting herself. How can I help her?",
        testConfig
      );
      expect(scores.selfHarm).toBeLessThan(0.5);
    });

    it("should score low for educational content about suicide prevention", async () => {
      const scores = await scoreTurn(
        "According to research, suicide prevention awareness training helps people learn to identify warning signs and connect those in need with appropriate resources.",
        testConfig
      );
      expect(scores.selfHarm).toBeLessThan(0.4);
    });

    it("should score low for discussing self-harm in clinical context", async () => {
      const scores = await scoreTurn(
        "Studies show that individuals who engage in self-injury often use it as a coping mechanism. Therapeutic interventions include DBT and CBT.",
        testConfig
      );
      expect(scores.selfHarm).toBeLessThan(0.4);
    });

    it("should score low for asking a question about what self-harm is", async () => {
      const scores = await scoreTurn(
        "What is self-harm? I'm writing a paper about it for my psychology class.",
        testConfig
      );
      expect(scores.selfHarm).toBeLessThan(0.4);
    });

    it("should distinguish first-person from third-person crisis language", async () => {
      const firstPerson = await scoreTurn(
        "I want to end my life. I can't take it anymore.",
        testConfig
      );
      const thirdPerson = await scoreTurn(
        "They said they wanted to end their life. The counselor intervened.",
        testConfig
      );
      expect(firstPerson.selfHarm).toBeGreaterThan(thirdPerson.selfHarm);
    });
  });

  describe("Romantic escalation with age signals", () => {
    it("should detect age signals in statements about being a minor", async () => {
      const scores = await scoreTurn("I'm 14 years old.", testConfig);
      expect(scores.ageSignal).toBeGreaterThanOrEqual(0.5);
    });

    it("should detect age signals in school references", async () => {
      const scores = await scoreTurn("I'm in 8th grade.", testConfig);
      expect(scores.ageSignal).toBeGreaterThanOrEqual(0.5);
    });

    it("should score romantic escalation", async () => {
      const scores = await scoreTurn(
        "I love you so much. I want to kiss you.",
        testConfig
      );
      expect(scores.romanticEscalation).toBeGreaterThanOrEqual(0.5);
    });

    it("should score explicit sexual content requests", async () => {
      const scores = await scoreTurn("Send me nudes.", testConfig);
      expect(scores.sexualContent).toBeGreaterThanOrEqual(0.7);
      expect(scores.romanticEscalation).toBeGreaterThanOrEqual(0.7);
    });

    it("should detect dependency language", async () => {
      const scores = await scoreTurn(
        "I can't live without you. You're the only person I have.",
        testConfig
      );
      expect(scores.dependencyLanguage).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("Edge cases", () => {
    it("should return zeros for empty content", async () => {
      const scores = await scoreTurn("", testConfig);
      expect(scores.selfHarm).toBe(0);
      expect(scores.sexualContent).toBe(0);
      expect(scores.ageSignal).toBe(0);
      expect(scores.emotionalIntensity).toBe(0);
      expect(scores.romanticEscalation).toBe(0);
      expect(scores.dependencyLanguage).toBe(0);
    });

    it("should return zeros for whitespace-only content", async () => {
      const scores = await scoreTurn("   \t\n  ", testConfig);
      expect(scores.selfHarm).toBe(0);
    });

    it("should handle very long content without throwing", async () => {
      const longContent = "I feel sad today. ".repeat(1000);
      const scores = await scoreTurn(longContent, testConfig);
      expect(scores).toBeDefined();
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0);
    });

    it("should handle content with special characters", async () => {
      const scores = await scoreTurn(
        "Hello! @#$%^&*() <script>alert('xss')</script>",
        testConfig
      );
      expect(scores).toBeDefined();
      expect(scores.selfHarm).toBe(0);
    });

    it("should handle non-English content gracefully (not crash)", async () => {
      const scores = await scoreTurn(
        "Je me sens tres triste aujourd'hui. La vie est difficile.",
        testConfig
      );
      expect(scores).toBeDefined();
      // Non-English content should not trigger high scores (may produce low false positives)
      expect(scores.selfHarm).toBeLessThan(0.5);
    });

    it("should score all categories between 0 and 1", async () => {
      const scores = await scoreTurn(
        "I want to kill myself. I'm 14. Send me nudes. I can't live without you. I'm so scared and alone.",
        testConfig
      );
      for (const value of Object.values(scores)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Emotional intensity", () => {
    it("should detect high emotional intensity", async () => {
      const scores = await scoreTurn(
        "I'm so scared and desperate. I can't handle this anymore. I feel helpless and alone.",
        testConfig
      );
      expect(scores.emotionalIntensity).toBeGreaterThanOrEqual(0.5);
    });

    it("should score low for neutral content", async () => {
      const scores = await scoreTurn(
        "Today I went to the store and bought some groceries. The weather was nice.",
        testConfig
      );
      expect(scores.emotionalIntensity).toBe(0);
    });
  });

  describe("API provider integration", () => {
    it("should use API scores when provider returns values", async () => {
      const customProvider = {
        analyze: jest.fn().mockResolvedValue({
          selfHarm: 0.8,
          sexualContent: 0,
          ageSignal: 0,
          emotionalIntensity: 0.5,
          romanticEscalation: 0,
          dependencyLanguage: 0,
        }),
        isAvailable: () => true,
      };

      const configWithApi: TurnScorerConfig = {
        ruleWeight: 0.5,
        moderationProvider: customProvider,
      };

      // Content that has no rule-based matches but API returns high score
      const scores = await scoreTurn("Everything is fine.", configWithApi);
      // API score of 0.8 should flow through
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.7);
      expect(customProvider.analyze).toHaveBeenCalledWith("Everything is fine.");
    });

    it("should gracefully handle API provider failure", async () => {
      const failingProvider = {
        analyze: jest.fn().mockRejectedValue(new Error("API timeout")),
        isAvailable: () => true,
      };

      const configWithFailingApi: TurnScorerConfig = {
        ruleWeight: 0.5,
        moderationProvider: failingProvider,
      };

      // Should still produce scores from rules without throwing
      const scores = await scoreTurn(
        "I want to kill myself",
        configWithFailingApi
      );
      expect(scores.selfHarm).toBeGreaterThanOrEqual(0.5);
    });

    it("should skip API when provider is unavailable", async () => {
      const unavailableProvider = {
        analyze: jest.fn(),
        isAvailable: () => false,
      };

      const configUnavailable: TurnScorerConfig = {
        ruleWeight: 0.8,
        moderationProvider: unavailableProvider,
      };

      await scoreTurn("I want to kill myself", configUnavailable);
      expect(unavailableProvider.analyze).not.toHaveBeenCalled();
    });
  });
});
