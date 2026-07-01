/**
 * Stripe Billing Portal API endpoint.
 *
 * POST: Creates a Stripe Billing Portal session for the tenant's Stripe customer
 *       and returns the URL the client should redirect to. ADMIN only, consistent
 *       with the plan-switch POST on /api/v1/billing.
 *
 * Fails gracefully:
 * - 403 if the caller is not an ADMIN.
 * - 400 if the tenant has no Stripe customer yet (no subscription created).
 * - 503 if Stripe is not configured (STRIPE_SECRET_KEY unset) or the portal
 *   session cannot be created, with a clear error message for the UI to surface.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";
import { getStripe } from "@/lib/billing/stripe";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  // Only ADMIN can manage payment methods.
  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const client = await prisma.client.findUnique({
    where: { id: session.user.clientId },
    select: { settings: true },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const settings = (client.settings as Record<string, unknown>) ?? {};
  const customerId = settings.stripeCustomerId as string | undefined;

  if (!customerId) {
    return NextResponse.json(
      {
        error:
          "No billing account is set up yet. Choose a plan before managing payment methods.",
      },
      { status: 400 }
    );
  }

  const returnUrl = `${new URL(request.url).origin}/billing`;

  try {
    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    const message =
      err instanceof Error && err.message.includes("STRIPE_SECRET_KEY")
        ? "Billing portal is not available: Stripe is not configured."
        : "Unable to open the billing portal. Please try again later.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
