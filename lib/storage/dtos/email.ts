/** DTOs for email reports and templates. */

export class EmailReportConfig {
  id = "";
  name = "";
  recipients: string[] = [];
  cadence: "daily" | "weekly" | "biweekly" | "monthly" = "weekly";
  cadenceDay?: number;
  sections: Record<string, { enabled: boolean; detail: "low" | "medium" | "high" }> = {};
  createdAt = 0;
  updatedAt = 0;
}

export class EmailTemplate {
  id = "";
  name = "";
  subject = "";
  html = "";
  createdAt = 0;
  updatedAt = 0;
}
