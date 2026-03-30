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
  dismissalTemplateId?: string;
  bcc?: string;
}

export class BadWordConfig {
  enabled = false;
  emails: string[] = [];
  words: { word: string; exclusions?: { word: string; buffer: number; type: string }[] }[] = [];
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

export class AuditDimensionsConfig {
  // Persistent index of all seen departments/shifts + manually added offices.
  departments: string[] = [];
  shifts: string[] = [];
}

export class PartnerDimensionsConfig {
  // Persistent index of partner offices and their GM emails.
  offices: Record<string, string[]> = {};
}

export class BonusPointsConfig {
  /** Bonus points for internal (date-leg) audits. 0 = disabled. */
  internalBonusPoints = 0;
  /** Bonus points for partner (package) audits. 0 = disabled. */
  partnerBonusPoints = 0;
}
