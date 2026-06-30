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
 */
class PrismaAuditLogStore implements AuditLogStore {
  async append(entry: AuditLogEntry): Promise<void> {
    await prisma.auditLogEntry.create({
      data: {
        id: entry.id,
        clientId: entry.clientId,
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        payload: (entry.payload ?? undefined) as Prisma.InputJsonValue | undefined,
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

    // Reconstruct the AuditLogEntry format
    // In production, we'd store previousHash and entryHash in the DB.
    // For now we reconstruct from payload metadata.
    const payload = (entry.payload as Record<string, unknown>) ?? {};
    return {
      id: entry.id,
      clientId: entry.clientId,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      payload,
      timestamp: entry.timestamp,
      previousHash: (payload._previousHash as string) ?? "GENESIS",
      entryHash: (payload._entryHash as string) ?? "",
    };
  }

  async getAllEntries(clientId: string): Promise<AuditLogEntry[]> {
    const entries = await prisma.auditLogEntry.findMany({
      where: { clientId },
      orderBy: { timestamp: "asc" },
    });

    return entries.map((entry) => {
      const payload = (entry.payload as Record<string, unknown>) ?? {};
      return {
        id: entry.id,
        clientId: entry.clientId,
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        payload,
        timestamp: entry.timestamp,
        previousHash: (payload._previousHash as string) ?? "GENESIS",
        entryHash: (payload._entryHash as string) ?? "",
      };
    });
  }
}

export const auditLogger = new AuditLogger(new PrismaAuditLogStore());
