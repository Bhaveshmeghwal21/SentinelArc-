import { generateApiKey, hashApiKey, validateApiKey } from "@/lib/api-keys";
import fc from "fast-check";

// Mock Prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("API Key Generation", () => {
  describe("generateApiKey", () => {
    it("should generate a key with sa_live_ prefix", () => {
      const { fullKey } = generateApiKey();
      expect(fullKey).toMatch(/^sa_live_/);
    });

    it("should generate unique keys", () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const { fullKey } = generateApiKey();
        keys.add(fullKey);
      }
      expect(keys.size).toBe(100);
    });

    it("should generate a prefix for lookup", () => {
      const { fullKey, prefix } = generateApiKey();
      expect(fullKey.startsWith(prefix)).toBe(true);
      expect(prefix.length).toBeGreaterThan("sa_live_".length);
    });

    it("property: key always starts with sa_live_", () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const { fullKey } = generateApiKey();
          return fullKey.startsWith("sa_live_");
        }),
        { numRuns: 50 }
      );
    });

    it("property: key has sufficient entropy (length > 40)", () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const { fullKey } = generateApiKey();
          return fullKey.length > 40;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe("hashApiKey", () => {
    it("should produce consistent hashes for the same input", () => {
      const key = "sa_live_test123";
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = hashApiKey("sa_live_key1");
      const hash2 = hashApiKey("sa_live_key2");
      expect(hash1).not.toBe(hash2);
    });

    it("should produce a hex string of 64 characters (SHA-256)", () => {
      const hash = hashApiKey("sa_live_test123");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("property: hash is always 64 hex characters", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (input) => {
          const hash = hashApiKey(input);
          return /^[0-9a-f]{64}$/.test(hash);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("validateApiKey", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return null for null key", async () => {
      const result = await validateApiKey(null);
      expect(result).toBeNull();
    });

    it("should return null for undefined key", async () => {
      const result = await validateApiKey(undefined);
      expect(result).toBeNull();
    });

    it("should return null for empty string", async () => {
      const result = await validateApiKey("");
      expect(result).toBeNull();
    });

    it("should return null for key without correct prefix", async () => {
      const result = await validateApiKey("invalid_key_here");
      expect(result).toBeNull();
    });

    it("should return null for key not found in database", async () => {
      (mockPrisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await validateApiKey("sa_live_notfound123456");
      expect(result).toBeNull();
    });

    it("should return null for revoked key", async () => {
      (mockPrisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
        id: "key1",
        clientId: "client1",
        revokedAt: new Date(),
      });

      const result = await validateApiKey("sa_live_revokedkey12345");
      expect(result).toBeNull();
    });

    it("should return client context for valid key", async () => {
      (mockPrisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
        id: "key1",
        clientId: "client1",
        revokedAt: null,
      });
      (mockPrisma.apiKey.update as jest.Mock).mockResolvedValue({});

      const result = await validateApiKey("sa_live_validkey123456");
      expect(result).toEqual({
        clientId: "client1",
        apiKeyId: "key1",
      });
    });

    it("should update lastUsed timestamp on successful validation", async () => {
      (mockPrisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
        id: "key1",
        clientId: "client1",
        revokedAt: null,
      });
      (mockPrisma.apiKey.update as jest.Mock).mockResolvedValue({});

      await validateApiKey("sa_live_validkey123456");

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "key1" },
          data: { lastUsed: expect.any(Date) },
        })
      );
    });
  });
});
