import { Logger, type LogEntry, type LogTransport } from "@/lib/logging/logger";
import { AlertDispatcher } from "@/lib/logging/alerts";

/**
 * Test transport that captures log entries in memory.
 */
class TestTransport implements LogTransport {
  public entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries = [];
  }

  last(): LogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }
}

describe("AlertDispatcher", () => {
  let transport: TestTransport;
  let logger: Logger;
  let dispatcher: AlertDispatcher;

  beforeEach(() => {
    transport = new TestTransport();
    logger = new Logger({ service: "worker" }, transport, "debug");
    dispatcher = new AlertDispatcher(logger, null);
  });

  describe("alertCrisisRoutingFailure", () => {
    it("always alerts at CRITICAL level", () => {
      dispatcher.alertCrisisRoutingFailure({
        clientId: "client_1",
        conversationId: "conv_1",
        error: "Resource fetch failed",
      });

      expect(transport.entries).toHaveLength(1);
      const entry = transport.last()!;
      expect(entry.level).toBe("critical");
      expect(entry.category).toBe("CRISIS_PATH");
    });

    it("includes structured alert payload in data", () => {
      dispatcher.alertCrisisRoutingFailure({
        clientId: "client_1",
        conversationId: "conv_1",
        error: "Connection timeout",
        turnId: "turn_1",
      });

      const entry = transport.last()!;
      expect(entry.data).toBeDefined();
      expect(entry.data!.alert).toBeDefined();

      const alert = entry.data!.alert as Record<string, unknown>;
      expect(alert.condition).toBe("CRISIS_ROUTING_FAILURE");
      expect(alert.severity).toBe("page");
      expect(alert.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("includes context details in alert payload", () => {
      dispatcher.alertCrisisRoutingFailure({
        clientId: "client_xyz",
        conversationId: "conv_abc",
        error: "Timeout exceeded",
        turnId: "turn_99",
      });

      const entry = transport.last()!;
      const alert = entry.data!.alert as Record<string, unknown>;
      const context = alert.context as Record<string, unknown>;
      expect(context.clientId).toBe("client_xyz");
      expect(context.conversationId).toBe("conv_abc");
      expect(context.error).toBe("Timeout exceeded");
      expect(context.turnId).toBe("turn_99");
    });

    it("returns the log entry", () => {
      const result = dispatcher.alertCrisisRoutingFailure({
        clientId: "c1",
        conversationId: "cv1",
        error: "err",
      });

      expect(result).not.toBeNull();
      expect(result!.level).toBe("critical");
    });
  });

  describe("alertScoringPipelineFailure", () => {
    it("logs at CRITICAL level with SCORING_FAILURE category", () => {
      dispatcher.alertScoringPipelineFailure({
        clientId: "client_1",
        error: "Worker OOM",
        jobId: "job_1",
      });

      const entry = transport.last()!;
      expect(entry.level).toBe("critical");
      expect(entry.category).toBe("SCORING_FAILURE");
    });

    it("includes job and turn context when available", () => {
      dispatcher.alertScoringPipelineFailure({
        clientId: "client_1",
        error: "Unhandled rejection",
        jobId: "job_abc",
        turnId: "turn_def",
        conversationId: "conv_ghi",
      });

      const entry = transport.last()!;
      const alert = entry.data!.alert as Record<string, unknown>;
      expect(alert.condition).toBe("SCORING_PIPELINE_FAILURE");

      const context = alert.context as Record<string, unknown>;
      expect(context.jobId).toBe("job_abc");
      expect(context.turnId).toBe("turn_def");
      expect(context.conversationId).toBe("conv_ghi");
    });
  });

  describe("alertScoringLatencySpike", () => {
    it("does not alert when queue depth is below threshold", () => {
      const result = dispatcher.alertScoringLatencySpike({
        queueDepth: 500,
        threshold: 1000,
      });

      expect(result).toBeNull();
      expect(transport.entries).toHaveLength(0);
    });

    it("alerts when queue depth exceeds threshold", () => {
      const result = dispatcher.alertScoringLatencySpike({
        queueDepth: 1500,
        threshold: 1000,
      });

      expect(result).not.toBeNull();
      expect(transport.entries).toHaveLength(1);

      const entry = transport.last()!;
      expect(entry.level).toBe("error");
      expect(entry.category).toBe("SCORING_FAILURE");
    });

    it("alerts at exactly the threshold boundary", () => {
      const result = dispatcher.alertScoringLatencySpike({
        queueDepth: 1000,
        threshold: 1000,
      });

      expect(result).not.toBeNull();
    });

    it("uses default threshold when not specified", () => {
      // Default threshold is 1000
      const resultBelow = dispatcher.alertScoringLatencySpike({
        queueDepth: 999,
      });
      expect(resultBelow).toBeNull();

      const resultAbove = dispatcher.alertScoringLatencySpike({
        queueDepth: 1001,
      });
      expect(resultAbove).not.toBeNull();
    });

    it("uses custom threshold from constructor", () => {
      const customDispatcher = new AlertDispatcher(logger, null, 50);

      const result = customDispatcher.alertScoringLatencySpike({
        queueDepth: 51,
      });

      expect(result).not.toBeNull();
    });

    it("includes queue depth info in alert", () => {
      dispatcher.alertScoringLatencySpike({
        queueDepth: 2000,
        threshold: 1000,
      });

      const entry = transport.last()!;
      expect(entry.message).toContain("2000");
      expect(entry.message).toContain("1000");
    });
  });

  describe("alertAuditLogWriteFailure", () => {
    it("logs at CRITICAL level with GENERAL category", () => {
      dispatcher.alertAuditLogWriteFailure({
        clientId: "client_1",
        error: "Database connection lost",
      });

      const entry = transport.last()!;
      expect(entry.level).toBe("critical");
      expect(entry.category).toBe("GENERAL");
    });

    it("includes the action context when provided", () => {
      dispatcher.alertAuditLogWriteFailure({
        clientId: "client_1",
        error: "Write timeout",
        action: "action.crisis_route",
      });

      const entry = transport.last()!;
      const alert = entry.data!.alert as Record<string, unknown>;
      const context = alert.context as Record<string, unknown>;
      expect(context.action).toBe("action.crisis_route");
    });
  });

  describe("webhook dispatch", () => {
    it("dispatches to webhook when configured", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock;

      const webhookDispatcher = new AlertDispatcher(
        logger,
        { url: "https://hooks.example.com/alert" }
      );

      webhookDispatcher.alertCrisisRoutingFailure({
        clientId: "client_1",
        conversationId: "conv_1",
        error: "Test error",
      });

      // Wait for async webhook dispatch
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.example.com/alert",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("does not dispatch webhook when not configured", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      dispatcher.alertCrisisRoutingFailure({
        clientId: "client_1",
        conversationId: "conv_1",
        error: "Test error",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("swallows webhook failures without blocking alert", async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = fetchMock;

      const webhookDispatcher = new AlertDispatcher(
        logger,
        { url: "https://hooks.example.com/alert" }
      );

      // Should not throw
      const result = webhookDispatcher.alertCrisisRoutingFailure({
        clientId: "client_1",
        conversationId: "conv_1",
        error: "Test error",
      });

      expect(result).not.toBeNull();
      expect(transport.entries).toHaveLength(1);

      // Wait for async webhook to settle
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  describe("crisis path failures always alert at CRITICAL", () => {
    it("crisis routing failure is always CRITICAL regardless of context", () => {
      dispatcher.alertCrisisRoutingFailure({
        clientId: "any",
        conversationId: "any",
        error: "any error",
      });

      expect(transport.entries.every((e) => e.level === "critical")).toBe(true);
    });

    it("multiple crisis alerts are all CRITICAL", () => {
      dispatcher.alertCrisisRoutingFailure({
        clientId: "c1",
        conversationId: "cv1",
        error: "error 1",
      });
      dispatcher.alertCrisisRoutingFailure({
        clientId: "c2",
        conversationId: "cv2",
        error: "error 2",
      });
      dispatcher.alertCrisisRoutingFailure({
        clientId: "c3",
        conversationId: "cv3",
        error: "error 3",
      });

      expect(transport.entries).toHaveLength(3);
      transport.entries.forEach((entry) => {
        expect(entry.level).toBe("critical");
        expect(entry.category).toBe("CRISIS_PATH");
      });
    });
  });
});
