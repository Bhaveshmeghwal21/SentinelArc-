import { hasRole, withRole } from "@/lib/rbac";
import { getServerSession } from "next-auth";

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;

describe("RBAC", () => {
  describe("hasRole", () => {
    it("should return true when user has the exact required role", () => {
      expect(hasRole("ADMIN", "ADMIN")).toBe(true);
      expect(hasRole("REVIEWER", "REVIEWER")).toBe(true);
    });

    it("should return true when ADMIN accesses REVIEWER routes", () => {
      expect(hasRole("ADMIN", "REVIEWER")).toBe(true);
    });

    it("should return false when REVIEWER accesses ADMIN routes", () => {
      expect(hasRole("REVIEWER", "ADMIN")).toBe(false);
    });

    it("should return false for unknown roles", () => {
      expect(hasRole("UNKNOWN", "ADMIN")).toBe(false);
      expect(hasRole("UNKNOWN", "REVIEWER")).toBe(false);
    });
  });

  describe("withRole", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return 401 when not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const handler = jest.fn();
      const protectedHandler = withRole("ADMIN")(handler);

      const request = new Request("http://localhost/test");
      const response = await protectedHandler(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Authentication required");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should return 403 when user has insufficient permissions", async () => {
      mockGetServerSession.mockResolvedValue({
        user: {
          id: "user-1",
          email: "reviewer@test.com",
          role: "REVIEWER",
          clientId: "client-1",
        },
        expires: "",
      });

      const handler = jest.fn();
      const protectedHandler = withRole("ADMIN")(handler);

      const request = new Request("http://localhost/test");
      const response = await protectedHandler(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Insufficient permissions");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should call handler when ADMIN accesses ADMIN route", async () => {
      const mockSession = {
        user: {
          id: "user-1",
          email: "admin@test.com",
          role: "ADMIN",
          clientId: "client-1",
        },
        expires: "",
      };
      mockGetServerSession.mockResolvedValue(mockSession);

      const { NextResponse } = await import("next/server");
      const handler = jest.fn().mockResolvedValue(
        NextResponse.json({ success: true })
      );
      const protectedHandler = withRole("ADMIN")(handler);

      const request = new Request("http://localhost/test");
      const response = await protectedHandler(request);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          session: mockSession,
        })
      );
    });

    it("should call handler when ADMIN accesses REVIEWER route", async () => {
      const mockSession = {
        user: {
          id: "user-1",
          email: "admin@test.com",
          role: "ADMIN",
          clientId: "client-1",
        },
        expires: "",
      };
      mockGetServerSession.mockResolvedValue(mockSession);

      const { NextResponse } = await import("next/server");
      const handler = jest.fn().mockResolvedValue(
        NextResponse.json({ success: true })
      );
      const protectedHandler = withRole("REVIEWER")(handler);

      const request = new Request("http://localhost/test");
      const response = await protectedHandler(request);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });

    it("should call handler when REVIEWER accesses REVIEWER route", async () => {
      const mockSession = {
        user: {
          id: "user-1",
          email: "reviewer@test.com",
          role: "REVIEWER",
          clientId: "client-1",
        },
        expires: "",
      };
      mockGetServerSession.mockResolvedValue(mockSession);

      const { NextResponse } = await import("next/server");
      const handler = jest.fn().mockResolvedValue(
        NextResponse.json({ success: true })
      );
      const protectedHandler = withRole("REVIEWER")(handler);

      const request = new Request("http://localhost/test");
      const response = await protectedHandler(request);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });
  });
});
