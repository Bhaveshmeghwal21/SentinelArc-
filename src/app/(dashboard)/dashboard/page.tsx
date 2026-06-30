"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface StatsData {
  conversation_count: number;
  turn_count: number;
  flag_count: number;
  flags_by_category: Record<string, number>;
  flags_by_severity: Record<string, number>;
  action_count: number;
  actions_by_type: Record<string, number>;
  average_response_time_ms: number;
  false_positive_rate: number;
  crisis_route_count: number;
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {description && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      )}
    </Card>
  );
}

function CategoryBreakdown({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No data available</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([category, count]) => (
        <div key={category} className="flex items-center gap-2">
          <div className="flex-1">
            <div className="flex justify-between text-sm">
              <span className="capitalize">
                {category.replace(/_/g, " ")}
              </span>
              <span className="text-muted-foreground">{count}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OverviewDashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch("/api/v1/stats");
        if (!response.ok) {
          throw new Error("Failed to fetch statistics");
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Overview</h1>
        <p className="text-muted-foreground">Loading statistics...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Overview</h1>
        <p className="text-destructive">
          {error ?? "Failed to load statistics"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Overview</h1>
        <p className="text-muted-foreground">
          System performance and safety monitoring at a glance
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Conversations Monitored"
          value={stats.conversation_count.toLocaleString()}
          description="Total conversations in period"
        />
        <StatCard
          title="Flags Raised"
          value={stats.flag_count.toLocaleString()}
          description={`Across ${Object.keys(stats.flags_by_category).length} categories`}
        />
        <StatCard
          title="Average Response Time"
          value={`${stats.average_response_time_ms}ms`}
          description="Flag to action latency"
        />
        <StatCard
          title="False Positive Rate"
          value={`${(stats.false_positive_rate * 100).toFixed(1)}%`}
          description="Based on reviewer decisions"
        />
        <StatCard
          title="Crisis Routes Triggered"
          value={stats.crisis_route_count}
          description="Immediate crisis resource escalations"
        />
        <StatCard
          title="Actions Taken"
          value={stats.action_count.toLocaleString()}
          description="Total automated actions"
        />
      </div>

      {/* Detailed Breakdown */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Flags by Category</CardTitle>
            <CardDescription>
              Distribution of safety flags across categories
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown data={stats.flags_by_category} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flags by Severity</CardTitle>
            <CardDescription>
              Breakdown of flag severity levels
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown data={stats.flags_by_severity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions by Type</CardTitle>
            <CardDescription>
              Automated actions taken in response to flags
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown data={stats.actions_by_type} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
