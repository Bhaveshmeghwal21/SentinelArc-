import {
  routeCrisis,
  resetCircuitBreakers,
  type CrisisRouteContext,
  type CrisisRouterDependencies,
} from "@/lib/crisis/router";

/**
 * Latency regression tests for the crisis routing path.
 *
 * These tests verify the "must never regress" invariant:
 * crisis routing must fire within 50ms even under adverse conditions.
 */
describe("Crisis Router Latency Tests", () => {
  beforeEach(() => {
    resetCircuitBreakers();
  });

  const defaultContext: CrisisRouteContext = {
    clientId: "client-123",
    conversationId: "conv-456",
    turnId: "turn-789",
    triggerCategory: "self_harm",
    triggerScore: 0.95,
  };

  describe("Under simulated queue backpressure", () => {
    it("should fire within 50ms with 1000 pending jobs simulated", () => {
      // Simulate backpressure by creating many pending promises
      // (representing 1000 jobs in the queue)
      const pendingJobs: Promise<void>[] = [];
      for (let i = 0; i < 1000; i++) {
        pendingJobs.push(
          new Promise((resolve) => setTimeout(resolve, 5000))
        );
      }

      // Crisis routing should NOT be blocked by these pending operations
      const start = performance.now();
      const response = routeCrisis(defaultContext);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
      expect(response.success).toBe(true);
      expect(response.resources.length).toBeGreaterThanOrEqual(2);

      // The reported latency should also be under 50ms
      expect(response.latencyMs).toBeLessThan(50);
    });

    it("should maintain sub-50ms latency for 100 consecutive crisis routes", () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const response = routeCrisis({
          ...defaultContext,
          conversationId: `conv-${i}`,
        });
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        expect(response.success).toBe(true);
      }

      // All latencies should be under 50ms
      const maxLatency = Math.max(...latencies);
      expect(maxLatency).toBeLessThan(50);

      // p99 should also be under 50ms
      const sorted = [...latencies].sort((a, b) => a - b);
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      expect(p99).toBeLessThan(50);
    });
  });

  describe("Under simulated slow database", () => {
    it("should not be blocked by slow database logging", () => {
      // Simulate a very slow database write (5000ms)
      const slowDbDeps: CrisisRouterDependencies = {
        logCrisisEvent: () =>
          new Promise((resolve) => setTimeout(resolve, 5000)),
        enqueueReview: () =>
          new Promise((resolve) => setTimeout(resolve, 5000)),
      };

      const start = performance.now();
      const response = routeCrisis(defaultContext, slowDbDeps);
      const elapsed = performance.now() - start;

      // Response should come back immediately, not wait for DB
      expect(elapsed).toBeLessThan(50);
      expect(response.success).toBe(true);
      expect(response.resources.length).toBeGreaterThanOrEqual(2);
    });

    it("should not be blocked even when all side effects are slow", () => {
      const allSlowDeps: CrisisRouterDependencies = {
        logCrisisEvent: () =>
          new Promise((resolve) => setTimeout(resolve, 10000)),
        enqueueReview: () =>
          new Promise((resolve) => setTimeout(resolve, 10000)),
      };

      const start = performance.now();
      const response = routeCrisis(defaultContext, allSlowDeps);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
      expect(response.success).toBe(true);
    });
  });

  describe("Under combined adverse conditions", () => {
    it("should handle slow deps + high call volume within latency targets", () => {
      const slowDeps: CrisisRouterDependencies = {
        logCrisisEvent: () =>
          new Promise((resolve) => setTimeout(resolve, 3000)),
        enqueueReview: () =>
          new Promise((resolve) => setTimeout(resolve, 3000)),
      };

      // 50 rapid-fire crisis routes with slow dependencies
      const latencies: number[] = [];
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        const response = routeCrisis(
          { ...defaultContext, conversationId: `conv-${i}` },
          slowDeps
        );
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        expect(response.success).toBe(true);
      }

      const maxLatency = Math.max(...latencies);
      expect(maxLatency).toBeLessThan(50);
    });
  });

  describe("Synchronous response guarantee", () => {
    it("should return resources synchronously (not require await)", () => {
      // routeCrisis is synchronous - this is by design for the fast path
      const response = routeCrisis(defaultContext);

      // Response should be immediately available (not a Promise)
      expect(response.resources).toBeDefined();
      expect(response.message).toBeDefined();
      expect(typeof response.message).toBe("string");
      expect(response.success).toBe(true);
    });
  });
});
