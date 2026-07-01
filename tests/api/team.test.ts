import { GET, POST } from "@/app/api/v1/team/route";

// Mock dependencies
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
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
  return new Request("http://localhost/api/v1/team", { method: "GET" });
}

function createPostRequest(body: unknown) {
  return new Request("http://localhost/api/v1/team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/team", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("should return members scoped to the tenant (client_id filter)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const members = [
      {
        id: "user-1",
        name: "Ada Admin",
        email: "admin@test.com",
        role: "ADMIN",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    ];
    (mockPrisma.user.findMany as jest.Mock).mockResolvedValue(members);

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.members).toHaveLength(1);
    expect(data.members[0].email).toBe("admin@test.com");

    // Tenant isolation: query MUST be filtered by the session's clientId.
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "client-1" },
      })
    );
  });
});

describe("POST /api/v1/team", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({
        email: "new@test.com",
        role: "REVIEWER",
        password: "password123",
      })
    );
    expect(response.status).toBe(401);
  });

  it("should return 403 when user is not ADMIN (RBAC enforcement)", async () => {
    mockGetServerSession.mockResolvedValue(reviewerSession());

    const response = await POST(
      createPostRequest({
        email: "new@test.com",
        role: "REVIEWER",
        password: "password123",
      })
    );
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.error).toContain("Insufficient permissions");
  });

  it("should return 422 on invalid body (bad email)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const response = await POST(
      createPostRequest({
        email: "not-an-email",
        role: "REVIEWER",
        password: "password123",
      })
    );
    expect(response.status).toBe(422);
  });

  it("should return 422 on invalid body (short password)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const response = await POST(
      createPostRequest({
        email: "new@test.com",
        role: "REVIEWER",
        password: "short",
      })
    );
    expect(response.status).toBe(422);
  });

  it("should return 409 when a user with the email already exists", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "existing-user",
      email: "new@test.com",
    });

    const response = await POST(
      createPostRequest({
        email: "new@test.com",
        role: "REVIEWER",
        password: "password123",
      })
    );
    expect(response.status).toBe(409);

    const data = await response.json();
    expect(data.error).toContain("already exists");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("should create a member scoped to the tenant on success (201)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.user.create as jest.Mock).mockResolvedValue({
      id: "user-3",
      name: "New Member",
      email: "new@test.com",
      role: "REVIEWER",
      createdAt: new Date("2024-02-01T00:00:00Z"),
    });

    const response = await POST(
      createPostRequest({
        email: "new@test.com",
        name: "New Member",
        role: "REVIEWER",
        password: "password123",
      })
    );
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.member.id).toBe("user-3");
    expect(data.member.email).toBe("new@test.com");

    // New user must be created under the ADMIN's tenant with a hashed password.
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@test.com",
          name: "New Member",
          role: "REVIEWER",
          clientId: "client-1",
          passwordHash: expect.any(String),
        }),
      })
    );

    // Password must be hashed, never stored in plaintext.
    const createArg = (mockPrisma.user.create as jest.Mock).mock.calls[0][0];
    expect(createArg.data.passwordHash).not.toBe("password123");
  });
});
