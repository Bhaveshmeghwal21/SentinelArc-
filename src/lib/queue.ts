import { Queue, type ConnectionOptions } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const SCORING_QUEUE_NAME = "scoring";

export type ScoringJobType = "SCORE_TURN" | "SCORE_ARC";

export interface ScoringJobData {
  type: ScoringJobType;
  turnId: string;
  conversationId: string;
  clientId: string;
}

function getConnection(): ConnectionOptions {
  return {
    host: new URL(REDIS_URL).hostname || "localhost",
    port: Number(new URL(REDIS_URL).port) || 6379,
    maxRetriesPerRequest: null,
  };
}

let scoringQueue: Queue | null = null;

export function getScoringQueue(): Queue {
  if (!scoringQueue) {
    scoringQueue = new Queue(SCORING_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return scoringQueue;
}

export async function enqueueScoringJob(data: ScoringJobData): Promise<string> {
  const queue = getScoringQueue();
  const job = await queue.add(data.type, data, {
    priority: data.type === "SCORE_TURN" ? 1 : 2,
  });
  return job.id ?? "";
}
