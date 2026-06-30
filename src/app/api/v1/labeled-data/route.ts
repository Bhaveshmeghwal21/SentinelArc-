import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasRole } from "@/lib/rbac";
import { exportLabeledDataset, toJSONL } from "@/lib/labeled-dataset/pipeline";

/**
 * GET /api/v1/labeled-data
 * Export labeled dataset for a client (ADMIN only).
 * Supports JSONL format with versioning.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!hasRole(session.user.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Insufficient permissions - ADMIN required" },
      { status: 403 }
    );
  }

  const clientId = session.user.clientId;

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "jsonl";

  const entries = await exportLabeledDataset(clientId);

  if (format === "json") {
    return NextResponse.json({
      entries,
      metadata: {
        count: entries.length,
        client_id: clientId,
        exported_at: new Date().toISOString(),
      },
    });
  }

  // Default: JSONL format
  const jsonlContent = toJSONL(entries);

  return new NextResponse(jsonlContent, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="labeled-data-${clientId}.jsonl"`,
    },
  });
}
