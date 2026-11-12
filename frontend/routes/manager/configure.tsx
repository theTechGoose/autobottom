/** Manager Configure tab (REQ-053/055) — "Configure question order".
 *
 *  The department's worst-fails list: the manager queue and the VO dashboard
 *  for that department rank audits by it. A manager with several departments
 *  picks one at the top; managers sharing a department share its list. An
 *  admin sees every department, or — with `?as=<manager>` — that manager's. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import QuestionOrderEditor from "../../islands/QuestionOrderEditor.tsx";
import { DEFAULT_QUESTION_ORDER } from "@core/business/question-order/mod.ts";

interface OrderResponse {
  departments: string[];
  department: string;
  order: string[];
  isDefault?: boolean;
  updatedBy?: string;
  updatedAt?: number;
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
              {data.departments.length > 1 && (
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
              <div class="qo-editing" style="margin-bottom:10px;font-size:14px;">
                Editing the order for <strong>{data.department}</strong>
              </div>
              <QuestionOrderEditor
                key={data.department}
                department={data.department}
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
