"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Me {
  id: string;
  email: string;
  name: string | null;
  role: string;
  clientId: string;
}

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

function ThresholdsTab({ isAdmin }: { isAdmin: boolean }) {
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
      {isAdmin ? (
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Thresholds"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only admins can modify thresholds.
        </p>
      )}
    </div>
  );
}

function GeneralTab({ isAdmin }: { isAdmin: boolean }) {
  const [companyName, setCompanyName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGeneral() {
      try {
        const response = await fetch("/api/v1/settings/general");
        if (response.ok) {
          const data = await response.json();
          setCompanyName(data.name ?? "");
          setWebhookUrl(data.webhookUrl ?? "");
        } else {
          setError("Failed to load settings");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    fetchGeneral();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/v1/settings/general", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyName, webhookUrl }),
      });
      if (response.ok) {
        const data = await response.json();
        setCompanyName(data.name ?? "");
        setWebhookUrl(data.webhookUrl ?? "");
        setMessage("Settings saved successfully");
      } else {
        const err = await response.json();
        setError(err.error ?? "Failed to save settings");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading settings...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Company Name</label>
        <Input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Enter your company name"
          disabled={!isAdmin}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Webhook URL</label>
        <Input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://your-domain.com/webhooks/sentinelarc"
          disabled={!isAdmin}
        />
        <p className="text-xs text-muted-foreground">
          Receive real-time notifications for actions taken on flagged content.
        </p>
      </div>
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isAdmin ? (
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only admins can modify organization settings.
        </p>
      )}
    </div>
  );
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

function TeamTab({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("REVIEWER");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/team");
      if (response.ok) {
        const data = await response.json();
        setMembers(data.members);
      } else {
        setError("Failed to load team members");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleAdd = async () => {
    setSubmitting(true);
    setFormError(null);
    setFormMessage(null);
    try {
      const response = await fetch("/api/v1/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          name: newName || undefined,
          role: newRole,
          password: newPassword,
        }),
      });
      if (response.ok) {
        setFormMessage(
          "Member added. Share the temporary password with them securely; they can change it after signing in."
        );
        setNewEmail("");
        setNewName("");
        setNewRole("REVIEWER");
        setNewPassword("");
        await fetchMembers();
      } else {
        const err = await response.json();
        setFormError(err.error ?? "Failed to add member");
      }
    } catch {
      setFormError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Manage your team members and their roles. Admins can configure thresholds
        and billing. Reviewers can access the review queue.
      </p>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Team Members</CardTitle>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              Add member
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading team...</div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : members.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No team members found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.name ?? "—"}
                    </TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={member.role === "ADMIN" ? "default" : "secondary"}
                      >
                        {member.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          Note: email-based invitations are not yet available (no email provider
          is configured). Adding a member creates their account with a temporary
          password that you share with them directly.
        </p>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add team member</DialogTitle>
            <DialogDescription>
              Creates a dashboard account for your organization. Share the
              temporary password with the new member securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Name (optional)</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Jane Reviewer"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Role</label>
              <Select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="REVIEWER">Reviewer</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Temporary password</label>
              <Input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>
                Close
              </Button>
              <Button
                onClick={handleAdd}
                disabled={submitting || !newEmail || newPassword.length < 8}
              >
                {submitting ? "Adding..." : "Add member"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {formMessage && <p className="text-sm text-green-600">{formMessage}</p>}
    </div>
  );
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsed: string | null;
  createdAt: string;
}

function ApiKeysTab({
  isAdmin,
  clientId,
}: {
  isAdmin: boolean;
  clientId: string | null;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/clients/${clientId}/api-keys`);
      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys);
      } else {
        setError("Failed to load API keys");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (clientId) fetchKeys();
  }, [clientId, fetchKeys]);

  const handleCreate = async () => {
    if (!clientId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch(`/api/v1/clients/${clientId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      if (response.ok) {
        const data = await response.json();
        setCreatedKey(data.key);
        setCopied(false);
        setNewKeyName("");
        await fetchKeys();
      } else {
        const err = await response.json();
        setCreateError(err.error ?? "Failed to create API key");
      }
    } catch {
      setCreateError("Network error");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!clientId) return;
    if (
      !window.confirm(
        "Revoke this API key? Applications using it will stop working immediately."
      )
    ) {
      return;
    }
    const response = await fetch(
      `/api/v1/clients/${clientId}/api-keys?key_id=${encodeURIComponent(keyId)}`,
      { method: "DELETE" }
    );
    if (response.ok) {
      await fetchKeys();
    } else {
      const err = await response.json();
      setError(err.error ?? "Failed to revoke key");
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        API keys are used to authenticate ingestion requests from your application.
        Keep your keys secure and rotate them periodically.
      </p>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create API Key</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. Production Server)"
              />
              <Button
                onClick={handleCreate}
                disabled={creating || newKeyName.trim().length === 0}
              >
                {creating ? "Creating..." : "Create key"}
              </Button>
            </div>
            {createError && (
              <p className="mt-2 text-sm text-destructive">{createError}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active API Keys</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading keys...</div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : keys.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No active API keys.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Created</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {key.prefix}…
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.lastUsed
                        ? new Date(key.lastUsed).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRevoke(key.id)}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key created</DialogTitle>
            <DialogDescription>
              Copy this key now. For security, it is shown only once and you
              won&apos;t be able to see it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 font-mono text-sm break-all">
              {createdKey}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy key"}
              </Button>
              <Button size="sm" onClick={() => setCreatedKey(null)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    async function fetchMe() {
      const response = await fetch("/api/v1/me");
      if (response.ok) {
        setMe(await response.json());
      }
    }
    fetchMe();
  }, []);

  const isAdmin = me?.role === "ADMIN";
  const clientId = me?.clientId ?? null;

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
              <GeneralTab isAdmin={isAdmin} />
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
              <ThresholdsTab isAdmin={isAdmin} />
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
              <TeamTab isAdmin={isAdmin} />
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
              <ApiKeysTab isAdmin={isAdmin} clientId={clientId} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
