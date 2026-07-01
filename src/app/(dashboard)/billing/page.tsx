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
import { Badge } from "@/components/ui/badge";

interface PlanDetails {
  name: string;
  priceId: string;
  monthlyPrice: number;
  conversationLimit: number;
}

interface UsageData {
  conversation_count: number;
  turn_count: number;
  period_start: string;
  period_end: string;
  conversation_limit: number | null;
  usage_percent: number | null;
}

interface BillingData {
  plan: string;
  plan_details: PlanDetails | null;
  subscription_status: string;
  stripe_customer_id: string | null;
  usage: UsageData;
  available_plans: Record<string, PlanDetails>;
}

function UsageMeter({
  current,
  limit,
  label,
}: {
  current: number;
  limit: number | null;
  label: string;
}) {
  const percent = limit ? Math.min((current / limit) * 100, 100) : 0;
  const isNearLimit = percent >= 80;
  const isOverLimit = percent >= 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono">
          {current.toLocaleString()}
          {limit ? ` / ${limit.toLocaleString()}` : ""}
        </span>
      </div>
      {limit && (
        <div className="h-3 rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${
              isOverLimit
                ? "bg-destructive"
                : isNearLimit
                  ? "bg-yellow-500"
                  : "bg-primary"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {limit && (
        <p className="text-xs text-muted-foreground">
          {percent.toFixed(1)}% of plan limit used
        </p>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  details,
  isCurrent,
  onSelect,
  disabled,
}: {
  plan: string;
  details: PlanDetails;
  isCurrent: boolean;
  onSelect: (plan: string) => void;
  disabled?: boolean;
}) {
  return (
    <Card className={isCurrent ? "border-primary" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{details.name}</CardTitle>
          {isCurrent && <Badge>Current Plan</Badge>}
        </div>
        <CardDescription>
          Up to {details.conversationLimit.toLocaleString()} conversations/month
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-3xl font-bold">
            ${details.monthlyPrice}
            <span className="text-sm font-normal text-muted-foreground">
              /month
            </span>
          </p>
          {!isCurrent && (
            <Button
              onClick={() => onSelect(plan)}
              variant="outline"
              className="w-full"
              disabled={disabled}
            >
              {disabled ? "Updating..." : "Switch Plan"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBilling() {
      try {
        const response = await fetch("/api/v1/billing");
        if (!response.ok) {
          throw new Error("Failed to fetch billing data");
        }
        const data = await response.json();
        setBilling(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchBilling();
  }, []);

  const handlePlanSelect = async (plan: string) => {
    setUpgrading(true);
    try {
      const response = await fetch("/api/v1/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (response.ok) {
        // Refresh billing data
        const refreshed = await fetch("/api/v1/billing");
        if (refreshed.ok) {
          setBilling(await refreshed.json());
        }
      }
    } finally {
      setUpgrading(false);
    }
  };

  const handleManagePayment = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const response = await fetch("/api/v1/billing/portal", {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        setPortalError(data.error ?? "Unable to open the billing portal");
        setPortalLoading(false);
      }
    } catch {
      setPortalError("Network error while opening the billing portal");
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground">Loading billing information...</p>
      </div>
    );
  }

  if (error || !billing) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-destructive">
          {error ?? "Failed to load billing information"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription and monitor usage
        </p>
      </div>

      {/* Current Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Current Period Usage</CardTitle>
          <CardDescription>
            {new Date(billing.usage.period_start).toLocaleDateString()} -{" "}
            {new Date(billing.usage.period_end).toLocaleDateString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageMeter
            current={billing.usage.conversation_count}
            limit={billing.usage.conversation_limit}
            label="Conversations"
          />
          <UsageMeter
            current={billing.usage.turn_count}
            limit={null}
            label="Turns (messages processed)"
          />
        </CardContent>
      </Card>

      {/* Subscription Status */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div>
              <p className="font-medium">
                {billing.plan_details?.name ?? billing.plan}
              </p>
              <p className="text-sm text-muted-foreground">
                Status:{" "}
                <Badge
                  variant={
                    billing.subscription_status === "active"
                      ? "default"
                      : "secondary"
                  }
                >
                  {billing.subscription_status}
                </Badge>
              </p>
            </div>
            {billing.plan_details && (
              <p className="ml-auto text-2xl font-bold">
                ${billing.plan_details.monthlyPrice}/mo
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Available Plans */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Available Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(billing.available_plans).map(([key, details]) => (
            <PlanCard
              key={key}
              plan={key}
              details={details}
              isCurrent={billing.plan === key}
              onSelect={handlePlanSelect}
              disabled={upgrading}
            />
          ))}
        </div>
      </div>

      {/* Payment Management */}
      {billing.stripe_customer_id && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>
              Manage your payment methods and billing details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleManagePayment}
              disabled={portalLoading}
            >
              {portalLoading
                ? "Opening Stripe Portal..."
                : "Manage Payment Methods (Stripe Portal)"}
            </Button>
            {portalError && (
              <p className="mt-2 text-sm text-destructive">{portalError}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
