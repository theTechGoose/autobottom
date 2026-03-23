/** DTOs for admin/org configuration. */

export class PipelineConfig {
  maxRetries = 5;
  retryDelaySeconds = 10;
  parallelism = 20;
}

export class WebhookConfigDto {
  postUrl = "";
  postHeaders: Record<string, string> = {};
  testEmail?: string;
  emailTemplateId?: string;
  bcc?: string;
}

export class BadWordConfig {
  enabled = false;
  emails: string[] = [];
  words: { word: string }[] = [];
  allOffices = false;
  officePatterns: string[] = [];
}

export class ReviewerConfig {
  allowedTypes: ("date-leg" | "package")[] = ["date-leg", "package"];
}

export class OfficeBypassConfig {
  // Office name patterns (case-insensitive contains). Matching offices skip review queue + audit emails.
  patterns: string[] = [];
}

export class ManagerScopeConfig {
  departments: string[] = [];
  shifts: string[] = [];
}
