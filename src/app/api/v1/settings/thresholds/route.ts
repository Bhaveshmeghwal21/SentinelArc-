/**
 * Threshold Settings API endpoint.
 *
 * GET: Returns the effective threshold configuration for the client.
 * PUT: Updates client threshold configuration (ADMIN only).
 *      Validates that no threshold is set below system minimum.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";
import {
  enforceThresholds,
  SYSTEM_MINIMUM_THRESHOLDS,
  type ClientThresholdConfig,
} from "@/lib/threshold/engine";

const ThresholdUpdateSchema = z.object({
  crisisRoute_selfHarm: z.number().min(0).max(1).optional(),
  softFlag_selfHarm: z.number().min(0).max(1).optional(),
  hardBlock_sexualWithMinor: z.number().min(0).max(1).optional(),
  softFlag_emotionalIntensity: z.number().min(0).max(1).optional(),
  softFlag_dependencyLanguage: z.number().min(0).max(1).optional(),
  softFlag_romanticEscalation: z.number().min(0).max(1).optional(),
});

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
    select: { settings: true },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const settings = client.settings as Record<string, unknown> | null;
  const clientConfig = (settings?.thresholds as ClientThresholdConfig) ?? undefined;
  const effective = enforceThresholds(clientConfig);

  // Determine which thresholds are at system minimum vs client-configured
  const thresholdSources: Record<string, "system_minimum" | "client_configured"> = {};
  for (const key of Object.keys(effective) as (keyof typeof effective)[]) {
    const sysMin = SYSTEM_MINIMUM_THRESHOLDS[key as keyof typeof SYSTEM_MINIMUM_THRESHOLDS];
    if (sysMin !== undefined && effective[key] === sysMin) {
      thresholdSources[key] = "system_minimum";
    } else {
      thresholdSources[key] = "client_configured";
    }
  }

  return NextResponse.json({
    thresholds: effective,
    sources: thresholdSources,
    system_minimums: SYSTEM_MINIMUM_THRESHOLDS,
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  // RBAC: Only ADMIN can update thresholds
  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions. Only ADMIN can update thresholds." },
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

  const parseResult = ThresholdUpdateSchema.safeParse(body);
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

  const requestedThresholds = parseResult.data;

  // Validate against system minimums (server-side enforcement)
  const violations: string[] = [];

  if (
    requestedThresholds.crisisRoute_selfHarm !== undefined &&
    requestedThresholds.crisisRoute_selfHarm < SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm
  ) {
    violations.push(
      `crisisRoute_selfHarm cannot be below system minimum of ${SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm}`
    );
  }

  if (
    requestedThresholds.softFlag_selfHarm !== undefined &&
    requestedThresholds.softFlag_selfHarm < SYSTEM_MINIMUM_THRESHOLDS.softFlag_selfHarm
  ) {
    violations.push(
      `softFlag_selfHarm cannot be below system minimum of ${SYSTEM_MINIMUM_THRESHOLDS.softFlag_selfHarm}`
    );
  }

  if (
    requestedThresholds.hardBlock_sexualWithMinor !== undefined &&
    requestedThresholds.hardBlock_sexualWithMinor < SYSTEM_MINIMUM_THRESHOLDS.hardBlock_sexualWithMinor
  ) {
    violations.push(
      `hardBlock_sexualWithMinor cannot be below system minimum of ${SYSTEM_MINIMUM_THRESHOLDS.hardBlock_sexualWithMinor}`
    );
  }

  if (violations.length > 0) {
    return NextResponse.json(
      {
        error: "Threshold values violate system minimums",
        violations,
      },
      { status: 400 }
    );
  }

  // Get current settings and merge thresholds
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { settings: true },
  });

  const currentSettings = (client?.settings as Record<string, unknown>) ?? {};
  const currentThresholds = (currentSettings.thresholds as ClientThresholdConfig) ?? {};

  const updatedThresholds: ClientThresholdConfig = {
    ...currentThresholds,
    ...requestedThresholds,
  };

  // Apply enforcement to get effective values
  const effective = enforceThresholds(updatedThresholds);

  // Save to database
  await prisma.client.update({
    where: { id: clientId },
    data: {
      settings: {
        ...currentSettings,
        thresholds: updatedThresholds as Record<string, number>,
      },
    },
  });

  // Determine sources
  const thresholdSources: Record<string, "system_minimum" | "client_configured"> = {};
  for (const key of Object.keys(effective) as (keyof typeof effective)[]) {
    const sysMin = SYSTEM_MINIMUM_THRESHOLDS[key as keyof typeof SYSTEM_MINIMUM_THRESHOLDS];
    if (sysMin !== undefined && effective[key] === sysMin) {
      thresholdSources[key] = "system_minimum";
    } else {
      thresholdSources[key] = "client_configured";
    }
  }

  return NextResponse.json({
    thresholds: effective,
    sources: thresholdSources,
    system_minimums: SYSTEM_MINIMUM_THRESHOLDS,
  });
}
