import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const API_KEY_PREFIX = "sa_live_";
const KEY_BYTE_LENGTH = 32;

export interface ApiKeyContext {
  clientId: string;
  apiKeyId: string;
}

/**
 * Generates a new API key with the sa_live_ prefix.
 * Returns the full key (to be shown once to the user) and the prefix for lookup.
 */
export function generateApiKey(): { fullKey: string; prefix: string } {
  const randomBytes = crypto.randomBytes(KEY_BYTE_LENGTH);
  const keyBody = randomBytes.toString("base64url");
  const fullKey = `${API_KEY_PREFIX}${keyBody}`;
  // First 12 characters after the prefix, used for quick lookup
  const prefix = fullKey.substring(0, API_KEY_PREFIX.length + 12);
  return { fullKey, prefix };
}

/**
 * Hashes an API key for secure storage.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Validates an API key from a request header.
 * Returns the client context if valid, null otherwise.
 */
export async function validateApiKey(
  apiKey: string | null | undefined
): Promise<ApiKeyContext | null> {
  if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashApiKey(apiKey);

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!apiKeyRecord || apiKeyRecord.revokedAt !== null) {
    return null;
  }

  // Update last used timestamp (fire and forget)
  prisma.apiKey
    .update({
      where: { id: apiKeyRecord.id },
      data: { lastUsed: new Date() },
    })
    .catch(() => {
      // Non-critical, don't block the request
    });

  return {
    clientId: apiKeyRecord.clientId,
    apiKeyId: apiKeyRecord.id,
  };
}
