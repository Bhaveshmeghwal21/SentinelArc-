/**
 * Stripe Webhook handler.
 *
 * Processes subscription lifecycle events from Stripe.
 * Updates client records with current plan and status.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent, handleWebhook } from "@/lib/billing/stripe";

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 }
    );
  }

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 }
    );
  }

  const result = handleWebhook(event);

  if (!result) {
    // Unhandled event type - acknowledge receipt
    return NextResponse.json({ received: true });
  }

  // Find the client by Stripe customer ID metadata
  const client = await prisma.client.findFirst({
    where: {
      settings: {
        path: ["stripeCustomerId"],
        equals: result.customerId,
      },
    },
  });

  if (!client) {
    // Customer not found - still acknowledge to avoid retries
    return NextResponse.json({ received: true, matched: false });
  }

  // Update client based on event type
  const currentSettings = (client.settings as Record<string, unknown>) ?? {};

  switch (result.eventType) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const planTierMap: Record<string, string> = {
        STARTER: "STARTER",
        GROWTH: "PROFESSIONAL",
        ENTERPRISE: "ENTERPRISE",
      };

      const planTier = result.plan ? planTierMap[result.plan] : undefined;

      await prisma.client.update({
        where: { id: client.id },
        data: {
          ...(planTier ? { planTier: planTier as "STARTER" | "PROFESSIONAL" | "ENTERPRISE" } : {}),
          settings: {
            ...currentSettings,
            stripeCustomerId: result.customerId,
            stripeSubscriptionId: result.subscriptionId,
            subscriptionStatus: result.status,
          },
        },
      });
      break;
    }

    case "customer.subscription.deleted": {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          planTier: "FREE",
          settings: {
            ...currentSettings,
            stripeCustomerId: result.customerId,
            stripeSubscriptionId: null,
            subscriptionStatus: "canceled",
          },
        },
      });
      break;
    }

    case "invoice.payment_failed": {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          settings: {
            ...currentSettings,
            subscriptionStatus: "payment_failed",
            lastPaymentFailure: new Date().toISOString(),
          },
        },
      });
      break;
    }
  }

  return NextResponse.json({ received: true, processed: true });
}
