/**
 * BullMQ Worker for scoring jobs.
 *
 * Processes:
 * - SCORE_TURN: Load turn, run turn-scorer, store TurnScore, check thresholds, execute actions.
 * - SCORE_ARC: Load conversation history, run arc-scorer, store ArcScore, check thresholds.
 *
 * Critical design:
 * - If a turn score indicates immediate crisis (self_harm >= 0.9), crisis routing fires
 *   BEFORE the job is fully processed - this is the "fast path" that bypasses normal queue ordering.
 * - Separate concurrency settings for crisis-priority jobs vs normal scoring.
 */

import { Worker, type Job, type ConnectionOptions } from "bullmq";
import { type ScoringJobData, SCORING_QUEUE_NAME } from "../lib/queue";
import { scoreTurn, type TurnScores, type TurnScorerConfig } from "../lib/scoring/turn-scorer";
import { scoreArc, type ArcScoreResult } from "../lib/scoring/arc-scorer";
import { evaluateThresholds, type ClientThresholdConfig } from "../lib/threshold/engine";
import { executeActions, type ActionStore } from "../lib/actions/executor";
import { routeCrisis, type CrisisRouterDependencies } from "../lib/crisis/router";
import { AuditLogger, type AuditLogStore } from "../lib/audit/logger";

/** Crisis fast-path threshold: above this, crisis routing fires immediately */
const CRISIS_FAST_PATH_THRESHOLD = 0.9;

/** Number of turns between automatic arc scoring */
const ARC_SCORING_INTERVAL = 5;

/** Turn score threshold that triggers immediate arc scoring */
const ELEVATED_SCORE_THRESHOLD = 0.5;

/**
 * Data access interface for the scoring worker.
 */
export interface ScoringWorkerStore {
  /** Load a turn's content by ID */
  getTurnContent(turnId: string): Promise<{ content: string; conversationId: string } | null>;

  /** Store turn scores */
  storeTurnScore(turnId: string, scores: TurnScores): Promise<void>;

  /** Get the number of turns in a conversation */
  getConversationTurnCount(conversationId: string): Promise<number>;

  /** Load recent turn scores for a conversation (for arc scoring) */
  getRecentTurnScores(conversationId: string, limit: number): Promise<TurnScores[]>;

  /** Store arc score */
  storeArcScore(conversationId: string, arcScore: ArcScoreResult): Promise<void>;

  /** Get client threshold configuration */
  getClientConfig(clientId: string): Promise<ClientThresholdConfig | undefined>;
}

export interface ScoringWorkerDependencies {
  store: ScoringWorkerStore;
  actionStore: ActionStore;
  auditLogStore: AuditLogStore;
  turnScorerConfig?: TurnScorerConfig;
  crisisDeps?: CrisisRouterDependencies;
}

/**
 * Process a SCORE_TURN job.
 */
export async function processScoreTurnJob(
  data: ScoringJobData,
  deps: ScoringWorkerDependencies
): Promise<{
  scores: TurnScores;
  crisisFastPathFired: boolean;
  actions: string[];
}> {
  const { turnId, conversationId, clientId } = data;

  // Load turn content
  const turn = await deps.store.getTurnContent(turnId);
  if (!turn) {
    throw new Error(`Turn not found: ${turnId}`);
  }

  // Score the turn
  const scores = await scoreTurn(turn.content, deps.turnScorerConfig);

  // Store scores
  await deps.store.storeTurnScore(turnId, scores);

  // CRISIS FAST PATH: If self_harm is at or above fast path threshold,
  // fire crisis routing IMMEDIATELY before any further processing.
  let crisisFastPathFired = false;
  if (scores.selfHarm >= CRISIS_FAST_PATH_THRESHOLD) {
    routeCrisis(
      {
        clientId,
        conversationId,
        turnId,
        triggerCategory: "self_harm",
        triggerScore: scores.selfHarm,
      },
      deps.crisisDeps
    );
    crisisFastPathFired = true;
  }

  // Get client configuration
  const clientConfig = await deps.store.getClientConfig(clientId);

  // Check if arc scoring is needed
  const turnCount = await deps.store.getConversationTurnCount(conversationId);
  const hasElevatedScore = Object.values(scores).some(
    (s) => s >= ELEVATED_SCORE_THRESHOLD
  );

  let arcScore: ArcScoreResult | null = null;
  if (turnCount % ARC_SCORING_INTERVAL === 0 || hasElevatedScore) {
    // Run arc scoring inline
    const recentScores = await deps.store.getRecentTurnScores(conversationId, 10);
    arcScore = scoreArc(recentScores);
    await deps.store.storeArcScore(conversationId, arcScore);
  }

  // Evaluate thresholds
  const thresholdActions = evaluateThresholds(scores, arcScore, clientConfig);

  // Execute actions
  const auditLogger = new AuditLogger(deps.auditLogStore);
  const results = await executeActions(
    thresholdActions,
    { clientId, conversationId, turnId },
    deps.actionStore,
    auditLogger,
    deps.crisisDeps
  );

  return {
    scores,
    crisisFastPathFired,
    actions: results.map((r) => r.type),
  };
}

/**
 * Process a SCORE_ARC job.
 */
export async function processScoreArcJob(
  data: ScoringJobData,
  deps: ScoringWorkerDependencies
): Promise<{
  arcScore: ArcScoreResult;
  actions: string[];
}> {
  const { conversationId, clientId, turnId } = data;

  // Load conversation history scores
  const recentScores = await deps.store.getRecentTurnScores(conversationId, 10);

  if (recentScores.length === 0) {
    return {
      arcScore: scoreArc([]),
      actions: [],
    };
  }

  // Run arc scoring
  const arcScore = scoreArc(recentScores);

  // Store arc score
  await deps.store.storeArcScore(conversationId, arcScore);

  // Get latest turn scores for threshold evaluation
  const latestTurnScores = recentScores[recentScores.length - 1];

  // Get client config
  const clientConfig = await deps.store.getClientConfig(clientId);

  // Evaluate thresholds with arc context
  const thresholdActions = evaluateThresholds(latestTurnScores, arcScore, clientConfig);

  // Execute actions
  const auditLogger = new AuditLogger(deps.auditLogStore);
  const results = await executeActions(
    thresholdActions,
    { clientId, conversationId, turnId },
    deps.actionStore,
    auditLogger,
    deps.crisisDeps
  );

  return {
    arcScore,
    actions: results.map((r) => r.type),
  };
}

/**
 * Create and start the scoring worker.
 * In production, this runs as a separate process.
 */
export function createScoringWorker(
  connection: ConnectionOptions,
  deps: ScoringWorkerDependencies
): Worker {
  const worker = new Worker<ScoringJobData>(
    SCORING_QUEUE_NAME,
    async (job: Job<ScoringJobData>) => {
      switch (job.data.type) {
        case "SCORE_TURN":
          return processScoreTurnJob(job.data, deps);
        case "SCORE_ARC":
          return processScoreArcJob(job.data, deps);
        default:
          throw new Error(`Unknown job type: ${(job.data as ScoringJobData).type}`);
      }
    },
    {
      connection,
      concurrency: 10,
      limiter: {
        max: 100,
        duration: 1000,
      },
    }
  );

  return worker;
}
