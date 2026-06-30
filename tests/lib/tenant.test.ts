import { getTenantFilter, assertTenantAccess, withTenant } from "@/lib/tenant";

describe("Tenant Isolation", () => {
  describe("getTenantFilter", () => {
    it("should return a filter object with clientId", () => {
      const filter = getTenantFilter("client-1");
      expect(filter).toEqual({ clientId: "client-1" });
    });

    it("should always include the provided clientId", () => {
      const clientIds = ["abc", "def", "client-123"];
      clientIds.forEach((clientId) => {
        const filter = getTenantFilter(clientId);
        expect(filter.clientId).toBe(clientId);
      });
    });
  });

  describe("assertTenantAccess", () => {
    it("should return null when client IDs match", () => {
      const result = assertTenantAccess("client-1", "client-1");
      expect(result).toBeNull();
    });

    it("should return 403 response when client IDs do not match", async () => {
      const result = assertTenantAccess("client-1", "client-2");
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);

      const data = await result!.json();
      expect(data.error).toBe("Access denied");
    });

    it("should prevent cross-tenant access (client A cannot access client B resources)", async () => {
      // Client A trying to access Client B's resource
      const result = assertTenantAccess("client-B", "client-A");
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);
    });

    it("should prevent cross-tenant access in reverse (client B cannot access client A resources)", async () => {
      const result = assertTenantAccess("client-A", "client-B");
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);
    });
  });

  describe("withTenant", () => {
    it("should return a filter with the correct clientId", () => {
      const tenant = withTenant("client-1");
      expect(tenant.filter).toEqual({ clientId: "client-1" });
    });

    it("should verify records belonging to the same tenant", () => {
      const tenant = withTenant("client-1");
      const record = { clientId: "client-1", id: "record-1" };
      expect(tenant.verify(record)).toBe(true);
    });

    it("should reject records belonging to a different tenant", () => {
      const tenant = withTenant("client-1");
      const record = { clientId: "client-2", id: "record-1" };
      expect(tenant.verify(record)).toBe(false);
    });

    it("should reject null records", () => {
      const tenant = withTenant("client-1");
      expect(tenant.verify(null)).toBe(false);
    });

    it("should isolate data between multiple tenants", () => {
      const tenantA = withTenant("tenant-A");
      const tenantB = withTenant("tenant-B");

      const recordA = { clientId: "tenant-A", id: "record-1" };
      const recordB = { clientId: "tenant-B", id: "record-2" };

      // Tenant A can access their own records
      expect(tenantA.verify(recordA)).toBe(true);
      // Tenant A cannot access Tenant B records
      expect(tenantA.verify(recordB)).toBe(false);
      // Tenant B can access their own records
      expect(tenantB.verify(recordB)).toBe(true);
      // Tenant B cannot access Tenant A records
      expect(tenantB.verify(recordA)).toBe(false);
    });
  });
});
