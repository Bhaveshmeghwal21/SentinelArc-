import {
  routeCrisis,
  resetCircuitBreakers,
  type CrisisRouteContext,
  type CrisisRouterDependencies,
} from "@/lib/crisis/router";
import { validateResources } from "@/lib/crisis/resources";

describe("Crisis Router", () => {
  beforeEach(() => {
    resetCircuitBreakers();
  });

  const defaultContext: CrisisRouteContext = {
    clientId: "client-123",
    conversationId: "conv-456",
    turnId: "turn-789",
    triggerCategory: "self_harm",
    triggerScore: 0.9,
  };

  describe("Core routing functionality", () => {
    it("should always return crisis resources", () => {
      const response = routeCrisis(defaultContext);
      expect(response.resources).toBeDefined();
      expect(response.resources.length).toBeGreaterThanOrEqual(2);
      expect(response.success).toBe(true);
    });

    it("should include at minimum one phone and one text option", () => {
      const response = routeCrisis(defaultContext);
      const hasPhone = response.resources.some(
        (r) => r.contactMethod === "phone"
      );
      const hasText = response.resources.some(
        (r) => r.contactMethod === "text"
      );
      expect(hasPhone).toBe(true);
      expect(hasText).toBe(true);
    });

    it("should include a human-readable message", () => {
      const response = routeCrisis(defaultContext);
      expect(response.message).toContain("988");
      expect(response.message).toContain("741741");
      expect(response.message.length).toBeGreaterThan(50);
    });

    it("should report latency", () => {
      const response = routeCrisis(defaultContext);
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
      expect(response.latencyMs).toBeLessThan(100);
    });

    it("should include a timestamp", () => {
      const before = new Date();
      const response = routeCrisis(defaultContext);
      const after = new Date();
      expect(response.timestamp.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(response.timestamp.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });

    it("should return valid resources that pass validation", () => {
      const response = routeCrisis(defaultContext);
      expect(validateResources(response.resources)).toBe(true);
    });
  });

  describe("Latency and reliability", () => {
    it("should complete routing within 50ms", () => {
      const start = performance.now();
      const response = routeCrisis(defaultContext);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
      expect(response.latencyMs).toBeLessThan(50);
    });

    it("should complete routing within target even with many calls", () => {
      // Simulate rapid-fire calls
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const response = routeCrisis(defaultContext);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(50);
        expect(response.success).toBe(true);
      }
    });
  });

  describe("Resilience to dependency failures", () => {
    it("should still return resources when database logging fails", () => {
      const failingDeps: CrisisRouterDependencies = {
        logCrisisEvent: jest.fn().mockRejectedValue(new Error("DB timeout")),
        enqueueReview: jest.fn().mockResolvedValue(undefined),
      };

      const response = routeCrisis(defaultContext, failingDeps);
      expect(response.success).toBe(true);
      expect(response.resources.length).toBeGreaterThanOrEqual(2);
    });

    it("should still return resources when review queue fails", () => {
      const failingDeps: CrisisRouterDependencies = {
        logCrisisEvent: jest.fn().mockResolvedValue(undefined),
        enqueueReview: jest.fn().mockRejectedValue(new Error("Queue full")),
      };

      const response = routeCrisis(defaultContext, failingDeps);
      expect(response.success).toBe(true);
      expect(response.resources.length).toBeGreaterThanOrEqual(2);
    });

    it("should still return resources when ALL dependencies fail", () => {
      const allFailingDeps: CrisisRouterDependencies = {
        logCrisisEvent: jest
          .fn()
          .mockRejectedValue(new Error("Total failure")),
        enqueueReview: jest
          .fn()
          .mockRejectedValue(new Error("Total failure")),
      };

      const response = routeCrisis(defaultContext, allFailingDeps);
      expect(response.success).toBe(true);
      expect(response.resources.length).toBeGreaterThanOrEqual(2);
    });

    it("should call side effects fire-and-forget", () => {
      const deps: CrisisRouterDependencies = {
        logCrisisEvent: jest.fn().mockResolvedValue(undefined),
        enqueueReview: jest.fn().mockResolvedValue(undefined),
      };

      routeCrisis(defaultContext, deps);
      expect(deps.logCrisisEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "client-123",
          conversationId: "conv-456",
          success: true,
        })
      );
      expect(deps.enqueueReview).toHaveBeenCalledWith(defaultContext);
    });
  });

  describe("Circuit breaker", () => {
    it("should stop calling failed dependency after threshold failures", async () => {
      const failingLog = jest
        .fn()
        .mockRejectedValue(new Error("DB down"));
      const deps: CrisisRouterDependencies = {
        logCrisisEvent: failingLog,
      };

      // Trigger enough failures to open the circuit breaker
      for (let i = 0; i < 5; i++) {
        routeCrisis(defaultContext, deps);
        // Allow promise to settle
        await new Promise((r) => setTimeout(r, 10));
      }

      // After circuit opens, the log function should stop being called
      failingLog.mockClear();
      routeCrisis(defaultContext, deps);

      // Give a moment for async calls to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(failingLog).not.toHaveBeenCalled();
    });
  });

  describe("Region handling", () => {
    it("should use US resources by default", () => {
      const response = routeCrisis(defaultContext);
      expect(response.resources.some((r) => r.region === "US")).toBe(true);
    });

    it("should fall back to US resources for unknown region", () => {
      const response = routeCrisis({
        ...defaultContext,
        region: "UNKNOWN_REGION",
      });
      expect(response.resources.length).toBeGreaterThanOrEqual(2);
      expect(response.success).toBe(true);
    });
  });
});
