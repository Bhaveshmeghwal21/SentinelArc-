"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface ThresholdData {
  thresholds: Record<string, number>;
  sources: Record<string, "system_minimum" | "client_configured">;
  system_minimums: Record<string, number>;
}

function ThresholdSlider({
  label,
  thresholdKey,
  value,
  source,
  systemMinimum,
  onChange,
}: {
  label: string;
  thresholdKey: string;
  value: number;
  source: "system_minimum" | "client_configured";
  systemMinimum?: number;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex items-center gap-2">
          <Badge variant={source === "system_minimum" ? "destructive" : "secondary"}>
            {source === "system_minimum" ? "System Floor" : "Custom"}
          </Badge>
          <span className="text-sm font-mono">{value.toFixed(2)}</span>
        </div>
      </div>
      <input
        type="range"
        min={systemMinimum ?? 0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(thresholdKey, parseFloat(e.target.value))}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Min: {systemMinimum?.toFixed(2) ?? "0.00"}</span>
        <span>Max: 1.00</span>
      </div>
      {systemMinimum !== undefined && (
        <p className="text-xs text-muted-foreground">
          System minimum: {systemMinimum}. This threshold cannot be lowered below the system floor.
        </p>
      )}
    </div>
  );
}

function ThresholdsTab() {
  const [data, setData] = useState<ThresholdData | null>(null);
  const [localThresholds, setLocalThresholds] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchThresholds() {
      const response = await fetch("/api/v1/settings/thresholds");
      if (response.ok) {
        const result = await response.json();
        setData(result);
        setLocalThresholds(result.thresholds);
      }
    }
    fetchThresholds();
  }, []);

  const handleChange = (key: string, value: number) => {
    setLocalThresholds((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/v1/settings/thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localThresholds),
      });

      if (response.ok) {
        const result = await response.json();
        setData(result);
        setLocalThresholds(result.thresholds);
        setMessage("Thresholds updated successfully");
      } else {
        const err = await response.json();
        setError(err.error ?? "Failed to save thresholds");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return <p className="text-muted-foreground">Loading thresholds...</p>;
  }

  const thresholdLabels: Record<string, string> = {
    crisisRoute_selfHarm: "Crisis Route - Self Harm",
    softFlag_selfHarm: "Soft Flag - Self Harm",
    hardBlock_sexualWithMinor: "Hard Block - Sexual Content with Minor",
    softFlag_emotionalIntensity: "Soft Flag - Emotional Intensity",
    softFlag_dependencyLanguage: "Soft Flag - Dependency Language",
    softFlag_romanticEscalation: "Soft Flag - Romantic Escalation",
  };

  return (
    <div className="space-y-4">
      {Object.entries(localThresholds).map(([key, value]) => (
        <ThresholdSlider
          key={key}
          label={thresholdLabels[key] ?? key}
          thresholdKey={key}
          value={value}
          source={data.sources[key] ?? "client_configured"}
          systemMinimum={data.system_minimums[key]}
          onChange={handleChange}
        />
      ))}
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Thresholds"}
      </Button>
    </div>
  );
}

function GeneralTab() {
  const [companyName, setCompanyName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Company Name</label>
        <Input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Enter your company name"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Webhook URL</label>
        <Input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://your-domain.com/webhooks/sentinelarc"
        />
        <p className="text-xs text-muted-foreground">
          Receive real-time notifications for actions taken on flagged content.
        </p>
      </div>
      <Button>Save Settings</Button>
    </div>
  );
}

function TeamTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Manage your team members and their roles. Admins can configure thresholds
        and billing. Reviewers can access the review queue.
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Team management interface - invite members by email and assign roles.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ApiKeysTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        API keys are used to authenticate ingestion requests from your application.
        Keep your keys secure and rotate them periodically.
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active API Keys</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            API key management - create, list, and revoke keys.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your safety monitoring preferences
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>
                Basic configuration for your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GeneralTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="thresholds">
          <Card>
            <CardHeader>
              <CardTitle>Threshold Configuration</CardTitle>
              <CardDescription>
                Configure safety thresholds for your organization. Crisis routing
                thresholds cannot be lowered below the system floor to ensure
                safety guarantees are maintained.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThresholdsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle>Team Management</CardTitle>
              <CardDescription>
                Invite and manage team members with role-based access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TeamTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api-keys">
          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                Manage API keys for the ingestion endpoint
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApiKeysTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
