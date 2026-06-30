/**
 * Audit Log Writer.
 *
 * Append-only - NO update or delete operations exposed.
 * Every entry includes: timestamp, client_id, event_type, actor, payload, related entity IDs.
 * Log entries are written with a hash chain (each entry includes hash of previous entry)
 * to detect tampering.
 *
 * Design: immutable append-only log with integrity verification.
 */

import * as crypto from "crypto";

export interface AuditLogEntry {
  id: string;
  clientId: string;
  actor: string; // 'system' | user ID | 'api'
  action: string; // e.g. 'flag.created', 'crisis.routed', 'review.resolved'
  resource: string; // e.g. 'flag:abc123', 'turn:xyz'
  payload: Record<string, unknown>;
  timestamp: Date;
  /** Hash of the previous entry for chain integrity */
  previousHash: string;
  /** Hash of this entry (computed from content + previousHash) */
  entryHash: string;
}

/**
 * Compute SHA-256 hash of entry content.
 */
function computeEntryHash(
  clientId: string,
  actor: string,
  action: string,
  resource: string,
  payload: Record<string, unknown>,
  timestamp: Date,
  previousHash: string
): string {
  const content = JSON.stringify({
    clientId,
    actor,
    action,
    resource,
    payload,
    timestamp: timestamp.toISOString(),
    previousHash,
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Interface for the persistent store that backs the audit log.
 */
export interface AuditLogStore {
  /** Append a new entry */
  append(entry: AuditLogEntry): Promise<void>;
  /** Get the most recent entry for a client (for hash chaining) */
  getLatestEntry(clientId: string): Promise<AuditLogEntry | null>;
  /** Get all entries for a client in chronological order (for verification) */
  getAllEntries(clientId: string): Promise<AuditLogEntry[]>;
}

/**
 * In-memory audit log store for testing.
 */
export class InMemoryAuditLogStore implements AuditLogStore {
  private entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async getLatestEntry(clientId: string): Promise<AuditLogEntry | null> {
    const clientEntries = this.entries.filter((e) => e.clientId === clientId);
    return clientEntries.length > 0
      ? clientEntries[clientEntries.length - 1]
      : null;
  }

  async getAllEntries(clientId: string): Promise<AuditLogEntry[]> {
    return this.entries.filter((e) => e.clientId === clientId);
  }

  /** Clear all entries (for testing only) */
  clear(): void {
    this.entries = [];
  }

  /** Get total entry count */
  count(): number {
    return this.entries.length;
  }
}

/**
 * Audit Logger - the primary interface for writing audit entries.
 */
export class AuditLogger {
  private store: AuditLogStore;
  private idGenerator: () => string;

  constructor(store: AuditLogStore, idGenerator?: () => string) {
    this.store = store;
    this.idGenerator = idGenerator ?? (() => crypto.randomUUID());
  }

  /**
   * Log an event to the audit trail.
   * Automatically chains the hash from the previous entry.
   */
  async log(params: {
    clientId: string;
    actor: string;
    action: string;
    resource: string;
    payload?: Record<string, unknown>;
  }): Promise<AuditLogEntry> {
    const { clientId, actor, action, resource, payload = {} } = params;
    const timestamp = new Date();

    // Get the previous entry's hash for chaining
    const previousEntry = await this.store.getLatestEntry(clientId);
    const previousHash = previousEntry?.entryHash ?? "GENESIS";

    // Compute this entry's hash
    const entryHash = computeEntryHash(
      clientId,
      actor,
      action,
      resource,
      payload,
      timestamp,
      previousHash
    );

    const entry: AuditLogEntry = {
      id: this.idGenerator(),
      clientId,
      actor,
      action,
      resource,
      payload,
      timestamp,
      previousHash,
      entryHash,
    };

    await this.store.append(entry);
    return entry;
  }

  /**
   * Verify the integrity of the audit log for a client.
   * Checks that the hash chain is unbroken and each entry's hash is valid.
   *
   * @returns true if the log is intact, false if tampering is detected
   */
  async verify(clientId: string): Promise<{
    valid: boolean;
    entries: number;
    firstInvalidIndex?: number;
    error?: string;
  }> {
    const entries = await this.store.getAllEntries(clientId);

    if (entries.length === 0) {
      return { valid: true, entries: 0 };
    }

    // Check the first entry has GENESIS as previous hash
    if (entries[0].previousHash !== "GENESIS") {
      return {
        valid: false,
        entries: entries.length,
        firstInvalidIndex: 0,
        error: "First entry does not reference GENESIS",
      };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Verify the entry's own hash
      const expectedHash = computeEntryHash(
        entry.clientId,
        entry.actor,
        entry.action,
        entry.resource,
        entry.payload,
        entry.timestamp,
        entry.previousHash
      );

      if (entry.entryHash !== expectedHash) {
        return {
          valid: false,
          entries: entries.length,
          firstInvalidIndex: i,
          error: `Entry ${i} hash mismatch - content may have been tampered with`,
        };
      }

      // Verify chain linkage (except first entry)
      if (i > 0) {
        const previousEntry = entries[i - 1];
        if (entry.previousHash !== previousEntry.entryHash) {
          return {
            valid: false,
            entries: entries.length,
            firstInvalidIndex: i,
            error: `Entry ${i} previousHash does not match entry ${i - 1} entryHash - chain broken`,
          };
        }
      }
    }

    return { valid: true, entries: entries.length };
  }
}
