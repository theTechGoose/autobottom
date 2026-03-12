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
