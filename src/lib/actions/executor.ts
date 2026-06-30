/**
 * Action Executor.
 *
 * Carries out decisions from the threshold engine.
 *
 * For SOFT_FLAG: creates Flag record, creates ReviewItem PENDING, logs to audit trail.
 * For HARD_BLOCK: creates Flag, Action record, returns block response, creates ReviewItem HIGH priority, logs audit.
 * For CRISIS_ROUTE: calls crisis router FIRST (fastest path), then creates Flag, Action, ReviewItem CRITICAL, logs audit.
 *
 * All actions write to AuditLogEntry as an immutable append-only operation.
 */

import type { ThresholdAction, ActionSeverity } from "../threshold/engine";
import { routeCrisis, type CrisisRouteResponse, type CrisisRouterDependencies } from "../crisis/router";
import { type AuditLogger } from "../audit/logger";

export interface ActionContext {
  clientId: string;
  conversationId: string;
  turnId: string;
}

export interface ActionResult {
  type: ActionSeverity;
  category: string;
  /** Flag record ID (if created) */
  flagId?: string;
  /** Action record ID (if created) */
  actionId?: string;
  /** Review item ID (if created) */
  reviewItemId?: string;
  /** Crisis route response (if crisis was triggered) */
  crisisResponse?: CrisisRouteResponse;
  /** Block response payload (if conversation was blocked) */
  blockPayload?: { blocked: boolean; reason: string };
}

/**
 * Database operations interface for action execution.
 * Allows mocking for tests.
 */
export interface ActionStore {
  createFlag(params: {
    conversationId: string;
    turnId: string;
    clientId: string;
    category: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    score: number;
    threshold: number;
    message: string;
  }): Promise<{ id: string }>;

  createAction(params: {
    flagId: string;
    clientId: string;
    type: "SOFT_FLAG" | "HARD_BLOCK" | "CRISIS_ROUTE";
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;

  createReviewItem(params: {
    flagId: string;
    clientId: string;
    status: "PENDING";
  }): Promise<{ id: string }>;
}

/**
 * Map action severity to flag severity in the database.
 */
function mapToFlagSeverity(
  type: ActionSeverity
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  switch (type) {
    case "CRISIS_ROUTE":
      return "CRITICAL";
    case "HARD_BLOCK":
      return "HIGH";
    case "SOFT_FLAG":
      return "MEDIUM";
  }
}

/**
 * Execute a single threshold action.
 */
export async function executeAction(
  action: ThresholdAction,
  context: ActionContext,
  store: ActionStore,
  auditLogger: AuditLogger,
  crisisDeps?: CrisisRouterDependencies
): Promise<ActionResult> {
  const result: ActionResult = {
    type: action.type,
    category: action.category,
  };

  // For CRISIS_ROUTE, fire the crisis router FIRST (fastest path)
  if (action.type === "CRISIS_ROUTE") {
    const crisisResponse = routeCrisis(
      {
        clientId: context.clientId,
        conversationId: context.conversationId,
        turnId: context.turnId,
        triggerCategory: action.category,
        triggerScore: action.score,
      },
      crisisDeps
    );
    result.crisisResponse = crisisResponse;
  }

  // Create flag record
  const flag = await store.createFlag({
    conversationId: context.conversationId,
    turnId: context.turnId,
    clientId: context.clientId,
    category: action.category,
    severity: mapToFlagSeverity(action.type),
    score: action.score,
    threshold: action.threshold,
    message: action.reason,
  });
  result.flagId = flag.id;

  // Create action record
  const actionRecord = await store.createAction({
    flagId: flag.id,
    clientId: context.clientId,
    type: action.type,
    metadata: {
      score: action.score,
      threshold: action.threshold,
      category: action.category,
    },
  });
  result.actionId = actionRecord.id;

  // Create review item
  const reviewItem = await store.createReviewItem({
    flagId: flag.id,
    clientId: context.clientId,
    status: "PENDING",
  });
  result.reviewItemId = reviewItem.id;

  // For HARD_BLOCK, set block payload
  if (action.type === "HARD_BLOCK") {
    result.blockPayload = {
      blocked: true,
      reason: action.reason,
    };
  }

  // Log to audit trail (immutable append-only)
  await auditLogger.log({
    clientId: context.clientId,
    actor: "system",
    action: `action.${action.type.toLowerCase()}`,
    resource: `flag:${flag.id}`,
    payload: {
      category: action.category,
      score: action.score,
      threshold: action.threshold,
      reason: action.reason,
      conversationId: context.conversationId,
      turnId: context.turnId,
      flagId: flag.id,
      actionId: actionRecord.id,
      reviewItemId: reviewItem.id,
    },
  });

  return result;
}

/**
 * Execute all actions from threshold evaluation.
 * Returns results for all actions, with crisis routing guaranteed to fire first.
 */
export async function executeActions(
  actions: ThresholdAction[],
  context: ActionContext,
  store: ActionStore,
  auditLogger: AuditLogger,
  crisisDeps?: CrisisRouterDependencies
): Promise<ActionResult[]> {
  if (actions.length === 0) return [];

  const results: ActionResult[] = [];

  // Execute crisis route actions first (most critical path)
  const crisisActions = actions.filter((a) => a.type === "CRISIS_ROUTE");
  const otherActions = actions.filter((a) => a.type !== "CRISIS_ROUTE");

  for (const action of crisisActions) {
    const result = await executeAction(action, context, store, auditLogger, crisisDeps);
    results.push(result);
  }

  for (const action of otherActions) {
    const result = await executeAction(action, context, store, auditLogger, crisisDeps);
    results.push(result);
  }

  return results;
}
