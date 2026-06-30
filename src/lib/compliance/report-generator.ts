/**
 * Compliance Report Generator.
 *
 * Generates regulator-grade reports from the audit log:
 * - Full Audit Log: all events in chronological order
 * - Incident Report: flags grouped with actions, reviews, and outcomes
 * - Response Time Report: time from flag to action/resolution
 * - Review Outcomes Summary: TP/FP rates by category
 *
 * CSV format uses headers that map to known regulatory reporting templates,
 * including California SB 243 reporting fields.
 */

import { prisma } from "@/lib/prisma";

export type ReportType =
  | "full_audit"
  | "incident_report"
  | "response_time"
  | "review_outcomes";

export type ExportFormat = "csv" | "json";

export interface DateRange {
  from?: string;
  to?: string;
}

export interface ReportRequest {
  reportType: ReportType;
  clientId: string;
  dateRange: DateRange;
  format: ExportFormat;
}

export interface FullAuditRow {
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  details: string;
}

export interface IncidentRow {
  incident_id: string;
  flag_created_at: string;
  severity: string;
  category: string;
  action_taken: string;
  action_taken_at: string;
  review_outcome: string;
  review_resolved_at: string;
  response_time_seconds: number;
  end_user_id: string;
  conversation_id: string;
  // California SB 243 fields
  sb243_minor_involved: string;
  sb243_content_type: string;
  sb243_platform_action: string;
  sb243_notification_sent: string;
}

export interface ResponseTimeRow {
  incident_id: string;
  severity: string;
  category: string;
  flag_created_at: string;
  first_action_at: string;
  resolution_at: string;
  time_to_first_action_seconds: number;
  time_to_resolution_seconds: number;
}

export interface ReviewOutcomesRow {
  category: string;
  total_reviews: number;
  true_positives: number;
  false_positives: number;
  escalated: number;
  true_positive_rate: number;
  false_positive_rate: number;
}

/**
 * Generate a compliance report based on type and parameters.
 */
export async function generateReport(
  request: ReportRequest
): Promise<{ content: string; contentType: string; filename: string }> {
  const { reportType, clientId, dateRange, format } = request;

  switch (reportType) {
    case "full_audit":
      return generateFullAuditReport(clientId, dateRange, format);
    case "incident_report":
      return generateIncidentReport(clientId, dateRange, format);
    case "response_time":
      return generateResponseTimeReport(clientId, dateRange, format);
    case "review_outcomes":
      return generateReviewOutcomesReport(clientId, dateRange, format);
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}

function buildDateFilter(dateRange: DateRange): { gte?: Date; lte?: Date } | undefined {
  if (!dateRange.from && !dateRange.to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (dateRange.from) filter.gte = new Date(dateRange.from);
  if (dateRange.to) filter.lte = new Date(dateRange.to);
  return filter;
}

async function generateFullAuditReport(
  clientId: string,
  dateRange: DateRange,
  format: ExportFormat
): Promise<{ content: string; contentType: string; filename: string }> {
  const timestampFilter = buildDateFilter(dateRange);

  const entries = await prisma.auditLogEntry.findMany({
    where: {
      clientId,
      ...(timestampFilter ? { timestamp: timestampFilter } : {}),
    },
    orderBy: { timestamp: "asc" },
  });

  const rows: FullAuditRow[] = entries.map((entry) => ({
    timestamp: entry.timestamp.toISOString(),
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    details: JSON.stringify(entry.payload ?? {}),
  }));

  if (format === "json") {
    return {
      content: JSON.stringify({ report_type: "full_audit", rows }, null, 2),
      contentType: "application/json",
      filename: "full-audit-report.json",
    };
  }

  const csv = toCSV(
    ["timestamp", "actor", "action", "resource", "details"],
    rows.map((r) => [r.timestamp, r.actor, r.action, r.resource, r.details])
  );

  return {
    content: csv,
    contentType: "text/csv",
    filename: "full-audit-report.csv",
  };
}

async function generateIncidentReport(
  clientId: string,
  dateRange: DateRange,
  format: ExportFormat
): Promise<{ content: string; contentType: string; filename: string }> {
  const dateFilter = buildDateFilter(dateRange);

  const flags = await prisma.flag.findMany({
    where: {
      clientId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    include: {
      actions: { orderBy: { createdAt: "asc" }, take: 1 },
      reviewItems: {
        include: {
          decisions: { orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
      conversation: { select: { externalId: true, endUserId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: IncidentRow[] = flags.map((flag) => {
    const firstAction = flag.actions[0];
    const reviewItem = flag.reviewItems[0];
    const decision = reviewItem?.decisions[0];

    const flagTime = flag.createdAt.getTime();
    const actionTime = firstAction?.createdAt?.getTime() ?? flagTime;

    return {
      incident_id: flag.id,
      flag_created_at: flag.createdAt.toISOString(),
      severity: flag.severity,
      category: flag.category,
      action_taken: firstAction?.type ?? "NONE",
      action_taken_at: firstAction?.createdAt?.toISOString() ?? "",
      review_outcome: decision?.outcome ?? "PENDING",
      review_resolved_at: decision?.createdAt?.toISOString() ?? "",
      response_time_seconds: Math.round((actionTime - flagTime) / 1000),
      end_user_id: flag.conversation.endUserId,
      conversation_id: flag.conversation.externalId,
      // SB 243 fields
      sb243_minor_involved: "UNKNOWN",
      sb243_content_type: flag.category,
      sb243_platform_action: firstAction?.type ?? "PENDING_REVIEW",
      sb243_notification_sent: firstAction ? "YES" : "NO",
    };
  });

  if (format === "json") {
    return {
      content: JSON.stringify({ report_type: "incident_report", rows }, null, 2),
      contentType: "application/json",
      filename: "incident-report.json",
    };
  }

  const headers = [
    "incident_id",
    "flag_created_at",
    "severity",
    "category",
    "action_taken",
    "action_taken_at",
    "review_outcome",
    "review_resolved_at",
    "response_time_seconds",
    "end_user_id",
    "conversation_id",
    "sb243_minor_involved",
    "sb243_content_type",
    "sb243_platform_action",
    "sb243_notification_sent",
  ];

  const csv = toCSV(
    headers,
    rows.map((r) => headers.map((h) => String(r[h as keyof IncidentRow])))
  );

  return {
    content: csv,
    contentType: "text/csv",
    filename: "incident-report.csv",
  };
}

async function generateResponseTimeReport(
  clientId: string,
  dateRange: DateRange,
  format: ExportFormat
): Promise<{ content: string; contentType: string; filename: string }> {
  const dateFilter = buildDateFilter(dateRange);

  const flags = await prisma.flag.findMany({
    where: {
      clientId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    include: {
      actions: { orderBy: { createdAt: "asc" }, take: 1 },
      reviewItems: {
        include: {
          decisions: { orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: ResponseTimeRow[] = flags.map((flag) => {
    const firstAction = flag.actions[0];
    const reviewItem = flag.reviewItems[0];
    const decision = reviewItem?.decisions[0];

    const flagTime = flag.createdAt.getTime();
    const actionTime = firstAction?.createdAt?.getTime() ?? flagTime;
    const resolveTime = decision?.createdAt?.getTime() ?? actionTime;

    return {
      incident_id: flag.id,
      severity: flag.severity,
      category: flag.category,
      flag_created_at: flag.createdAt.toISOString(),
      first_action_at: firstAction?.createdAt?.toISOString() ?? "",
      resolution_at: decision?.createdAt?.toISOString() ?? "",
      time_to_first_action_seconds: Math.round((actionTime - flagTime) / 1000),
      time_to_resolution_seconds: Math.round((resolveTime - flagTime) / 1000),
    };
  });

  if (format === "json") {
    return {
      content: JSON.stringify({ report_type: "response_time", rows }, null, 2),
      contentType: "application/json",
      filename: "response-time-report.json",
    };
  }

  const headers = [
    "incident_id",
    "severity",
    "category",
    "flag_created_at",
    "first_action_at",
    "resolution_at",
    "time_to_first_action_seconds",
    "time_to_resolution_seconds",
  ];

  const csv = toCSV(
    headers,
    rows.map((r) => headers.map((h) => String(r[h as keyof ResponseTimeRow])))
  );

  return {
    content: csv,
    contentType: "text/csv",
    filename: "response-time-report.csv",
  };
}

async function generateReviewOutcomesReport(
  clientId: string,
  dateRange: DateRange,
  format: ExportFormat
): Promise<{ content: string; contentType: string; filename: string }> {
  const dateFilter = buildDateFilter(dateRange);

  const reviewItems = await prisma.reviewItem.findMany({
    where: {
      clientId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    include: {
      flag: { select: { category: true } },
      decisions: { take: 1 },
    },
  });

  // Group by category
  const categories = new Map<
    string,
    { total: number; tp: number; fp: number; escalated: number }
  >();

  for (const item of reviewItems) {
    const cat = item.flag.category;
    if (!categories.has(cat)) {
      categories.set(cat, { total: 0, tp: 0, fp: 0, escalated: 0 });
    }
    const stats = categories.get(cat)!;
    stats.total++;

    const decision = item.decisions[0];
    if (decision) {
      switch (decision.outcome) {
        case "TRUE_POSITIVE":
          stats.tp++;
          break;
        case "FALSE_POSITIVE":
          stats.fp++;
          break;
        case "ESCALATE":
          stats.escalated++;
          break;
      }
    }
  }

  const rows: ReviewOutcomesRow[] = Array.from(categories.entries()).map(
    ([category, stats]) => ({
      category,
      total_reviews: stats.total,
      true_positives: stats.tp,
      false_positives: stats.fp,
      escalated: stats.escalated,
      true_positive_rate: stats.total > 0 ? stats.tp / stats.total : 0,
      false_positive_rate: stats.total > 0 ? stats.fp / stats.total : 0,
    })
  );

  if (format === "json") {
    return {
      content: JSON.stringify({ report_type: "review_outcomes", rows }, null, 2),
      contentType: "application/json",
      filename: "review-outcomes-report.json",
    };
  }

  const headers = [
    "category",
    "total_reviews",
    "true_positives",
    "false_positives",
    "escalated",
    "true_positive_rate",
    "false_positive_rate",
  ];

  const csv = toCSV(
    headers,
    rows.map((r) => headers.map((h) => String(r[h as keyof ReviewOutcomesRow])))
  );

  return {
    content: csv,
    contentType: "text/csv",
    filename: "review-outcomes-report.csv",
  };
}

/**
 * Convert rows to CSV format with proper escaping.
 */
export function toCSV(headers: string[], rows: string[][]): string {
  const escapeCsvField = (field: string): string => {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  };

  const lines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ];

  return lines.join("\n");
}
