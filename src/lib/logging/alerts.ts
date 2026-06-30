/**
 * Alerting Hooks Module.
 *
 * Defines alert conditions and dispatch mechanisms for operational monitoring.
 *
 * Alert conditions:
 * 1. Crisis routing failure (any error in the crisis path)
 * 2. Scoring pipeline failure (worker crashes, unhandled errors)
 * 3. Scoring latency spike (queue depth exceeds threshold)
 * 4. Audit log write failure
 *
 * Dispatch mechanisms (v1):
 * - Logs at CRITICAL level with structured alert payload (picked up by Datadog/PagerDuty)
 * - Optional webhook dispatch for real-time notifications
 */

import { Logger, type LogEntry } from "./logger";

export type AlertSeverity = "warning" | "critical" | "page";

export type AlertCondition =
  | "CRISIS_ROUTING_FAILURE"
  | "SCORING_PIPELINE_FAILURE"
  | "SCORING_LATENCY_SPIKE"
  | "AUDIT_LOG_WRITE_FAILURE";

export interface AlertPayload {
  condition: AlertCondition;
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

/**
 * Default queue depth threshold before latency spike alert fires.
 */
const DEFAULT_QUEUE_DEPTH_THRESHOLD = 1000;

/**
 * Dispatch an alert via webhook (non-blocking, fire-and-forget).
 */
async function dispatchWebhook(
  payload: AlertPayload,
  config: WebhookConfig
): Promise<boolean> {
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    // Webhook failures must not block the alert path
    return false;
  }
}

/**
 * Get webhook configuration from environment.
 */
function getWebhookConfig(): WebhookConfig | null {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return null;
  return { url };
}

/**
 * AlertDispatcher handles evaluating conditions and dispatching alerts.
 */
export class AlertDispatcher {
  private logger: Logger;
  private webhookConfig: WebhookConfig | null;
  private queueDepthThreshold: number;

  constructor(
    logger: Logger,
    webhookConfig?: WebhookConfig | null,
    queueDepthThreshold?: number
  ) {
    this.logger = logger;
    this.webhookConfig = webhookConfig !== undefined ? webhookConfig : getWebhookConfig();
    this.queueDepthThreshold = queueDepthThreshold ?? DEFAULT_QUEUE_DEPTH_THRESHOLD;
  }

  /**
   * Fire an alert for crisis routing failure.
   * Always dispatched at CRITICAL/page severity.
   */
  alertCrisisRoutingFailure(context: {
    clientId: string;
    conversationId: string;
    error: string;
    turnId?: string;
  }): LogEntry | null {
    const payload = this.buildPayload(
      "CRISIS_ROUTING_FAILURE",
      "page",
      `Crisis routing failed for client ${context.clientId}: ${context.error}`,
      context
    );

    this.dispatchAsync(payload);

    return this.logger.crisisPath("critical", payload.message, {
      alert: payload,
    });
  }

  /**
   * Fire an alert for scoring pipeline failure.
   */
  alertScoringPipelineFailure(context: {
    clientId: string;
    jobId?: string;
    error: string;
    turnId?: string;
    conversationId?: string;
  }): LogEntry | null {
    const payload = this.buildPayload(
      "SCORING_PIPELINE_FAILURE",
      "critical",
      `Scoring pipeline failure for client ${context.clientId}: ${context.error}`,
      context
    );

    this.dispatchAsync(payload);

    return this.logger.scoringFailure("critical", payload.message, {
      alert: payload,
    });
  }

  /**
   * Fire an alert for scoring latency spike (queue depth threshold exceeded).
   */
  alertScoringLatencySpike(context: {
    queueDepth: number;
    threshold?: number;
  }): LogEntry | null {
    const threshold = context.threshold ?? this.queueDepthThreshold;

    if (context.queueDepth < threshold) {
      return null; // Below threshold, no alert
    }

    const payload = this.buildPayload(
      "SCORING_LATENCY_SPIKE",
      "warning",
      `Scoring queue depth ${context.queueDepth} exceeds threshold ${threshold}`,
      context
    );

    this.dispatchAsync(payload);

    return this.logger.scoringFailure("error", payload.message, {
      alert: payload,
    });
  }

  /**
   * Fire an alert for audit log write failure.
   */
  alertAuditLogWriteFailure(context: {
    clientId: string;
    error: string;
    action?: string;
  }): LogEntry | null {
    const payload = this.buildPayload(
      "AUDIT_LOG_WRITE_FAILURE",
      "critical",
      `Audit log write failed for client ${context.clientId}: ${context.error}`,
      context
    );

    this.dispatchAsync(payload);

    return this.logger.critical(payload.message, { alert: payload });
  }

  private buildPayload(
    condition: AlertCondition,
    severity: AlertSeverity,
    message: string,
    context: Record<string, unknown>
  ): AlertPayload {
    return {
      condition,
      severity,
      message,
      timestamp: new Date().toISOString(),
      context,
    };
  }

  private dispatchAsync(payload: AlertPayload): void {
    if (this.webhookConfig) {
      // Fire and forget
      dispatchWebhook(payload, this.webhookConfig).catch(() => {
        // Webhook dispatch failure is swallowed - we already logged the alert
      });
    }
  }
}

/**
 * Create an AlertDispatcher with default configuration.
 */
export function createAlertDispatcher(logger: Logger): AlertDispatcher {
  return new AlertDispatcher(logger);
}
