/**
 * Team Management API endpoint.
 *
 * GET: Lists the team members (dashboard users) for the authenticated tenant.
 * POST: Creates a new team member for the tenant (ADMIN only).
 *
 * NOTE on invitations: there is no transactional email provider configured in
 * this codebase, so we cannot send an email invite link. Instead, POST creates
 * the user account directly with an admin-supplied temporary password. The admin
 * shares those credentials with the new member out-of-band. This is a real,
 * functional flow (it persists a User row scoped to the tenant) rather than a
 * placeholder no-op.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";
import { getTenantFilter } from "@/lib/tenant";

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const filter = getTenantFilter(session.user.clientId);

  const members = await prisma.user.findMany({
    where: filter,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ members });
}

const CreateMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255).optional(),
  role: z.enum(["ADMIN", "REVIEWER"]),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  // Only ADMIN can add team members.
  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions. Only ADMIN can add team members." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = CreateMemberSchema.safeParse(body);
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

  const { email, name, role, password } = parseResult.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const member = await prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash,
      clientId: session.user.clientId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ member }, { status: 201 });
}
