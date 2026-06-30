/**
 * Crisis Routing Module.
 *
 * This is the FASTEST, MOST RELIABLE path in the system.
 *
 * Design principles:
 * 1. Must function even if scoring pipeline, database writes, or review queue
 *    are experiencing degradation.
 * 2. Returns crisis resources SYNCHRONOUSLY - does not depend on any async process.
 * 3. Logs CrisisRouteEvent with precise latency measurement.
 * 4. Simultaneously enqueues a high-priority review item (fire-and-forget).
 * 5. Includes circuit breaker pattern for any external dependencies.
 *
 * This module must NEVER throw an exception that prevents crisis resources from
 * being delivered to the user.
 */

import {
  type CrisisResource,
  getDefaultResources,
  getResourcesForRegion,
  validateResources,
} from "./resources";
import { Logger, createWebLogger } from "../logging/logger";

export interface CrisisRouteContext {
  clientId: string;
  conversationId: string;
  turnId?: string;
  region?: string;
  /** Category that triggered crisis routing */
  triggerCategory: string;
  /** Score that triggered crisis routing */
  triggerScore: number;
}

export interface CrisisRouteResponse {
  /** Crisis resources to show the user */
  resources: CrisisResource[];
  /** Human-readable message to show alongside resources */
  message: string;
  /** Whether the route was successful */
  success: boolean;
  /** Latency of the routing decision in milliseconds */
  latencyMs: number;
  /** Timestamp of the routing event */
  timestamp: Date;
}

/**
 * Circuit breaker state for external dependencies.
 * If a dependency fails too many times, we stop calling it to maintain speed.
 * Scoped per-client to prevent one client's failures from affecting others.
 */
interface CircuitBreaker {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

/** Per-client circuit breaker map. Each client gets independent failure tracking. */
const circuitBreakers = new Map<string, CircuitBreaker>();

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 30_000; // 30 seconds

/**
 * Get or create a circuit breaker for a specific client.
 */
function getCircuitBreaker(clientId: string): CircuitBreaker {
  let breaker = circuitBreakers.get(clientId);
  if (!breaker) {
    breaker = { failures: 0, lastFailure: 0, isOpen: false };
    circuitBreakers.set(clientId, breaker);
  }
  return breaker;
}

/**
 * Check circuit breaker state and optionally reset if enough time has passed.
 */
function checkCircuitBreaker(breaker: CircuitBreaker): boolean {
  if (!breaker.isOpen) return false;

  const now = Date.now();
  if (now - breaker.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    // Reset - allow retry
    breaker.isOpen = false;
    breaker.failures = 0;
    return false;
  }

  return true; // Circuit is open, skip dependency
}

/**
 * Record a failure on a circuit breaker.
 */
function recordFailure(breaker: CircuitBreaker): void {
  breaker.failures++;
  breaker.lastFailure = Date.now();
  if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    breaker.isOpen = true;
  }
}

/**
 * Record a success on a circuit breaker.
 */
function recordSuccess(breaker: CircuitBreaker): void {
  breaker.failures = 0;
  breaker.isOpen = false;
}

/**
 * Callback interfaces for side effects.
 * These are fire-and-forget - failures do NOT block crisis response delivery.
 */
export interface CrisisRouterDependencies {
  /** Log the crisis route event to the database */
  logCrisisEvent?: (event: {
    clientId: string;
    conversationId: string;
    resourceShown: string;
    latencyMs: number;
    success: boolean;
  }) => Promise<void>;
  /** Enqueue a high-priority review item */
  enqueueReview?: (context: CrisisRouteContext) => Promise<void>;
  /** Optional structured logger instance */
  logger?: Logger;
}

/** Default no-op dependencies */
const DEFAULT_DEPENDENCIES: CrisisRouterDependencies = {};

/**
 * Route a crisis event.
 *
 * This function ALWAYS returns crisis resources. It will never throw.
 * Side effects (logging, review queue) are fire-and-forget.
 *
 * @param context - The crisis routing context
 * @param deps - Injectable dependencies for side effects
 * @returns Crisis route response with resources and metadata
 */
export function routeCrisis(
  context: CrisisRouteContext,
  deps: CrisisRouterDependencies = DEFAULT_DEPENDENCIES
): CrisisRouteResponse {
  const logger = deps.logger ?? createWebLogger(context.turnId, context.clientId);
  const startTime = performance.now();

  logger.crisisPath("info", "Crisis routing initiated", {
    clientId: context.clientId,
    conversationId: context.conversationId,
    turnId: context.turnId,
    triggerCategory: context.triggerCategory,
    triggerScore: context.triggerScore,
    region: context.region,
  });

  // Get appropriate resources - this is a pure synchronous operation
  let resources: CrisisResource[];
  try {
    resources = getResourcesForRegion(context.region);
    if (!validateResources(resources)) {
      logger.crisisPath("warn", "Resource validation failed, using defaults", {
        region: context.region,
      });
      // Fallback to guaranteed defaults
      resources = getDefaultResources();
    }
  } catch (err) {
    logger.crisisPath("critical", "Failed to fetch resources, using absolute fallback", {
      error: err instanceof Error ? err.message : String(err),
      clientId: context.clientId,
      conversationId: context.conversationId,
    });
    // Absolute fallback - this should never happen, but safety first
    resources = getDefaultResources();
  }

  const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;

  const response: CrisisRouteResponse = {
    resources,
    message: buildCrisisMessage(resources),
    success: true,
    latencyMs,
    timestamp: new Date(),
  };

  logger.crisisPath("info", "Crisis routing completed successfully", {
    clientId: context.clientId,
    conversationId: context.conversationId,
    latencyMs,
    resourceCount: resources.length,
  });

  // Fire-and-forget side effects - these MUST NOT block the response
  fireSideEffects(context, response, deps);

  return response;
}

/**
 * Build a human-readable crisis message from resources.
 */
function buildCrisisMessage(resources: CrisisResource[]): string {
  const phone = resources.find((r) => r.contactMethod === "phone");
  const text = resources.find((r) => r.contactMethod === "text");

  let message =
    "If you or someone you know is in crisis, please reach out for help:\n\n";

  if (phone) {
    message += `Call ${phone.name}: ${phone.contactValue}\n`;
  }
  if (text) {
    message += `${text.name}: ${text.contactValue}\n`;
  }

  message += "\nYou are not alone. Help is available 24/7.";

  return message;
}

/**
 * Fire side effects asynchronously without blocking the crisis response.
 */
function fireSideEffects(
  context: CrisisRouteContext,
  response: CrisisRouteResponse,
  deps: CrisisRouterDependencies
): void {
  const breaker = getCircuitBreaker(context.clientId);

  // Log crisis event (fire-and-forget with per-client circuit breaker)
  if (deps.logCrisisEvent && !checkCircuitBreaker(breaker)) {
    deps
      .logCrisisEvent({
        clientId: context.clientId,
        conversationId: context.conversationId,
        resourceShown: response.resources.map((r) => r.id).join(","),
        latencyMs: response.latencyMs,
        success: response.success,
      })
      .then(() => recordSuccess(breaker))
      .catch(() => recordFailure(breaker));
  }

  // Enqueue review (fire-and-forget)
  if (deps.enqueueReview) {
    deps.enqueueReview(context).catch(() => {
      // Swallow error - crisis response already delivered
    });
  }
}

/**
 * Reset circuit breaker state (for testing purposes).
 */
export function resetCircuitBreakers(): void {
  circuitBreakers.clear();
}
