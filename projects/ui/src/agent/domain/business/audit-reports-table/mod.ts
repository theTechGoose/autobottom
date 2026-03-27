import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AuditRecord = any;

@Component({ template: "./mod.html" })
export class AuditReportsTable {
  @Input() audits: AuditRecord[] = [];

  scoreColor(pct: number): string {
    if (pct >= 80) return "green";
    if (pct >= 60) return "yellow";
    return "red";
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return "--";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  getScore(audit: AuditRecord): number {
    const total = audit.totalQuestions || 0;
    const passed = audit.passedCount || 0;
    return total > 0 ? Math.round((passed / total) * 100) : 0;
  }

  getReportUrl(audit: AuditRecord): string {
    return "/audit/report?id=" + encodeURIComponent(audit.findingId || "");
  }
}
