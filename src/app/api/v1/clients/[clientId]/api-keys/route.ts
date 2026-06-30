import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateApiKey, hashApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";
import { assertTenantAccess } from "@/lib/tenant";

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(255),
});

export async function POST(
  request: Request,
  { params }: { params: { clientId: string } }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const tenantError = assertTenantAccess(params.clientId, session.user.clientId);
  if (tenantError) return tenantError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parseResult = CreateApiKeySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parseResult.error.issues },
      { status: 422 }
    );
  }

  const { name } = parseResult.data;
  const { fullKey, prefix } = generateApiKey();
  const keyHash = hashApiKey(fullKey);

  const apiKeyRecord = await prisma.apiKey.create({
    data: {
      name,
      prefix,
      keyHash,
      clientId: params.clientId,
    },
  });

  return NextResponse.json(
    {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      key: fullKey, // Only returned once
      prefix: apiKeyRecord.prefix,
      created_at: apiKeyRecord.createdAt,
    },
    { status: 201 }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: { clientId: string } }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const tenantError = assertTenantAccess(params.clientId, session.user.clientId);
  if (tenantError) return tenantError;

  const keys = await prisma.apiKey.findMany({
    where: {
      clientId: params.clientId,
      revokedAt: null,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsed: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ keys });
}

export async function DELETE(
  request: Request,
  { params }: { params: { clientId: string } }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const tenantError = assertTenantAccess(params.clientId, session.user.clientId);
  if (tenantError) return tenantError;

  const { searchParams } = new URL(request.url);
  const keyId = searchParams.get("key_id");

  if (!keyId) {
    return NextResponse.json(
      { error: "key_id query parameter required" },
      { status: 400 }
    );
  }

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      id: keyId,
      clientId: params.clientId,
    },
  });

  if (!apiKey) {
    return NextResponse.json(
      { error: "API key not found" },
      { status: 404 }
    );
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ status: "revoked" });
}
