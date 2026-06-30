/**
 * Structured Logging Module.
 *
 * Provides structured JSON logging with consistent fields across all services.
 * Log levels: debug, info, warn, error, critical.
 *
 * Every log entry includes:
 * - timestamp (ISO 8601)
 * - level
 * - service (web/worker)
 * - client_id (if in tenant context)
 * - correlation_id (request/job ID)
 * - message
 * - structured data
 *
 * Special log categories:
 * - CRISIS_PATH: all crisis routing events
 * - SCORING_FAILURE: any scoring pipeline errors
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export type LogCategory = "CRISIS_PATH" | "SCORING_FAILURE" | "GENERAL";

export type ServiceName = "web" | "worker";

export interface LogContext {
  service: ServiceName;
  clientId?: string;
  correlationId?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: ServiceName;
  category: LogCategory;
  client_id?: string;
  correlation_id?: string;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

/**
 * Transport interface for log output. Allows replacing console output
 * in tests or routing to external systems.
 */
export interface LogTransport {
  write(entry: LogEntry): void;
}

/**
 * Default transport that writes JSON to stdout/stderr.
 */
export class ConsoleTransport implements LogTransport {
  write(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    if (LOG_LEVEL_PRIORITY[entry.level] >= LOG_LEVEL_PRIORITY.error) {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  }
}

/**
 * Get the minimum log level from environment.
 */
function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return "info";
}

/**
 * Structured Logger.
 *
 * Create an instance per request/job with appropriate context,
 * then use it throughout the request lifecycle.
 */
export class Logger {
  private context: LogContext;
  private transport: LogTransport;
  private minLevel: LogLevel;

  constructor(
    context: LogContext,
    transport?: LogTransport,
    minLevel?: LogLevel
  ) {
    this.context = context;
    this.transport = transport ?? new ConsoleTransport();
    this.minLevel = minLevel ?? getMinLevel();
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private emit(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry | null {
    if (!this.shouldLog(level)) return null;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.context.service,
      category,
      message,
      ...(this.context.clientId && { client_id: this.context.clientId }),
      ...(this.context.correlationId && { correlation_id: this.context.correlationId }),
      ...(data && Object.keys(data).length > 0 && { data }),
    };

    this.transport.write(entry);
    return entry;
  }

  // General logging methods

  debug(message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.emit("debug", "GENERAL", message, data);
  }

  info(message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.emit("info", "GENERAL", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.emit("warn", "GENERAL", message, data);
  }

  error(message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.emit("error", "GENERAL", message, data);
  }

  critical(message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.emit("critical", "GENERAL", message, data);
  }

  // Category-specific logging methods

  crisisPath(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry | null {
    return this.emit(level, "CRISIS_PATH", message, data);
  }

  scoringFailure(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry | null {
    return this.emit(level, "SCORING_FAILURE", message, data);
  }

  /**
   * Create a child logger with additional context.
   */
  child(additionalContext: Partial<LogContext>): Logger {
    return new Logger(
      { ...this.context, ...additionalContext },
      this.transport,
      this.minLevel
    );
  }
}

/**
 * Create a logger for the web service (API routes).
 */
export function createWebLogger(
  correlationId?: string,
  clientId?: string
): Logger {
  return new Logger({
    service: "web",
    correlationId,
    clientId,
  });
}

/**
 * Create a logger for the worker service (BullMQ scoring worker).
 */
export function createWorkerLogger(
  correlationId?: string,
  clientId?: string
): Logger {
  return new Logger({
    service: "worker",
    correlationId,
    clientId,
  });
}
