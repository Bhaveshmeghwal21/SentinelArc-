/**
 * Usage tracking module for billing.
 *
 * Tracks conversation and turn counts per client per billing period.
 * Called from the ingestion pipeline to maintain real-time usage data.
 * Includes overage detection and alerting when client approaches plan limit.
 */

import { prisma } from "@/lib/prisma";
import { PLAN_CONFIGS } from "./stripe";

export interface UsageRecord {
  clientId: string;
  conversationCount: number;
  turnCount: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface UsageAlert {
  clientId: string;
  currentUsage: number;
  limit: number;
  percentUsed: number;
  alertLevel: "warning" | "critical" | "exceeded";
}

/** Alert thresholds as percentages of plan limit */
const ALERT_THRESHOLDS = {
  warning: 0.8, // 80%
  critical: 0.95, // 95%
  exceeded: 1.0, // 100%
} as const;

/**
 * Get the current billing period boundaries (1st of month to 1st of next month).
 */
export function getCurrentBillingPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

/**
 * Get or create the usage record for the current billing period.
 */
export async function getOrCreateUsageRecord(
  clientId: string
): Promise<UsageRecord> {
  const { start, end } = getCurrentBillingPeriod();

  // Try to find existing record
  const existing = await prisma.billingUsage.findFirst({
    where: {
      clientId,
      periodStart: start,
      periodEnd: end,
    },
  });

  if (existing) {
    return {
      clientId: existing.clientId,
      conversationCount: existing.conversationCount,
      turnCount: existing.turnCount,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
    };
  }

  // Create new record for this period
  const created = await prisma.billingUsage.create({
    data: {
      clientId,
      periodStart: start,
      periodEnd: end,
      conversationCount: 0,
      turnCount: 0,
    },
  });

  return {
    clientId: created.clientId,
    conversationCount: created.conversationCount,
    turnCount: created.turnCount,
    periodStart: created.periodStart,
    periodEnd: created.periodEnd,
  };
}

/**
 * Increment conversation count for a client in the current billing period.
 * Uses Prisma's atomic increment to avoid race conditions under concurrent requests.
 */
export async function incrementConversationCount(
  clientId: string
): Promise<UsageRecord> {
  const { start, end } = getCurrentBillingPeriod();

  // Ensure the record exists
  const record = await getOrCreateUsageRecord(clientId);

  const updated = await prisma.billingUsage.updateMany({
    where: {
      clientId,
      periodStart: start,
      periodEnd: end,
    },
    data: {
      conversationCount: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    // Record was just created in getOrCreateUsageRecord
    return { ...record, conversationCount: 1 };
  }

  return { ...record, conversationCount: record.conversationCount + 1 };
}

/**
 * Increment turn count for a client in the current billing period.
 * Uses Prisma's atomic increment to avoid race conditions under concurrent requests.
 */
export async function incrementTurnCount(
  clientId: string
): Promise<UsageRecord> {
  const { start, end } = getCurrentBillingPeriod();

  // Ensure the record exists
  const record = await getOrCreateUsageRecord(clientId);

  const updated = await prisma.billingUsage.updateMany({
    where: {
      clientId,
      periodStart: start,
      periodEnd: end,
    },
    data: {
      turnCount: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    return { ...record, turnCount: 1 };
  }

  return { ...record, turnCount: record.turnCount + 1 };
}

/**
 * Check if a client is approaching or has exceeded their plan limit.
 * Returns an alert if usage is at or above warning threshold.
 */
export function checkUsageAlert(
  conversationCount: number,
  planTier: string
): UsageAlert | null {
  const planConfig = PLAN_CONFIGS[planTier];
  if (!planConfig) return null;

  const limit = planConfig.conversationLimit;
  const percentUsed = conversationCount / limit;

  if (percentUsed >= ALERT_THRESHOLDS.exceeded) {
    return {
      clientId: "",
      currentUsage: conversationCount,
      limit,
      percentUsed,
      alertLevel: "exceeded",
    };
  }

  if (percentUsed >= ALERT_THRESHOLDS.critical) {
    return {
      clientId: "",
      currentUsage: conversationCount,
      limit,
      percentUsed,
      alertLevel: "critical",
    };
  }

  if (percentUsed >= ALERT_THRESHOLDS.warning) {
    return {
      clientId: "",
      currentUsage: conversationCount,
      limit,
      percentUsed,
      alertLevel: "warning",
    };
  }

  return null;
}

/**
 * Track usage for a new conversation turn.
 * Called from the ingestion pipeline.
 */
export async function trackTurnUsage(
  clientId: string,
  isNewConversation: boolean
): Promise<{ usage: UsageRecord; alert: UsageAlert | null }> {
  // Increment turn count always
  let usage = await incrementTurnCount(clientId);

  // Increment conversation count for new conversations
  if (isNewConversation) {
    usage = await incrementConversationCount(clientId);
  }

  // Look up client plan to check limits
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { planTier: true },
  });

  const alert = client
    ? checkUsageAlert(usage.conversationCount, client.planTier)
    : null;

  if (alert) {
    alert.clientId = clientId;
  }

  return { usage, alert };
}
