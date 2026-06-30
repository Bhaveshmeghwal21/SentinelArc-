"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export default function CompliancePage() {
  const [reportType, setReportType] = React.useState("full_audit");
  const [format, setFormat] = React.useState("csv");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState("");

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/v1/compliance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_type: reportType,
          date_range: {
            from: dateFrom || undefined,
            to: dateTo || undefined,
          },
          format,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `compliance-${reportType}-${new Date().toISOString().split("T")[0]}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await response.json();
        setError(data.error || "Export failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Compliance Export</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate Report</CardTitle>
          <CardDescription>
            Generate regulator-grade compliance reports for specified time periods.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Report Type</label>
              <Select
                className="mt-1"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <option value="full_audit">Full Audit Log</option>
                <option value="incident_report">Incident Report</option>
                <option value="response_time">Response Time Report</option>
                <option value="review_outcomes">Review Outcomes Summary</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">From Date</label>
                <Input
                  type="date"
                  className="mt-1"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">To Date</label>
                <Input
                  type="date"
                  className="mt-1"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Format</label>
              <Select
                className="mt-1"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </Select>
            </div>

            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}

            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "Generating..." : "Generate Report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Type Descriptions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Full Audit Log</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Complete audit trail of all events: flags created, actions taken,
            reviews performed, and system decisions.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Incident Report</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Grouped by incident with full lifecycle: flag creation, actions
            taken, human review outcome, and resolution. Includes California SB 243 fields.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response Time Report</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Time from flag to action/resolution for each incident. Includes
            min, max, avg, and percentile metrics.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review Outcomes Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Aggregated true positive/false positive rates by category.
            Tracks reviewer accuracy and detection quality.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
