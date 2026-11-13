/** Department question order — storage and edit rights (REQ-053/055).
 *
 *  One `department-question-order` record per department name, holding the
 *  list a manager arranged on the Configure tab. Every dashboard for that
 *  department (the manager queue, the VO dashboard) ranks its rows by it.
 *  Managers sharing a department share the list; the last save wins and the
 *  record keeps who saved it and when. */
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { effectiveOrder } from "@core/business/question-order/mod.ts";
import { getManagerScope, listManagerScopes } from "@admin/domain/data/admin-repository/mod.ts";

const TYPE = "department-question-order";

interface StoredQuestionOrder {
  order: string[];
  updatedBy: string;
  updatedAt: number;
}

export interface DepartmentQuestionOrder {
  department: string;
  order: string[];
  /** True until someone saves a list for this department. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: number;
}

export async function getDepartmentQuestionOrder(orgId: OrgId, department: string): Promise<DepartmentQuestionOrder> {
  const stored = await getStored<StoredQuestionOrder>(TYPE, orgId, department);
  if (!stored) return { department, order: effectiveOrder(null), isDefault: true };
  return {
    department,
    order: effectiveOrder(stored.order),
    isDefault: false,
    updatedBy: stored.updatedBy,
    updatedAt: stored.updatedAt,
  };
}

export type SaveQuestionOrderResult =
  | { ok: true; saved: DepartmentQuestionOrder }
  | { ok: false; error: "department-required" | "order-required" };

export async function saveDepartmentQuestionOrder(
  orgId: OrgId,
  department: string,
  order: unknown,
  by: string,
): Promise<SaveQuestionOrderResult> {
  const dept = (department ?? "").trim();
  if (!dept) return { ok: false, error: "department-required" };
  const names = Array.isArray(order) ? order.filter((q): q is string => typeof q === "string" && q.trim() !== "") : [];
  if (names.length === 0) return { ok: false, error: "order-required" };
  const record: StoredQuestionOrder = { order: effectiveOrder(names), updatedBy: by, updatedAt: Date.now() };
  await setStored(TYPE, orgId, [dept], record);
  console.log(`🎚️ [QUESTION-ORDER] ${dept}: saved by ${by}`);
  return { ok: true, saved: { department: dept, order: record.order, isDefault: false, updatedBy: by, updatedAt: record.updatedAt } };
}

/** Each department's list (the default where none is saved), keyed by name. */
export async function loadQuestionOrders(orgId: OrgId, departments: string[]): Promise<Record<string, string[]>> {
  const depts = [...new Set(departments.filter((d) => typeof d === "string" && d !== ""))];
  const lists = await Promise.all(depts.map((d) => getDepartmentQuestionOrder(orgId, d)));
  return Object.fromEntries(lists.map((l) => [l.department, l.order]));
}

/** Departments whose list this person may change, sorted. A manager: their own
 *  scope. An admin: every department anyone is scoped to. Anyone else —
 *  a VO login included — none. */
export async function editableDepartments(orgId: OrgId, who: { role: string; email: string }): Promise<string[]> {
  if (who.role === "manager") {
    const scope = await getManagerScope(orgId, who.email);
    return [...new Set(scope.departments ?? [])].sort((a, b) => a.localeCompare(b));
  }
  if (who.role === "admin") {
    const all = new Set<string>();
    for (const scope of Object.values(await listManagerScopes(orgId))) {
      for (const d of scope.departments ?? []) all.add(d);
    }
    return [...all].sort((a, b) => a.localeCompare(b));
  }
  return [];
}

/** What a manager edits (REQ-055 AMENDMENT): one list for all their
 *  departments. Shown as the most recently saved list among them (the default
 *  when none is saved); `mixed` says their departments currently differ, so
 *  the page can warn that Save will line them all up. */
export interface ManagerQuestionOrder {
  departments: string[];
  order: string[];
  isDefault: boolean;
  mixed: boolean;
  updatedBy?: string;
  updatedAt?: number;
}

export async function getManagerQuestionOrder(orgId: OrgId, departments: string[]): Promise<ManagerQuestionOrder> {
  const lists = await Promise.all([...new Set(departments)].map((d) => getDepartmentQuestionOrder(orgId, d)));
  const saved = lists.filter((l) => !l.isDefault).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const newest = saved[0];
  const mixed = new Set(lists.map((l) => l.order.join("\n"))).size > 1;
  if (!newest) return { departments, order: effectiveOrder(null), isDefault: true, mixed };
  return { departments, order: newest.order, isDefault: false, mixed, updatedBy: newest.updatedBy, updatedAt: newest.updatedAt };
}

/** One Save for several departments — every one gets the same order. */
export async function saveQuestionOrderForDepartments(
  orgId: OrgId,
  departments: string[],
  order: unknown,
  by: string,
): Promise<SaveQuestionOrderResult> {
  const depts = [...new Set(departments.map((d) => (d ?? "").trim()).filter(Boolean))];
  if (depts.length === 0) return { ok: false, error: "department-required" };
  const results = await Promise.all(depts.map((d) => saveDepartmentQuestionOrder(orgId, d, order, by)));
  const failed = results.find((r) => !r.ok);
  return failed ?? results[0];
}
