/** VO dashboard backend (REQ-034..038).
 *
 *  A VO login is scoped exactly like a manager — a `manager-scope-config`
 *  record of departments (+ optional shifts) keyed by its email, edited on the
 *  admin Users → Scopes tab. Its queue is the manager queue for that scope,
 *  with each row's TM review attached.
 *
 *  A review lives in its own write-once `tm-review` record keyed by finding
 *  id, never on the queue row: queue rows are rewritten by enrichment, the
 *  appeal paths and remediation, and "once reviewed, always reviewed" has to
 *  survive every one of them. */
import {
  listStoredByFieldIn, setStoredIfAbsent, FIELD_IN_MAX_VALUES,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { attachTmReviews, TM_REVIEW_TYPE, type TmReview } from "@core/business/tm-review/mod.ts";
import { getManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import {
  loadScopedManagerQueue, type ManagerQueueItem,
} from "@manager/domain/data/manager-repository/mod.ts";

export type VoQueueItem = ManagerQueueItem & { tmReview?: TmReview };

/** Every TM review for these departments — one IN query per 30 departments. */
async function listReviewsForDepartments(orgId: OrgId, departments: string[]): Promise<TmReview[]> {
  const depts = [...new Set(departments.filter((d) => d !== undefined && d !== null))];
  const out: TmReview[] = [];
  for (let i = 0; i < depts.length; i += FIELD_IN_MAX_VALUES) {
    out.push(...await listStoredByFieldIn<TmReview>(TM_REVIEW_TYPE, orgId, "department", depts.slice(i, i + FIELD_IN_MAX_VALUES)));
  }
  return out;
}

/** Any queue rows, each with its TM review attached when it has one. Reviews
 *  are fetched by the rows' own departments, so the cost tracks the page. */
export async function attachReviewsForManager<T extends { findingId: string; department?: string }>(
  orgId: OrgId,
  items: T[],
): Promise<Array<T & { tmReview?: TmReview }>> {
  if (items.length === 0) return [];
  const reviews = await listReviewsForDepartments(orgId, items.map((i) => i.department ?? ""));
  return attachTmReviews(items, reviews);
}

/** A VO login's queue: its scope's failed audits, reviews attached. A login
 *  with no department assigned sees nothing — an empty manager scope means
 *  "every department", which is never what a VO login is for. */
export async function loadVoView(orgId: OrgId, voEmail: string): Promise<VoQueueItem[]> {
  const scope = await getManagerScope(orgId, voEmail);
  if ((scope.departments ?? []).length === 0) return [];
  const items = await loadScopedManagerQueue(orgId, scope);
  return await attachReviewsForManager(orgId, items);
}

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; error: "note-required" | "not-in-scope" | "already-reviewed" };

/** Record a TM review. The audit must be in the VO login's own queue, the
 *  write-up must say something, and only the first review is ever kept. */
export async function submitTmReview(
  orgId: OrgId,
  input: { voEmail: string; reviewedBy: string; findingId: string; note: string },
): Promise<SubmitReviewResult> {
  const note = (input.note ?? "").trim();
  if (!note) return { ok: false, error: "note-required" };
  const item = (await loadVoView(orgId, input.voEmail)).find((i) => i.findingId === input.findingId);
  if (!item) return { ok: false, error: "not-in-scope" };
  if (item.tmReview) return { ok: false, error: "already-reviewed" };
  const review: TmReview = {
    findingId: input.findingId,
    department: item.department ?? "",
    note,
    reviewedBy: input.reviewedBy,
    reviewedAt: Date.now(),
  };
  const wrote = await setStoredIfAbsent(TM_REVIEW_TYPE, orgId, [input.findingId], review);
  if (!wrote) return { ok: false, error: "already-reviewed" };
  console.log(`📝 [VO] ${input.findingId}: reviewed by ${input.reviewedBy}`);
  return { ok: true };
}
