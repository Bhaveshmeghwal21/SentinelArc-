"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TurnScore {
  selfHarm: number;
  sexualContent: number;
  ageSignal: number;
  emotionalIntensity: number;
  dependencyLanguage: number;
  romanticEscalation: number;
}

interface ConversationTurn {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  turnScores: TurnScore[];
}

interface ArcScore extends TurnScore {
  trendDirection: string;
  turnCount: number;
}

interface FlagRecord {
  id: string;
  turnId: string | null;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  threshold: number;
  message: string | null;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  externalId: string;
  endUserId: string;
  startedAt: string;
  lastActiveAt: string;
  turns: ConversationTurn[];
  arcScores: ArcScore[];
  flags: FlagRecord[];
}

const severityVariant: Record<
  string,
  "destructive" | "warning" | "secondary" | "outline"
> = {
  CRITICAL: "destructive",
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "secondary",
};

const SCORE_LABELS: { key: keyof TurnScore; label: string }[] = [
  { key: "selfHarm", label: "Self-harm" },
  { key: "sexualContent", label: "Sexual" },
  { key: "ageSignal", label: "Age Signal" },
  { key: "emotionalIntensity", label: "Emotional" },
  { key: "dependencyLanguage", label: "Dependency" },
  { key: "romanticEscalation", label: "Romantic" },
];

function scoreVariant(value: number): "destructive" | "warning" | "outline" {
  if (value >= 0.7) return "destructive";
  if (value >= 0.4) return "warning";
  return "outline";
}

function ScoreGrid({ scores }: { scores: TurnScore }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {SCORE_LABELS.map(({ key, label }) => (
        <Badge key={key} variant={scoreVariant(scores[key])}>
          {label}: {scores[key].toFixed(2)}
        </Badge>
      ))}
    </div>
  );
}

interface DetailPageProps {
  params: { conversationId: string };
}

export default function ConversationDetailPage({ params }: DetailPageProps) {
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchDetail() {
      try {
        const response = await fetch(
          `/api/v1/conversations/${params.conversationId}`
        );
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Conversation not found"
              : "Failed to load conversation"
          );
        }
        const data = await response.json();
        setDetail(data.conversation);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchDetail();
  }, [params.conversationId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">Loading conversation...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link href="/conversations">
          <Button variant="outline" size="sm">
            ← Back to conversations
          </Button>
        </Link>
        <div className="flex items-center justify-center p-8">
          <span className="text-destructive">
            {error ?? "Conversation not found"}
          </span>
        </div>
      </div>
    );
  }

  const arc = detail.arcScores[0] ?? null;
  const flaggedTurnIds = new Set(
    detail.flags.map((flag) => flag.turnId).filter(Boolean) as string[]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/conversations">
            <Button variant="outline" size="sm" className="mb-2">
              ← Back to conversations
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            Conversation {detail.externalId}
          </h1>
          <p className="text-muted-foreground">
            End user: {detail.endUserId} · {detail.turns.length} turns · Started{" "}
            {new Date(detail.startedAt).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Arc score */}
      {arc && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Arc-Level Scores (Trend: {arc.trendDirection}, {arc.turnCount} turns)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreGrid scores={arc} />
          </CardContent>
        </Card>
      )}

      {/* Flags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Flags ({detail.flags.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No flags raised on this conversation.
            </p>
          ) : (
            <div className="space-y-2">
              {detail.flags.map((flag) => (
                <div
                  key={flag.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={severityVariant[flag.severity] ?? "outline"}>
                      {flag.severity}
                    </Badge>
                    <span className="text-sm font-medium">
                      {flag.category.replace(/_/g, " ")}
                    </span>
                    {flag.message && (
                      <span className="text-sm text-muted-foreground">
                        — {flag.message}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    score {flag.score.toFixed(2)} / threshold{" "}
                    {flag.threshold.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transcript */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {detail.turns.map((turn) => {
              const isFlagged = flaggedTurnIds.has(turn.id);
              const scores = turn.turnScores[0];
              return (
                <div
                  key={turn.id}
                  className={`rounded-lg p-3 ${
                    isFlagged
                      ? "border-2 border-destructive bg-destructive/5"
                      : turn.role === "user"
                        ? "bg-muted"
                        : "bg-primary/5"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge
                      variant={turn.role === "user" ? "secondary" : "outline"}
                    >
                      {turn.role}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(turn.timestamp).toLocaleString()}
                    </span>
                    {isFlagged && <Badge variant="destructive">FLAGGED</Badge>}
                  </div>
                  <p className="text-sm">{turn.content}</p>
                  {scores && <ScoreGrid scores={scores} />}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
