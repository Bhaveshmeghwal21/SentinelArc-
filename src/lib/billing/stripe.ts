/**
 * Stripe billing integration module.
 *
 * Provides subscription management, usage metering, and webhook
 * processing for the SentinelArc billing system.
 *
 * Plan tiers:
 * - Starter: $199/mo, up to 10K conversations
 * - Growth: $499/mo, up to 50K conversations
 * - Enterprise: $999/mo, up to 250K conversations
 */

import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeInstance = new Stripe(stripeSecretKey, {
      apiVersion: "2024-04-10" as Stripe.LatestApiVersion,
    });
  }
  return stripeInstance;
}

/** Allows injection of a mock Stripe instance for testing */
export function setStripeInstance(instance: Stripe | null): void {
  stripeInstance = instance;
}

export interface PlanConfig {
  name: string;
  priceId: string;
  monthlyPrice: number;
  conversationLimit: number;
}

export const PLAN_CONFIGS: Record<string, PlanConfig> = {
  STARTER: {
    name: "Starter",
    priceId: process.env.STRIPE_STARTER_PRICE_ID ?? "price_starter",
    monthlyPrice: 199,
    conversationLimit: 10_000,
  },
  GROWTH: {
    name: "Growth",
    priceId: process.env.STRIPE_GROWTH_PRICE_ID ?? "price_growth",
    monthlyPrice: 499,
    conversationLimit: 50_000,
  },
  ENTERPRISE: {
    name: "Enterprise",
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "price_enterprise",
    monthlyPrice: 999,
    conversationLimit: 250_000,
  },
};

export interface CreateCustomerParams {
  clientId: string;
  name: string;
  email: string;
}

/**
 * Create a Stripe customer for a new client.
 */
export async function createCustomer(
  params: CreateCustomerParams
): Promise<Stripe.Customer> {
  const stripe = getStripe();
  return stripe.customers.create({
    name: params.name,
    email: params.email,
    metadata: {
      clientId: params.clientId,
    },
  });
}

export interface CreateSubscriptionParams {
  customerId: string;
  plan: keyof typeof PLAN_CONFIGS;
}

/**
 * Create a subscription for a customer with metered billing.
 */
export async function createSubscription(
  params: CreateSubscriptionParams
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  const planConfig = PLAN_CONFIGS[params.plan];

  if (!planConfig) {
    throw new Error(`Invalid plan: ${params.plan}`);
  }

  return stripe.subscriptions.create({
    customer: params.customerId,
    items: [
      {
        price: planConfig.priceId,
      },
    ],
    metadata: {
      plan: params.plan,
      conversationLimit: String(planConfig.conversationLimit),
    },
  });
}

export interface ReportUsageParams {
  subscriptionItemId: string;
  quantity: number;
  timestamp?: number;
}

/**
 * Report metered usage to Stripe for a billing period.
 */
export async function reportUsage(
  params: ReportUsageParams
): Promise<Stripe.UsageRecord> {
  const stripe = getStripe();
  return stripe.subscriptionItems.createUsageRecord(
    params.subscriptionItemId,
    {
      quantity: params.quantity,
      timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
      action: "set",
    }
  );
}

export interface GetUsageParams {
  subscriptionItemId: string;
}

/**
 * Get current period usage summary from Stripe.
 */
export async function getUsage(
  params: GetUsageParams
): Promise<Stripe.ApiList<Stripe.UsageRecordSummary>> {
  const stripe = getStripe();
  return stripe.subscriptionItems.listUsageRecordSummaries(
    params.subscriptionItemId
  );
}

export type WebhookEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.payment_failed";

export interface WebhookResult {
  eventType: WebhookEventType;
  customerId: string;
  subscriptionId?: string;
  plan?: string;
  status?: string;
}

/**
 * Process a Stripe webhook event and return structured result.
 */
export function handleWebhook(event: Stripe.Event): WebhookResult | null {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return {
        eventType: event.type as WebhookEventType,
        customerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        subscriptionId: subscription.id,
        plan: subscription.metadata?.plan,
        status: subscription.status,
      };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      return {
        eventType: event.type as WebhookEventType,
        customerId:
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? "",
        subscriptionId:
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? undefined,
        status: "payment_failed",
      };
    }
    default:
      return null;
  }
}

/**
 * Construct a Stripe webhook event from the raw body and signature.
 */
export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}
