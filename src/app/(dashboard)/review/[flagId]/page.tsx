"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationTurn {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  isFlagged: boolean;
}

interface ReviewDetail {
  id: string;
  status: string;
  severity: string;
  category: string;
  flagMessage: string;
  scores: {
    selfHarm: number;
    sexualContent: number;
    ageSignal: number;
    emotionalIntensity: number;
    dependencyLanguage: number;
    romanticEscalation: number;
  };
  arcScores: {
    selfHarm: number;
    sexualContent: number;
    ageSignal: number;
    emotionalIntensity: number;
    dependencyLanguage: number;
    romanticEscalation: number;
    trendDirection: string;
  } | null;
  conversationTurns: ConversationTurn[];
  assignee: string | null;
  triggeredRules: string[];
  suggestedAction: string;
}

interface ReviewPageProps {
  params: { flagId: string };
}

export default function ReviewDetailPage({ params }: ReviewPageProps) {
  const [detail, setDetail] = React.useState<ReviewDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [decision, setDecision] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [assignTo, setAssignTo] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.flagId]);

  async function fetchDetail() {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/reviews/${params.flagId}`);
      if (response.ok) {
        const data = await response.json();
        setDetail(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitDecision() {
    if (!decision) return;
    setSubmitting(true);
    try {
      await fetch(`/api/v1/reviews/${params.flagId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: decision,
          notes,
        }),
      });
      await fetchDetail();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssign() {
    if (!assignTo) return;
    await fetch(`/api/v1/reviews/${params.flagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: assignTo }),
    });
    await fetchDetail();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">Loading review...</span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">Review not found</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Review Detail</h1>
        <Badge variant={detail.severity === "CRITICAL" ? "destructive" : "warning"}>
          {detail.severity} - {detail.category.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Turn-Level Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span>Self-harm:</span>
              <span className="font-mono">{detail.scores.selfHarm.toFixed(3)}</span>
              <span>Sexual Content:</span>
              <span className="font-mono">{detail.scores.sexualContent.toFixed(3)}</span>
              <span>Age Signal:</span>
              <span className="font-mono">{detail.scores.ageSignal.toFixed(3)}</span>
              <span>Emotional Intensity:</span>
              <span className="font-mono">{detail.scores.emotionalIntensity.toFixed(3)}</span>
              <span>Dependency Language:</span>
              <span className="font-mono">{detail.scores.dependencyLanguage.toFixed(3)}</span>
              <span>Romantic Escalation:</span>
              <span className="font-mono">{detail.scores.romanticEscalation.toFixed(3)}</span>
            </div>
          </CardContent>
        </Card>

        {detail.arcScores && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Arc-Level Scores (Trend: {detail.arcScores.trendDirection})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span>Self-harm:</span>
                <span className="font-mono">{detail.arcScores.selfHarm.toFixed(3)}</span>
                <span>Sexual Content:</span>
                <span className="font-mono">{detail.arcScores.sexualContent.toFixed(3)}</span>
                <span>Age Signal:</span>
                <span className="font-mono">{detail.arcScores.ageSignal.toFixed(3)}</span>
                <span>Emotional Intensity:</span>
                <span className="font-mono">{detail.arcScores.emotionalIntensity.toFixed(3)}</span>
                <span>Dependency Language:</span>
                <span className="font-mono">{detail.arcScores.dependencyLanguage.toFixed(3)}</span>
                <span>Romantic Escalation:</span>
                <span className="font-mono">{detail.arcScores.romanticEscalation.toFixed(3)}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Triggered Rules & Suggested Action */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flag Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium">Message: </span>
              <span className="text-sm">{detail.flagMessage}</span>
            </div>
            <div>
              <span className="text-sm font-medium">Triggered Rules: </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {detail.triggeredRules.map((rule, i) => (
                  <Badge key={i} variant="outline">{rule}</Badge>
                ))}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Suggested Action: </span>
              <span className="text-sm">{detail.suggestedAction}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversation History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation History</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
            <div className="space-y-3">
              {detail.conversationTurns.map((turn) => (
                <div
                  key={turn.id}
                  className={`rounded-lg p-3 ${
                    turn.isFlagged
                      ? "border-2 border-destructive bg-destructive/5"
                      : turn.role === "user"
                      ? "bg-muted"
                      : "bg-primary/5"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={turn.role === "user" ? "secondary" : "outline"}>
                      {turn.role}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(turn.timestamp).toLocaleString()}
                    </span>
                    {turn.isFlagged && (
                      <Badge variant="destructive">FLAGGED</Badge>
                    )}
                  </div>
                  <p className="text-sm">{turn.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Separator />

      {/* Classification Form */}
      {detail.status !== "RESOLVED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Classification</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Decision</label>
                <Select
                  className="mt-1"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="">Select classification...</option>
                  <option value="TRUE_POSITIVE">
                    True Positive - Confirmed risk, action was appropriate
                  </option>
                  <option value="FALSE_POSITIVE">
                    False Positive - Not actually risky, improve detection
                  </option>
                  <option value="ESCALATE">
                    Escalate - Needs senior review or further action
                  </option>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  className="mt-1"
                  placeholder="Add context about your decision..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Assign to Reviewer</label>
                <div className="mt-1 flex gap-2">
                  <Input
                    placeholder="Reviewer ID"
                    value={assignTo}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setAssignTo(e.target.value)
                    }
                  />
                  <Button variant="outline" onClick={handleAssign}>
                    Assign
                  </Button>
                </div>
              </div>

              <Button
                onClick={handleSubmitDecision}
                disabled={!decision || submitting}
              >
                {submitting ? "Submitting..." : "Submit Classification"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
