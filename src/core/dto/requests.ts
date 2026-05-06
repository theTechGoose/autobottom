/** Request DTO classes for swagger documentation.
 *  Replace Record<string, any> in @Body() decorators.
 *  Every property must have a default value for Reflect.construct(). */

// ── Auth ─────────────────────────────────────────────────────────────────────

export class LoginRequest { email = ""; password = ""; }
export class RegisterRequest { email = ""; password = ""; orgName = ""; orgId = ""; }

// ── User Management ──────────────────────────────────────────────────────────

export class CreateUserRequest { email = ""; password = ""; role = ""; supervisor = ""; }
export class DeleteEmailRequest { email = ""; }

// ── Finding/Audit ────────────────────────────────────────────────────────────

export class FindingIdRequest { findingId = ""; }
export class RetryFindingRequest { findingId = ""; step = ""; }
export class FlipAnswerRequest { findingId = ""; questionIndex = 0; }
export class StepRequest { findingId = ""; orgId = ""; totalBatches = 0; }

// ── Review/Judge ─────────────────────────────────────────────────────────────

export class ReviewDecideRequest { findingId = ""; questionIndex = 0; decision = ""; reviewer = ""; }
export class JudgeDecideRequest { findingId = ""; questionIndex = 0; decision = ""; judge = ""; reason = ""; }
export class ReviewerConfigRequest { email = ""; config: unknown = {}; }
export class ReviewBackRequest { findingId = ""; questionIndex = 0; reviewer = ""; }

// ── Manager ──────────────────────────────────────────────────────────────────

export class RemediateRequest { findingId = ""; notes = ""; username = ""; }
export class CreateAgentRequest { email = ""; password = ""; supervisor = ""; }
export class PrefabSubscriptionsRequest { subscriptions: unknown = {}; }

// ── Admin Config ─────────────────────────────────────────────────────────────

export class PipelineConfigRequest { maxRetries = 0; retryDelaySeconds = 0; parallelism = 0; }
export class ParallelismRequest { parallelism = 0; }
export class WebhookSettingsRequest { postUrl = ""; postHeaders: unknown = {}; emailTemplateId = ""; bcc = ""; }
export class BadWordConfigRequest { enabled = false; emails: string[] = []; words: unknown[] = []; allOffices = false; officePatterns: string[] = []; }
export class BypassConfigRequest { patterns: string[] = []; }
export class BonusConfigRequest { internalBonusPoints = 0; partnerBonusPoints = 0; }
export class ManagerScopeRequest { email = ""; scope: unknown = {}; }
export class DimensionsRequest { departments: string[] = []; shifts: string[] = []; }
export class IdRequest { id = ""; }
export class TimeRangeRequest { since = 0; until = 0; }

// ── Reporting ────────────────────────────────────────────────────────────────

export class PostToSheetRequest { since = 0; until = 0; tabs = ""; }

// ── Question Lab ─────────────────────────────────────────────────────────────

export class CreateConfigRequest { name = ""; type = "internal"; }
export class CreateQuestionRequest { configId = ""; name = ""; text = ""; }
export class RestoreVersionRequest { id = ""; versionIndex = 0; }
export class BulkEgregiousRequest { name = ""; egregious = false; }
export class CreateTestRequest { questionId = ""; input = ""; expectedAnswer = ""; }
export class AssignmentRequest { type = ""; key = ""; value: string | null = null; }

// ── Gamification ─────────────────────────────────────────────────────────────

export class PackIdRequest { packId = ""; }
export class PurchaseRequest { email = ""; itemId = ""; price = 0; }

// ── Chat ─────────────────────────────────────────────────────────────────────

export class SendMessageRequest { from = ""; to = ""; body = ""; }

// ── Generic ──────────────────────────────────────────────────────────────────

export class GenericBodyRequest { data: unknown = {}; }

// Zod validation schemas — shape-checker compliance
import { z } from "#zod";
export const LoginRequestSchema = z.object({ email: z.string(), password: z.string() });
export const CreateUserRequestSchema = z.object({ email: z.string(), password: z.string(), role: z.string() });
export const FindingIdRequestSchema = z.object({ findingId: z.string() });
