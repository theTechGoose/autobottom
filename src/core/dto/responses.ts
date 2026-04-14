/** Response DTO classes for swagger documentation.
 *  Every class must have default-valued properties so Reflect.construct(Cls, []) works.
 *  Swagger calls Object.getOwnPropertyNames() on the instance to discover the schema. */

// ── Generic ──────────────────────────────────────────────────────────────────

export class OkResponse { ok = true; }
export class ErrorResponse { error = ""; }
export class MessageResponse { message = ""; }
export class OkMessageResponse { ok = true; message = ""; }

// ── Auth ─────────────────────────────────────────────────────────────────────

export class LoginResponse { ok = true; token = ""; cookie = ""; email = ""; orgId = ""; role = ""; }
export class RegisterResponse { ok = true; token = ""; cookie = ""; orgId = ""; }
export class LogoutResponse { ok = true; cookie = ""; }

// ── Audit Pipeline ───────────────────────────────────────────────────────────

export class AuditQueuedResponse { jobId = ""; findingId = ""; status = "queued"; }
export class StepResponse { ok = true; step = ""; findingId = ""; }
export class FindingResponse { id = ""; findingStatus = ""; auditJobId = ""; }
export class PipelineStatsResponse { inPipe = 0; completed24h = 0; errors24h = 0; }

// ── Review ───────────────────────────────────────────────────────────────────

export class ReviewStatsResponse { pending = 0; decided = 0; pendingAuditCount = 0; }
export class ReviewBufferResponse { buffer: unknown[] = []; remaining = 0; }
export class DecisionResponse { ok = true; remaining = 0; }
export class ReviewerConfigResponse { allowedTypes: string[] = []; }

// ── Judge ────────────────────────────────────────────────────────────────────

export class JudgeStatsResponse { pending = 0; decided = 0; }
export class DismissResponse { dismissed = 0; }
export class ReviewerListResponse { reviewers: unknown[] = []; }

// ── Manager ──────────────────────────────────────────────────────────────────

export class ManagerStatsResponse { total = 0; pending = 0; remediated = 0; }
export class ManagerQueueResponse { items: unknown[] = []; }
export class AgentListResponse { agents: unknown[] = []; }

// ── Admin Config ─────────────────────────────────────────────────────────────

export class PipelineConfigResponse { maxRetries = 0; retryDelaySeconds = 0; parallelism = 0; }
export class ParallelismResponse { parallelism = 0; }
export class WebhookConfigResponse { postUrl = ""; postHeaders: unknown = {}; }
export class BadWordConfigResponse { enabled = false; emails: string[] = []; words: unknown[] = []; }
export class BypassConfigResponse { patterns: string[] = []; }
export class BonusConfigResponse { internalBonusPoints = 0; partnerBonusPoints = 0; }
export class DimensionsResponse { departments: string[] = []; shifts: string[] = []; }
export class PartnerDimensionsResponse { offices: unknown = {}; }
export class QueueCountsResponse { queues: unknown = {}; }
export class ClearedResponse { ok = true; cleared = 0; }
export class TerminatedResponse { ok = true; terminated = 0; }
export class UserListResponse { users: unknown[] = []; }

// ── Dashboard ────────────────────────────────────────────────────────────────

export class DashboardDataResponse { pipeline: unknown = {}; review: unknown = {}; recentCompleted: unknown[] = []; }
export class AuditsDataResponse { audits: unknown[] = []; }
export class FindingsResponse { findings: unknown[] = []; }

// ── Reporting ────────────────────────────────────────────────────────────────

export class ChargebackReportResponse { chargebacks: unknown[] = []; omissions: unknown[] = []; }
export class WireReportResponse { items: unknown[] = []; }
export class EmailConfigListResponse { configs: unknown[] = []; }
export class EmailTemplateListResponse { templates: unknown[] = []; }
export class EmailPreviewResponse { html = ""; }
export class TokenUsageResponse { total_tokens = 0; prompt_tokens = 0; completion_tokens = 0; calls = 0; }

// ── Question Lab ─────────────────────────────────────────────────────────────

export class QLConfigListResponse { configs: unknown[] = []; }
export class QLConfigResponse { id = ""; name = ""; type = ""; }
export class QLQuestionResponse { id = ""; configId = ""; name = ""; text = ""; }
export class QLQuestionNamesResponse { names: unknown[] = []; }
export class QLTestListResponse { runs: unknown[] = []; }
export class QLAssignmentsResponse { internal: unknown = {}; partner: unknown = {}; }
export class BulkUpdateResponse { ok = true; updated = 0; }

// ── Gamification ─────────────────────────────────────────────────────────────

export class SoundPackListResponse { packs: unknown[] = []; }
export class GamificationSettingsResponse { threshold = 0; comboTimeoutMs = 0; enabled = true; }
export class StoreItemListResponse { items: unknown[] = []; }
export class PurchaseResponse { ok = true; newBalance = 0; }
export class BadgeListResponse { badges: unknown[] = []; }
export class EarnedBadgesResponse { badges: unknown[] = []; }

// ── Chat/Events ──────────────────────────────────────────────────────────────

export class MessageSentResponse { id = ""; from = ""; to = ""; body = ""; ts = 0; }
export class UnreadCountResponse { count = 0; }
export class ConversationListResponse { conversations: unknown[] = []; }
export class EventsResponse { events: unknown[] = []; broadcasts: unknown[] = []; }

// ── Weekly Builder ───────────────────────────────────────────────────────────

export class WeeklyDataResponse { reports: unknown[] = []; schedules: unknown[] = []; }
