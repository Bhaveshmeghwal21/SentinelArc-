import {
  AuditLogger,
  InMemoryAuditLogStore,
  type AuditLogEntry,
} from "@/lib/audit/logger";

describe("Audit Log Immutability", () => {
  let store: InMemoryAuditLogStore;
  let logger: AuditLogger;
  let idCounter: number;

  beforeEach(() => {
    store = new InMemoryAuditLogStore();
    idCounter = 0;
    logger = new AuditLogger(store, () => `id-${++idCounter}`);
  });

  describe("No update/delete operations", () => {
    it("should not expose any update method on the store interface", () => {
      // InMemoryAuditLogStore only has append, getLatestEntry, getAllEntries, clear, count
      const storeProto = Object.getOwnPropertyNames(
        Object.getPrototypeOf(store)
      );
      expect(storeProto).not.toContain("update");
      expect(storeProto).not.toContain("delete");
      expect(storeProto).not.toContain("remove");
      expect(storeProto).not.toContain("modify");
      expect(storeProto).not.toContain("edit");
    });

    it("should not expose any update method on the logger", () => {
      const loggerProto = Object.getOwnPropertyNames(
        Object.getPrototypeOf(logger)
      );
      expect(loggerProto).not.toContain("update");
      expect(loggerProto).not.toContain("delete");
      expect(loggerProto).not.toContain("remove");
      expect(loggerProto).not.toContain("modify");
      expect(loggerProto).not.toContain("edit");
    });

    it("should only expose log and verify as public methods", () => {
      const loggerProto = Object.getOwnPropertyNames(
        Object.getPrototypeOf(logger)
      );
      const publicMethods = loggerProto.filter(
        (m) => m !== "constructor"
      );
      expect(publicMethods).toContain("log");
      expect(publicMethods).toContain("verify");
      expect(publicMethods).toHaveLength(2);
    });
  });

  describe("Hash chain integrity", () => {
    it("should chain hashes correctly across entries", async () => {
      const entry1 = await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      const entry2 = await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.decided",
        resource: "review:r1",
      });

      // Entry 2's previousHash should be entry 1's entryHash
      expect(entry2.previousHash).toBe(entry1.entryHash);
    });

    it("should start with GENESIS as the first previousHash", async () => {
      const entry = await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      expect(entry.previousHash).toBe("GENESIS");
    });

    it("should produce valid hash chain that passes verification", async () => {
      await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.decided",
        resource: "review:r1",
        payload: { outcome: "TRUE_POSITIVE" },
      });

      await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.resolved",
        resource: "review:r1",
      });

      const result = await logger.verify("client-1");
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(3);
    });
  });

  describe("Tamper detection", () => {
    it("should detect tampered entry content", async () => {
      await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.decided",
        resource: "review:r1",
      });

      // Tamper with the first entry
      const entries = await store.getAllEntries("client-1");
      (entries[0] as { action: string }).action = "tampered.action";

      const result = await logger.verify("client-1");
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(0);
      expect(result.error).toContain("hash mismatch");
    });

    it("should detect broken chain linkage", async () => {
      await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.decided",
        resource: "review:r1",
      });

      // Break the chain by modifying the second entry's previousHash
      const entries = await store.getAllEntries("client-1");
      (entries[1] as { previousHash: string }).previousHash = "fake-hash";

      const result = await logger.verify("client-1");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("hash mismatch");
    });

    it("should detect if GENESIS reference is removed from first entry", async () => {
      await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      const entries = await store.getAllEntries("client-1");
      (entries[0] as { previousHash: string }).previousHash = "NOT_GENESIS";

      const result = await logger.verify("client-1");
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(0);
      expect(result.error).toContain("GENESIS");
    });

    it("should pass verification for empty log", async () => {
      const result = await logger.verify("client-1");
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(0);
    });
  });

  describe("All review actions produce audit entries", () => {
    it("should create audit entry for review.decided action", async () => {
      const entry = await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.decided",
        resource: "review:r1",
        payload: { outcome: "TRUE_POSITIVE", notes: "Confirmed" },
      });

      expect(entry.action).toBe("review.decided");
      expect(entry.payload).toEqual({ outcome: "TRUE_POSITIVE", notes: "Confirmed" });
      expect(store.count()).toBe(1);
    });

    it("should create audit entry for review.updated action", async () => {
      const entry = await logger.log({
        clientId: "client-1",
        actor: "user-1",
        action: "review.updated",
        resource: "review:r1",
        payload: { changes: { status: "IN_REVIEW" } },
      });

      expect(entry.action).toBe("review.updated");
      expect(store.count()).toBe(1);
    });

    it("should create audit entry for compliance.exported action", async () => {
      const entry = await logger.log({
        clientId: "client-1",
        actor: "admin-1",
        action: "compliance.exported",
        resource: "report:incident_report",
        payload: { format: "csv" },
      });

      expect(entry.action).toBe("compliance.exported");
      expect(store.count()).toBe(1);
    });

    it("should maintain separate chains per client", async () => {
      await logger.log({
        clientId: "client-1",
        actor: "system",
        action: "flag.created",
        resource: "flag:f1",
      });

      await logger.log({
        clientId: "client-2",
        actor: "system",
        action: "flag.created",
        resource: "flag:f2",
      });

      const result1 = await logger.verify("client-1");
      const result2 = await logger.verify("client-2");

      expect(result1.valid).toBe(true);
      expect(result1.entries).toBe(1);
      expect(result2.valid).toBe(true);
      expect(result2.entries).toBe(1);
    });
  });
});
