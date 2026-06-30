/**
 * Stats API endpoint.
 *
 * Returns aggregate statistics for the authenticated client.
 * All queries are tenant-isolated.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTenantFilter } from "@/lib/tenant";

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const { clientId } = session.user;
  const tenantFilter = getTenantFilter(clientId);

  // Parse query params for date range
  const url = new URL(request.url);
  const queryResult = QuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (!queryResult.success) {
    return NextResponse.json(
      { error: "Invalid date range parameters" },
      { status: 400 }
    );
  }

  const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (queryResult.data.from || queryResult.data.to) {
    dateFilter.createdAt = {};
    if (queryResult.data.from) {
      dateFilter.createdAt.gte = new Date(queryResult.data.from);
    }
    if (queryResult.data.to) {
      dateFilter.createdAt.lte = new Date(queryResult.data.to);
    }
  }

  // Gather aggregate statistics
  const [
    conversationCount,
    turnCount,
    flags,
    actions,
    crisisRouteCount,
    crisisRouteEvents,
  ] = await Promise.all([
    prisma.conversation.count({
      where: { ...tenantFilter, ...dateFilter },
    }),
    prisma.conversationTurn.count({
      where: {
        conversation: { ...tenantFilter },
        ...dateFilter,
      },
    }),
    prisma.flag.findMany({
      where: { ...tenantFilter, ...dateFilter },
      select: {
        category: true,
        severity: true,
      },
    }),
    prisma.action.findMany({
      where: { ...tenantFilter, ...dateFilter },
      select: { type: true },
    }),
    prisma.crisisRouteEvent.count({
      where: { ...tenantFilter, ...dateFilter },
    }),
    prisma.crisisRouteEvent.findMany({
      where: { ...tenantFilter, ...dateFilter },
      select: { latencyMs: true },
    }),
  ]);

  // Aggregate flags by category and severity
  const flagsByCategory: Record<string, number> = {};
  const flagsBySeverity: Record<string, number> = {};
  for (const flag of flags) {
    flagsByCategory[flag.category] = (flagsByCategory[flag.category] ?? 0) + 1;
    flagsBySeverity[flag.severity] = (flagsBySeverity[flag.severity] ?? 0) + 1;
  }

  // Aggregate actions by type
  const actionsByType: Record<string, number> = {};
  for (const action of actions) {
    actionsByType[action.type] = (actionsByType[action.type] ?? 0) + 1;
  }

  // Calculate average response time from crisis route events
  const averageResponseTimeMs =
    crisisRouteEvents.length > 0
      ? Math.round(
          crisisRouteEvents.reduce((sum, e) => sum + e.latencyMs, 0) /
            crisisRouteEvents.length
        )
      : 0;

  // Calculate false positive rate from review decisions
  const reviewDecisions = await prisma.reviewDecision.findMany({
    where: {
      reviewItem: { ...tenantFilter },
      ...dateFilter,
    },
    select: { outcome: true },
  });

  const totalDecisions = reviewDecisions.length;
  const falsePositives = reviewDecisions.filter(
    (d) => d.outcome === "FALSE_POSITIVE"
  ).length;
  const falsePositiveRate =
    totalDecisions > 0 ? falsePositives / totalDecisions : 0;

  return NextResponse.json({
    conversation_count: conversationCount,
    turn_count: turnCount,
    flag_count: flags.length,
    flags_by_category: flagsByCategory,
    flags_by_severity: flagsBySeverity,
    action_count: actions.length,
    actions_by_type: actionsByType,
    average_response_time_ms: averageResponseTimeMs,
    false_positive_rate: falsePositiveRate,
    crisis_route_count: crisisRouteCount,
  });
}
