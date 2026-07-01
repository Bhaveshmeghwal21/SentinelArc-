import { GET } from "@/app/api/v1/me/route";

// Mock dependencies
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import { getServerSession } from "next-auth";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;

describe("GET /api/v1/me", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBe("Authentication required");
  });

  it("should return the authenticated user's identity, role, and tenant", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "admin@test.com",
        name: "Ada Admin",
        role: "ADMIN",
        clientId: "client-1",
      },
      expires: "",
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      id: "user-1",
      email: "admin@test.com",
      name: "Ada Admin",
      role: "ADMIN",
      clientId: "client-1",
    });
  });

  it("should return name as null when the user has no name", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: "user-2",
        email: "reviewer@test.com",
        role: "REVIEWER",
        clientId: "client-2",
      },
      expires: "",
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.name).toBeNull();
    expect(data.role).toBe("REVIEWER");
    expect(data.clientId).toBe("client-2");
  });
});
