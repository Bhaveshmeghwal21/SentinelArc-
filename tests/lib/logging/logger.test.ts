import {
  Logger,
  createWebLogger,
  createWorkerLogger,
  type LogEntry,
  type LogTransport,
} from "@/lib/logging/logger";

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

describe("Logger", () => {
  let transport: TestTransport;

  beforeEach(() => {
    transport = new TestTransport();
  });

  describe("structured output format", () => {
    it("produces log entries with all required fields", () => {
      const logger = new Logger(
        { service: "web", clientId: "client_1", correlationId: "req_abc" },
        transport,
        "debug"
      );

      logger.info("Test message", { key: "value" });

      const entry = transport.last()!;
      expect(entry).toBeDefined();
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry.level).toBe("info");
      expect(entry.service).toBe("web");
      expect(entry.category).toBe("GENERAL");
      expect(entry.client_id).toBe("client_1");
      expect(entry.correlation_id).toBe("req_abc");
      expect(entry.message).toBe("Test message");
      expect(entry.data).toEqual({ key: "value" });
    });

    it("omits client_id when not in tenant context", () => {
      const logger = new Logger(
        { service: "worker" },
        transport,
        "debug"
      );

      logger.info("No tenant");

      const entry = transport.last()!;
      expect(entry.client_id).toBeUndefined();
    });

    it("omits correlation_id when not provided", () => {
      const logger = new Logger(
        { service: "web" },
        transport,
        "debug"
      );

      logger.info("No correlation");

      const entry = transport.last()!;
      expect(entry.correlation_id).toBeUndefined();
    });

    it("omits data field when no structured data is provided", () => {
      const logger = new Logger(
        { service: "web" },
        transport,
        "debug"
      );

      logger.info("Plain message");

      const entry = transport.last()!;
      expect(entry.data).toBeUndefined();
    });

    it("omits data field when empty object is provided", () => {
      const logger = new Logger(
        { service: "web" },
        transport,
        "debug"
      );

      logger.info("Empty data", {});

      const entry = transport.last()!;
      expect(entry.data).toBeUndefined();
    });

    it("includes ISO 8601 timestamp", () => {
      const logger = new Logger(
        { service: "web" },
        transport,
        "debug"
      );

      const before = new Date().toISOString();
      logger.info("Timestamp test");
      const after = new Date().toISOString();

      const entry = transport.last()!;
      expect(entry.timestamp >= before).toBe(true);
      expect(entry.timestamp <= after).toBe(true);
    });
  });

  describe("log levels", () => {
    it("logs all levels when minLevel is debug", () => {
      const logger = new Logger({ service: "web" }, transport, "debug");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.critical("c");

      expect(transport.entries).toHaveLength(5);
      expect(transport.entries.map((e) => e.level)).toEqual([
        "debug",
        "info",
        "warn",
        "error",
        "critical",
      ]);
    });

    it("filters debug when minLevel is info", () => {
      const logger = new Logger({ service: "web" }, transport, "info");

      logger.debug("should be filtered");
      logger.info("should appear");

      expect(transport.entries).toHaveLength(1);
      expect(transport.entries[0].level).toBe("info");
    });

    it("filters debug and info when minLevel is warn", () => {
      const logger = new Logger({ service: "web" }, transport, "warn");

      logger.debug("filtered");
      logger.info("filtered");
      logger.warn("appears");
      logger.error("appears");
      logger.critical("appears");

      expect(transport.entries).toHaveLength(3);
    });

    it("only logs critical when minLevel is critical", () => {
      const logger = new Logger({ service: "web" }, transport, "critical");

      logger.debug("no");
      logger.info("no");
      logger.warn("no");
      logger.error("no");
      logger.critical("yes");

      expect(transport.entries).toHaveLength(1);
      expect(transport.entries[0].level).toBe("critical");
    });

    it("returns null when log is filtered by level", () => {
      const logger = new Logger({ service: "web" }, transport, "error");

      const result = logger.info("filtered");
      expect(result).toBeNull();
    });

    it("returns the LogEntry when log is emitted", () => {
      const logger = new Logger({ service: "web" }, transport, "debug");

      const result = logger.info("emitted");
      expect(result).not.toBeNull();
      expect(result!.message).toBe("emitted");
    });
  });

  describe("context injection", () => {
    it("injects service context into every entry", () => {
      const logger = new Logger(
        { service: "worker", clientId: "tenant_x", correlationId: "job_123" },
        transport,
        "debug"
      );

      logger.info("First");
      logger.warn("Second");

      expect(transport.entries[0].service).toBe("worker");
      expect(transport.entries[0].client_id).toBe("tenant_x");
      expect(transport.entries[0].correlation_id).toBe("job_123");
      expect(transport.entries[1].service).toBe("worker");
      expect(transport.entries[1].client_id).toBe("tenant_x");
    });

    it("child logger inherits and extends context", () => {
      const parent = new Logger(
        { service: "web", correlationId: "req_1" },
        transport,
        "debug"
      );

      const child = parent.child({ clientId: "client_abc" });
      child.info("From child");

      const entry = transport.last()!;
      expect(entry.service).toBe("web");
      expect(entry.correlation_id).toBe("req_1");
      expect(entry.client_id).toBe("client_abc");
    });

    it("child logger can override parent context", () => {
      const parent = new Logger(
        { service: "web", clientId: "old" },
        transport,
        "debug"
      );

      const child = parent.child({ clientId: "new" });
      child.info("Override");

      expect(transport.last()!.client_id).toBe("new");
    });
  });

  describe("category-specific logging", () => {
    it("crisisPath sets CRISIS_PATH category", () => {
      const logger = new Logger({ service: "web" }, transport, "debug");

      logger.crisisPath("critical", "Crisis triggered", { score: 0.95 });

      const entry = transport.last()!;
      expect(entry.category).toBe("CRISIS_PATH");
      expect(entry.level).toBe("critical");
      expect(entry.data).toEqual({ score: 0.95 });
    });

    it("scoringFailure sets SCORING_FAILURE category", () => {
      const logger = new Logger({ service: "worker" }, transport, "debug");

      logger.scoringFailure("error", "Worker crashed", { jobId: "j1" });

      const entry = transport.last()!;
      expect(entry.category).toBe("SCORING_FAILURE");
      expect(entry.level).toBe("error");
    });

    it("general logs set GENERAL category", () => {
      const logger = new Logger({ service: "web" }, transport, "debug");

      logger.info("General info");

      expect(transport.last()!.category).toBe("GENERAL");
    });
  });

  describe("factory functions", () => {
    it("createWebLogger creates a logger with web service", () => {
      const logger = createWebLogger("req_1", "client_1");
      // Verify by logging (using a new transport is not possible via factory,
      // so we just check it doesn't throw)
      expect(logger).toBeInstanceOf(Logger);
    });

    it("createWorkerLogger creates a logger with worker service", () => {
      const logger = createWorkerLogger("job_1", "client_1");
      expect(logger).toBeInstanceOf(Logger);
    });
  });
});
