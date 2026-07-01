/**
 * General Settings API endpoint.
 *
 * GET: Returns the client's general settings (company name + webhook URL).
 * PATCH: Updates the company name and/or webhook URL (ADMIN only).
 *
 * The company name is stored on Client.name. The webhook URL does not have a
 * dedicated column, so it is persisted inside the existing Client.settings JSON
 * blob under the `webhookUrl` key (co-located with `thresholds`, `stripeCustomerId`,
 * etc.), consistent with how the thresholds and billing endpoints use settings.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";

const GeneralUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  webhookUrl: z
    .union([z.string().url(), z.literal("")])
    .optional(),
});

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const client = await prisma.client.findUnique({
    where: { id: session.user.clientId },
    select: { name: true, settings: true },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const settings = (client.settings as Record<string, unknown>) ?? {};

  return NextResponse.json({
    name: client.name,
    webhookUrl: (settings.webhookUrl as string) ?? "",
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  // Only ADMIN can change organization settings.
  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions. Only ADMIN can update settings." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = GeneralUpdateSchema.safeParse(body);
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

  const { name, webhookUrl } = parseResult.data;

  const client = await prisma.client.findUnique({
    where: { id: session.user.clientId },
    select: { settings: true },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const currentSettings = (client.settings as Record<string, unknown>) ?? {};

  const nextSettings: Record<string, unknown> = { ...currentSettings };
  if (webhookUrl !== undefined) {
    nextSettings.webhookUrl = webhookUrl;
  }

  const updated = await prisma.client.update({
    where: { id: session.user.clientId },
    data: {
      ...(name !== undefined ? { name } : {}),
      settings: nextSettings as Prisma.InputJsonValue,
    },
    select: { name: true, settings: true },
  });

  const updatedSettings = (updated.settings as Record<string, unknown>) ?? {};

  return NextResponse.json({
    name: updated.name,
    webhookUrl: (updatedSettings.webhookUrl as string) ?? "",
  });
}
