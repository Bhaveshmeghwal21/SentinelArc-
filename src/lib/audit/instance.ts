/**
 * Singleton audit logger instance backed by Prisma.
 * Used by API routes and business logic to record audit events.
 */

import { prisma } from "@/lib/prisma";
import { type Prisma } from "@prisma/client";
import { AuditLogger, type AuditLogStore, type AuditLogEntry } from "./logger";

/**
 * Prisma-backed audit log store.
 * Append-only: no update or delete operations.
 *
 * Hash chain data (previousHash, entryHash) is persisted within the JSON
 * payload field using reserved keys `_previousHash` and `_entryHash`.
 * This preserves the tamper-evidence guarantee without requiring schema migration.
 */
class PrismaAuditLogStore implements AuditLogStore {
  async append(entry: AuditLogEntry): Promise<void> {
    // Persist hash chain data inside the payload JSON so that
    // verification works correctly in production.
    const payloadWithHashes = {
      ...(entry.payload ?? {}),
      _previousHash: entry.previousHash,
      _entryHash: entry.entryHash,
    };

    await prisma.auditLogEntry.create({
      data: {
        id: entry.id,
        clientId: entry.clientId,
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        payload: payloadWithHashes as Prisma.InputJsonValue,
        timestamp: entry.timestamp,
      },
    });
  }

  async getLatestEntry(clientId: string): Promise<AuditLogEntry | null> {
    const entry = await prisma.auditLogEntry.findFirst({
      where: { clientId },
      orderBy: { timestamp: "desc" },
    });

    if (!entry) return null;

    return this.reconstructEntry(entry);
  }

  async getAllEntries(clientId: string): Promise<AuditLogEntry[]> {
    const entries = await prisma.auditLogEntry.findMany({
      where: { clientId },
      orderBy: { timestamp: "asc" },
    });

    return entries.map((entry) => this.reconstructEntry(entry));
  }

  /**
   * Reconstruct an AuditLogEntry from a Prisma record.
   * Extracts hash chain data from the payload and returns the
   * user-facing payload without the internal hash keys.
   */
  private reconstructEntry(entry: {
    id: string;
    clientId: string;
    actor: string;
    action: string;
    resource: string;
    payload: unknown;
    timestamp: Date;
  }): AuditLogEntry {
    const rawPayload = (entry.payload as Record<string, unknown>) ?? {};
    const previousHash = (rawPayload._previousHash as string) ?? "GENESIS";
    const entryHash = (rawPayload._entryHash as string) ?? "";

    // Return the payload without the internal hash keys
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _previousHash: _ph, _entryHash: _eh, ...userPayload } = rawPayload;

    return {
      id: entry.id,
      clientId: entry.clientId,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      payload: userPayload,
      timestamp: entry.timestamp,
      previousHash,
      entryHash,
    };
  }
}

export const auditLogger = new AuditLogger(new PrismaAuditLogStore());
