/** GET: Load scope editor for a manager. POST: Apply scope action and re-render editor.
 *  Department + shift inputs come with a <datalist> populated from
 *  /admin/audit-dimensions so the user gets autocomplete of known values
 *  without losing the freeform-input ability. POST renders a "✓ saved"
 *  status line at the top of the editor so the user gets confirmation. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface ManagerScope { departments?: string[]; shifts?: string[] }
interface AuditDimensions { departments?: string[]; shifts?: string[] }

async function fetchScopeAndDims(req: Request, email: string): Promise<{ scope: { departments: string[]; shifts: string[] }; dims: AuditDimensions }> {
  let scope = { departments: [] as string[], shifts: [] as string[] };
  let dims: AuditDimensions = {};
  try {
    const all = await apiFetch<Record<string, ManagerScope>>("/admin/manager-scopes", req);
    const entry = all?.[email];
    if (entry) scope = { departments: entry.departments ?? [], shifts: entry.shifts ?? [] };
  } catch {}
  try {
    dims = await apiFetch<AuditDimensions>("/admin/audit-dimensions", req);
  } catch {}
  return { scope, dims };
}

async function renderScopeEditor(req: Request, email: string, savedAt?: number): Promise<Response> {
  const { scope, dims } = await fetchScopeAndDims(req, email);
  const deptOptions = (dims.departments ?? []).filter((d) => !scope.departments.includes(d));
  const shiftOptions = (dims.shifts ?? []).filter((s) => !scope.shifts.includes(s));

  const html = renderToString(
    <div style="display:flex;flex-direction:column;gap:16px;height:100%;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-size:13px;font-weight:700;color:var(--text-bright);">{email}</div>
        {savedAt && <span style="font-size:10px;color:var(--green);font-weight:600;">✓ saved</span>}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:-8px;">
        Leave a section empty to allow all values. Inputs auto-suggest known
        values from your audit dimensions; freeform values are still allowed.
      </div>

      <div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px;">Departments</div>
        <div id="um-dept-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;">
          {scope.departments.map((d) => (
            <span key={d} class="tag-chip blue">
              {d}{" "}
              <button
                type="button"
                hx-post={`/api/admin/modal/users/scopes?email=${encodeURIComponent(email)}&action=remove-dept&value=${encodeURIComponent(d)}`}
                hx-target="#um-scope-editor"
                hx-swap="innerHTML"
              >&times;</button>
            </span>
          ))}
        </div>
        <div style="display:flex;gap:6px;">
          <input
            type="text"
            class="sf-input"
            id="um-dept-input"
            name="dept"
            list="um-dept-options"
            placeholder="Type or pick a department..."
            style="flex:1;font-size:12px;padding:7px 10px;"
          />
          <datalist id="um-dept-options">
            {deptOptions.map((d) => <option key={d} value={d} />)}
          </datalist>
          <button
            type="button"
            class="sf-btn secondary"
            hx-post={`/api/admin/modal/users/scopes?email=${encodeURIComponent(email)}&action=add-dept`}
            hx-include="#um-dept-input"
            hx-target="#um-scope-editor"
            hx-swap="innerHTML"
            style="font-size:11px;padding:7px 12px;"
          >Add</button>
        </div>
      </div>

      <div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px;">Shifts</div>
        <div id="um-shift-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;">
          {scope.shifts.map((s) => (
            <span key={s} class="tag-chip green">
              {s}{" "}
              <button
                type="button"
                hx-post={`/api/admin/modal/users/scopes?email=${encodeURIComponent(email)}&action=remove-shift&value=${encodeURIComponent(s)}`}
                hx-target="#um-scope-editor"
                hx-swap="innerHTML"
              >&times;</button>
            </span>
          ))}
        </div>
        <div style="display:flex;gap:6px;">
          <input
            type="text"
            class="sf-input"
            id="um-shift-input"
            name="shift"
            list="um-shift-options"
            placeholder="Type or pick a shift..."
            style="flex:1;font-size:12px;padding:7px 10px;"
          />
          <datalist id="um-shift-options">
            {shiftOptions.map((s) => <option key={s} value={s} />)}
          </datalist>
          <button
            type="button"
            class="sf-btn secondary"
            hx-post={`/api/admin/modal/users/scopes?email=${encodeURIComponent(email)}&action=add-shift`}
            hx-include="#um-shift-input"
            hx-target="#um-scope-editor"
            hx-swap="innerHTML"
            style="font-size:11px;padding:7px 12px;"
          >Add</button>
        </div>
      </div>
    </div>
  );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const email = url.searchParams.get("email") ?? "";
    return renderScopeEditor(ctx.req, email);
  },

  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const email = url.searchParams.get("email") ?? "";
    const action = url.searchParams.get("action") ?? "";
    const value = url.searchParams.get("value") ?? "";
    const form = await ctx.req.formData();

    let scope = { departments: [] as string[], shifts: [] as string[] };
    try {
      const all = await apiFetch<Record<string, ManagerScope>>("/admin/manager-scopes", ctx.req);
      const entry = all?.[email];
      if (entry) scope = { departments: entry.departments ?? [], shifts: entry.shifts ?? [] };
    } catch {}

    if (action === "add-dept") {
      const dept = ((form.get("dept") as string) ?? "").trim();
      if (dept && !scope.departments.includes(dept)) scope.departments.push(dept);
    } else if (action === "remove-dept") {
      scope.departments = scope.departments.filter((d) => d !== value);
    } else if (action === "add-shift") {
      const shift = ((form.get("shift") as string) ?? "").trim();
      if (shift && !scope.shifts.includes(shift)) scope.shifts.push(shift);
    } else if (action === "remove-shift") {
      scope.shifts = scope.shifts.filter((s) => s !== value);
    }

    try { await apiPost("/admin/manager-scopes", ctx.req, { email, scope }); } catch {}

    return renderScopeEditor(ctx.req, email, Date.now());
  },
});
