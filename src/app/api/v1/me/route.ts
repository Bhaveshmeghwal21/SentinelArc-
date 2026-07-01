import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Returns the currently authenticated user's identity, role, and tenant.
 * Used by client components that need the session-scoped clientId (e.g. the
 * API Keys settings tab, which calls the tenant-scoped
 * /clients/{clientId}/api-keys endpoints) or the role for RBAC-aware UI.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    role: session.user.role,
    clientId: session.user.clientId,
  });
}
