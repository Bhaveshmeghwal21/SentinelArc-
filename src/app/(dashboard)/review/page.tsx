"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ReviewItemSummary {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  snippet: string;
  flaggedAt: string;
  assignee: string | null;
  status: "PENDING" | "IN_REVIEW" | "RESOLVED";
}

const severityVariant: Record<string, "destructive" | "warning" | "secondary" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "secondary",
};

export default function ReviewQueuePage() {
  const [items, setItems] = React.useState<ReviewItemSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filters, setFilters] = React.useState({
    severity: "",
    category: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });

  React.useEffect(() => {
    fetchReviewItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function fetchReviewItems() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.category) params.set("category", filters.category);
      if (filters.status) params.set("status", filters.status);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);

      const response = await fetch(`/api/v1/reviews?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Review Queue</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <Select
              value={filters.severity}
              onChange={(e) =>
                setFilters((f) => ({ ...f, severity: e.target.value }))
              }
            >
              <option value="">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>

            <Select
              value={filters.category}
              onChange={(e) =>
                setFilters((f) => ({ ...f, category: e.target.value }))
              }
            >
              <option value="">All Categories</option>
              <option value="self_harm">Self-harm</option>
              <option value="sexual_content">Sexual Content</option>
              <option value="age_inappropriate">Age Inappropriate</option>
              <option value="escalation">Escalation</option>
            </Select>

            <Select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value }))
              }
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_REVIEW">In Review</option>
              <option value="RESOLVED">Resolved</option>
            </Select>

            <Input
              type="date"
              placeholder="From date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateFrom: e.target.value }))
              }
            />

            <Input
              type="date"
              placeholder="To date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateTo: e.target.value }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Review Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-muted-foreground">Loading...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-muted-foreground">No review items found</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Snippet</TableHead>
                  <TableHead>Flagged</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant={severityVariant[item.severity] ?? "outline"}>
                        {item.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.category.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {item.snippet}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.flaggedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{item.assignee ?? "Unassigned"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/review/${item.id}`}>
                        <Button size="sm" variant="outline">
                          Review
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
