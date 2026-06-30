import { GET, PUT } from "@/app/api/v1/settings/thresholds/route";

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
import { SYSTEM_MINIMUM_THRESHOLDS } from "@/lib/threshold/engine";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function createGetRequest() {
  return new Request("http://localhost/api/v1/settings/thresholds", {
    method: "GET",
  });
}

function createPutRequest(body: unknown) {
  return new Request("http://localhost/api/v1/settings/thresholds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/settings/thresholds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(createGetRequest());
    expect(response.status).toBe(401);
  });

  it("should return effective thresholds with sources", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: {
        thresholds: {
          softFlag_emotionalIntensity: 0.7,
        },
      },
    });

    const response = await GET(createGetRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.thresholds).toBeDefined();
    expect(data.sources).toBeDefined();
    expect(data.system_minimums).toEqual(SYSTEM_MINIMUM_THRESHOLDS);
    expect(data.thresholds.softFlag_emotionalIntensity).toBe(0.7);
  });

  it("should return defaults when client has no threshold config", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: {},
    });

    const response = await GET(createGetRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.thresholds.crisisRoute_selfHarm).toBe(0.7);
    expect(data.thresholds.softFlag_selfHarm).toBe(0.4);
    expect(data.thresholds.hardBlock_sexualWithMinor).toBe(0.6);
  });
});

describe("PUT /api/v1/settings/thresholds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await PUT(createPutRequest({ softFlag_emotionalIntensity: 0.6 }));
    expect(response.status).toBe(401);
  });

  it("should return 403 when user is not ADMIN (RBAC enforcement)", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "REVIEWER", clientId: "client-1" },
      expires: "",
    });

    const response = await PUT(
      createPutRequest({ softFlag_emotionalIntensity: 0.6 })
    );
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.error).toContain("Insufficient permissions");
  });

  it("should reject threshold below system minimum for crisisRoute_selfHarm", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    const response = await PUT(
      createPutRequest({ crisisRoute_selfHarm: 0.3 })
    );
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("Threshold values violate system minimums");
    expect(data.violations).toContain(
      `crisisRoute_selfHarm cannot be below system minimum of ${SYSTEM_MINIMUM_THRESHOLDS.crisisRoute_selfHarm}`
    );
  });

  it("should reject threshold below system minimum for softFlag_selfHarm", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    const response = await PUT(
      createPutRequest({ softFlag_selfHarm: 0.2 })
    );
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.violations).toContain(
      `softFlag_selfHarm cannot be below system minimum of ${SYSTEM_MINIMUM_THRESHOLDS.softFlag_selfHarm}`
    );
  });

  it("should reject threshold below system minimum for hardBlock_sexualWithMinor", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    const response = await PUT(
      createPutRequest({ hardBlock_sexualWithMinor: 0.3 })
    );
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.violations).toContain(
      `hardBlock_sexualWithMinor cannot be below system minimum of ${SYSTEM_MINIMUM_THRESHOLDS.hardBlock_sexualWithMinor}`
    );
  });

  it("should allow valid threshold updates", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: { thresholds: {} },
    });
    (mockPrisma.client.update as jest.Mock).mockResolvedValue({});

    const response = await PUT(
      createPutRequest({
        softFlag_emotionalIntensity: 0.8,
        crisisRoute_selfHarm: 0.9,
      })
    );
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.thresholds.softFlag_emotionalIntensity).toBe(0.8);
    expect(data.thresholds.crisisRoute_selfHarm).toBe(0.9);
  });

  it("should save thresholds to database", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "test@test.com", role: "ADMIN", clientId: "client-1" },
      expires: "",
    });

    (mockPrisma.client.findUnique as jest.Mock).mockResolvedValue({
      settings: { existingKey: "value" },
    });
    (mockPrisma.client.update as jest.Mock).mockResolvedValue({});

    await PUT(
      createPutRequest({ softFlag_emotionalIntensity: 0.7 })
    );

    expect(mockPrisma.client.update).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: {
        settings: expect.objectContaining({
          existingKey: "value",
          thresholds: expect.objectContaining({
            softFlag_emotionalIntensity: 0.7,
          }),
        }),
      },
    });
  });
});
