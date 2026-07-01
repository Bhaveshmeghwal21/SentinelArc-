import { GET, PATCH } from "@/app/api/v1/settings/general/route";

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
      update: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

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

function createGetRequest() {
  return new Request("http://localhost/api/v1/settings/general", {
    method: "GET",
  });
}

function createPatchRequest(body: unknown) {
  return new Request("http://localhost/api/v1/settings/general", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/settings/general", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("should return name and webhookUrl from client + settings", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      name: "Acme Corp",
      settings: { webhookUrl: "https://hooks.acme.test/x" },
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      name: "Acme Corp",
      webhookUrl: "https://hooks.acme.test/x",
    });
  });

  it("should return empty webhookUrl when settings has none", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      name: "Acme Corp",
      settings: {},
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({ name: "Acme Corp", webhookUrl: "" });
  });

  it("should return 404 when the client does not exist", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/settings/general", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(response.status).toBe(401);
  });

  it("should return 403 when user is not ADMIN (RBAC enforcement)", async () => {
    mockGetServerSession.mockResolvedValue(reviewerSession());

    const response = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.error).toContain("Insufficient permissions");
  });

  it("should return 422 on invalid body (bad webhook URL)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const response = await PATCH(
      createPatchRequest({ webhookUrl: "not-a-url" })
    );
    expect(response.status).toBe(422);

    const data = await response.json();
    expect(data.error).toBe("Validation failed");
  });

  it("should return 422 on invalid body (empty name)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const response = await PATCH(createPatchRequest({ name: "" }));
    expect(response.status).toBe(422);
  });

  it("should persist name + webhookUrl merged into existing settings", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: {
        existingKey: "value",
        thresholds: { softFlag_selfHarm: 0.5 },
      },
    });
    (mockPrisma.client.update as jest.Mock).mockResolvedValue({
      name: "Renamed Co",
      settings: {
        existingKey: "value",
        thresholds: { softFlag_selfHarm: 0.5 },
        webhookUrl: "https://hooks.new.test/y",
      },
    });

    const response = await PATCH(
      createPatchRequest({
        name: "Renamed Co",
        webhookUrl: "https://hooks.new.test/y",
      })
    );
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.name).toBe("Renamed Co");
    expect(data.webhookUrl).toBe("https://hooks.new.test/y");

    // Existing settings keys are preserved and the webhook URL is merged in.
    expect(mockPrisma.client.update).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: {
        name: "Renamed Co",
        settings: expect.objectContaining({
          existingKey: "value",
          thresholds: { softFlag_selfHarm: 0.5 },
          webhookUrl: "https://hooks.new.test/y",
        }),
      },
      select: { name: true, settings: true },
    });
  });

  it("should return 404 when the client does not exist", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(response.status).toBe(404);
  });
});
