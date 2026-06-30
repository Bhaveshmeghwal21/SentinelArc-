import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasRole } from "@/lib/rbac";
import { generateReport, type ReportType, type ExportFormat } from "@/lib/compliance/report-generator";
import { auditLogger } from "@/lib/audit/instance";

const ExportRequestSchema = z.object({
  report_type: z.enum(["full_audit", "incident_report", "response_time", "review_outcomes"]),
  date_range: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional().default({}),
  format: z.enum(["csv", "json"]).optional().default("csv"),
});

/**
 * POST /api/v1/compliance/export
 * Generate compliance exports.
 * Accepts: report_type, date_range, format (csv/json).
 * Returns the file content directly.
 */
export async function POST(request: Request): Promise<NextResponse | Response> {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parseResult = ExportRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parseResult.error.issues },
      { status: 422 }
    );
  }

  const { report_type, date_range, format } = parseResult.data;
  const clientId = session.user.clientId;

  try {
    const result = await generateReport({
      reportType: report_type as ReportType,
      clientId,
      dateRange: date_range,
      format: format as ExportFormat,
    });

    // Audit log the export
    await auditLogger.log({
      clientId,
      actor: session.user.id,
      action: "compliance.exported",
      resource: `report:${report_type}`,
      payload: { report_type, date_range, format },
    });

    return new Response(result.content, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Report generation failed" },
      { status: 500 }
    );
  }
}
