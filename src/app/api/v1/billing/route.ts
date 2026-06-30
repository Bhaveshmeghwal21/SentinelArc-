/**
 * Billing API endpoint.
 *
 * GET: Returns current billing status and usage.
 * POST: Create or update subscription.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";
import {
  PLAN_CONFIGS,
  createCustomer,
  createSubscription,
} from "@/lib/billing/stripe";
import { getOrCreateUsageRecord } from "@/lib/billing/usage-tracker";

export async function GET(_request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const { clientId } = session.user;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      planTier: true,
      settings: true,
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const settings = (client.settings as Record<string, unknown>) ?? {};
  const usage = await getOrCreateUsageRecord(clientId);
  const planConfig = PLAN_CONFIGS[client.planTier] ?? null;

  return NextResponse.json({
    plan: client.planTier,
    plan_details: planConfig,
    subscription_status: settings.subscriptionStatus ?? "none",
    stripe_customer_id: settings.stripeCustomerId ?? null,
    usage: {
      conversation_count: usage.conversationCount,
      turn_count: usage.turnCount,
      period_start: usage.periodStart.toISOString(),
      period_end: usage.periodEnd.toISOString(),
      conversation_limit: planConfig?.conversationLimit ?? null,
      usage_percent: planConfig
        ? usage.conversationCount / planConfig.conversationLimit
        : null,
    },
    available_plans: PLAN_CONFIGS,
  });
}

const CreateSubscriptionSchema = z.object({
  plan: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  // Only ADMIN can manage subscriptions
  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const { clientId } = session.user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = CreateSubscriptionSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parseResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 }
    );
  }

  const { plan } = parseResult.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, settings: true },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const settings = (client.settings as Record<string, unknown>) ?? {};
  let customerId = settings.stripeCustomerId as string | undefined;

  // Create Stripe customer if needed
  if (!customerId) {
    const customer = await createCustomer({
      clientId,
      name: client.name,
      email: session.user.email,
    });
    customerId = customer.id;
  }

  // Create subscription
  const subscription = await createSubscription({
    customerId,
    plan,
  });

  // Update client
  await prisma.client.update({
    where: { id: clientId },
    data: {
      settings: {
        ...settings,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
      },
    },
  });

  return NextResponse.json({
    subscription_id: subscription.id,
    status: subscription.status,
    plan,
  });
}
