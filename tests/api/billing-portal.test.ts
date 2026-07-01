import { POST } from "@/app/api/v1/billing/portal/route";

// Mock dependencies
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    client: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/lib/billing/stripe", () => ({
  getStripe: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/billing/stripe";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetStripe = getStripe as jest.MockedFunction<typeof getStripe>;

function adminSession() {
  return {
    user: { id: "user-1", email: "admin@test.com", role: "ADMIN", clientId: "client-1" },
    expires: "",
  };
}

function reviewerSession() {
  return {
    user: { id: "user-2", email: "rev@test.com", role: "REVIEWER", clientId: "client-1" },
    expires: "",
  };
}

function createPostRequest() {
  return new Request("http://localhost/api/v1/billing/portal", {
    method: "POST",
  });
}

describe("POST /api/v1/billing/portal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST(createPostRequest());
    expect(response.status).toBe(401);
  });

  it("should return 403 when user is not ADMIN (RBAC enforcement)", async () => {
    mockGetServerSession.mockResolvedValue(reviewerSession());

    const response = await POST(createPostRequest());
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.error).toContain("Insufficient permissions");
  });

  it("should return 400 when the tenant has no stripeCustomerId", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: {},
    });

    const response = await POST(createPostRequest());
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain("No billing account");
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("should return { url } when a customer exists and Stripe is available", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: { stripeCustomerId: "cus_test123" },
    });

    const create = jest
      .fn()
      .mockResolvedValue({ url: "https://portal.test/session" });
    mockGetStripe.mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const response = await POST(createPostRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.url).toBe("https://portal.test/session");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_test123",
        return_url: "http://localhost/billing",
      })
    );
  });

  it("should return 503 when Stripe is not configured (getStripe throws)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: { stripeCustomerId: "cus_test123" },
    });

    mockGetStripe.mockImplementation(() => {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    });

    const response = await POST(createPostRequest());
    expect(response.status).toBe(503);

    const data = await response.json();
    expect(data.error).toContain("Stripe is not configured");
  });

  it("should return 404 when the client does not exist", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue(null);

    const response = await POST(createPostRequest());
    expect(response.status).toBe(404);
  });
});
