/** Manager Configure tab (REQ-053/055) — "Configure question order".
 *
 *  The worst-fails list the manager queue and the VO dashboard rank audits by.
 *  A manager edits ONE list and Save writes it to every department in their
 *  scope (REQ-055 AMENDMENT); managers sharing a department share its list.
 *  An admin with no `?as=` picks one department at a time; with
 *  `?as=<manager>` they edit that manager's list. */
import type { JSX } from "preact";
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import QuestionOrderEditor from "../../islands/QuestionOrderEditor.tsx";
import { DEFAULT_QUESTION_ORDER } from "@core/business/question-order/mod.ts";

export interface OrderResponse {
  /** "manager": one list for all `departments`; "department": one department (admin). */
  scope?: "manager" | "department";
  mixed?: boolean;
  departments: string[];
  department: string;
  order: string[];
  isDefault?: boolean;
  updatedBy?: string;
  updatedAt?: number;
}

/** What the list on this page applies to (REQ-055 AMENDMENT): for a manager,
 *  every department in their scope (with a warning when those departments
 *  currently differ); for an admin, the one department picked. */
export function renderEditingScope(data: OrderResponse): JSX.Element {
  if (data.scope === "manager") {
    return (
      <div class="qo-editing" style="margin-bottom:10px;font-size:14px;">
        {data.departments.length === 1 ? "Applies to " : "Applies to all your departments: "}
        {data.departments.map((d, i) => <>{i > 0 && ", "}<strong>{d}</strong></>)}
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">
          Managers who share one of these departments share its order — saving changes it for them too.
        </div>
        {data.mixed && (
          <div class="qo-mixed" style="font-size:12px;color:var(--yellow);margin-top:6px;">
            Your departments have different orders right now — this is the most recently saved one. Save sets them all to it.
          </div>
        )}
      </div>
    );
  }
  return (
    <div class="qo-editing" style="margin-bottom:10px;font-size:14px;">
      Editing the order for <strong>{data.department}</strong>
    </div>
  );
}

export default define.page(async function ManagerConfigurePage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const asEmail = url.searchParams.get("as") ?? "";
  const asked = url.searchParams.get("dept") ?? "";
  const qs = new URLSearchParams();
  if (asked) qs.set("dept", asked);
  if (asEmail) qs.set("as", asEmail);

  let data: OrderResponse | null = null;
  try {
    data = await apiFetch<OrderResponse>(`/manager/api/question-order?${qs}`, ctx.req);
  } catch (e) {
    console.error("Configure question order load error:", e);
  }

  const deptHref = (d: string) => {
    const p = new URLSearchParams({ dept: d });
    if (asEmail) p.set("as", asEmail);
    return `/manager/configure?${p}`;
  };

  return (
    <Layout title="Configure" section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header">
        <h1>Configure question order</h1>
        <p class="page-sub">Your queue lists audits with the most severe failed questions first. Top of this list is the most severe.</p>
      </div>

      <div class="card" style="padding:14px 18px;">
        {!data
          ? <div class="placeholder-card">Couldn't load the question order — refresh to try again.</div>
          : data.departments.length === 0
          ? <div class="placeholder-card">No departments are assigned to you yet.</div>
          : (
            <>
              {data.scope !== "manager" && data.departments.length > 1 && (
                <div class="qo-depts" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                  {data.departments.map((d) => (
                    <a
                      key={d}
                      href={deptHref(d)}
                      class={`btn btn-sm ${d === data!.department ? "btn-primary" : "btn-ghost"}`}
                      aria-current={d === data!.department ? "page" : undefined}
                    >{d}</a>
                  ))}
                </div>
              )}
              {renderEditingScope(data)}
              <QuestionOrderEditor
                key={data.department}
                department={data.department}
                label={data.scope === "manager" ? data.departments.join(", ") : data.department}
                order={data.order}
                defaultOrder={[...DEFAULT_QUESTION_ORDER]}
                updatedBy={data.updatedBy}
                updatedAt={data.updatedAt}
                asEmail={asEmail || undefined}
              />
            </>
          )}
      </div>
    </Layout>
  );
});
