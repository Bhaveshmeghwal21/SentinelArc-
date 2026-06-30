import { NextResponse } from "next/server";

export interface TenantContext {
  clientId: string;
}

/**
 * Extracts tenant context from session or API key context.
 * All data queries MUST filter by client_id for multi-tenant isolation.
 */
export function getTenantFilter(clientId: string): { clientId: string } {
  return { clientId };
}

/**
 * Validates that a resource belongs to the authenticated tenant.
 * Returns a 403 response if the resource doesn't belong to the tenant.
 */
export function assertTenantAccess(
  resourceClientId: string,
  requestClientId: string
): NextResponse | null {
  if (resourceClientId !== requestClientId) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Higher-order function that wraps queries with tenant isolation.
 * Ensures all queries include the client_id filter.
 */
export function withTenant(clientId: string) {
  return {
    filter: { clientId },
    /**
     * Verifies a fetched record belongs to this tenant
     */
    verify: (record: { clientId: string } | null): boolean => {
      if (!record) return false;
      return record.clientId === clientId;
    },
  };
}
