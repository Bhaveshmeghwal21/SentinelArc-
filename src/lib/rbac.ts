import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export type Role = "ADMIN" | "REVIEWER";

const ROLE_HIERARCHY: Record<Role, number> = {
  ADMIN: 100,
  REVIEWER: 10,
};

/**
 * Checks if a user's role meets or exceeds the minimum required role.
 */
export function hasRole(userRole: string, requiredRole: Role): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as Role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}

/**
 * Higher-order function that wraps a route handler with role checking.
 * Returns 401 if not authenticated, 403 if insufficient permissions.
 */
export function withRole(requiredRole: Role) {
  return function <T>(
    handler: (
      req: Request,
      context: { session: { user: { id: string; email: string; role: string; clientId: string } } } & T
    ) => Promise<NextResponse>
  ) {
    return async (req: Request, routeContext?: T): Promise<NextResponse> => {
      const session = await getServerSession(authOptions);

      if (!session?.user) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      if (!hasRole(session.user.role, requiredRole)) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 }
        );
      }

      const handlerContext = {
        ...(routeContext ?? {}),
        session,
      } as { session: { user: { id: string; email: string; role: string; clientId: string } } } & T;

      return handler(req, handlerContext);
    };
  };
}
