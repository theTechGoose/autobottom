/** Pipeline configuration — retries, delays, parallelism. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function PipelinePage(ctx) {
  const user = ctx.state.user!;
  let config = { maxRetries: 0, retryDelaySeconds: 0, parallelism: 0 };
  try { config = await apiFetch("/admin/pipeline-config", ctx.req); } catch {}
  let parallelism = { parallelism: 0 };
  try { parallelism = await apiFetch("/admin/parallelism", ctx.req); } catch {}

  return (
    <Layout title="Pipeline" section="admin" user={user}>
      <div class="page-header"><h1>Pipeline Configuration</h1><p class="page-sub">Configure audit pipeline behavior</p></div>
      <div class="card" style="margin-bottom:12px;">
        <div class="tbl-title">Pipeline Settings</div>
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/pipeline-config"}' hx-target="#pipe-result" hx-swap="innerHTML">
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div class="form-group" style="flex:1;min-width:150px;"><label>Max Retries</label><input type="number" name="maxRetries" value={String(config.maxRetries)} /></div>
            <div class="form-group" style="flex:1;min-width:150px;"><label>Retry Delay (seconds)</label><input type="number" name="retryDelaySeconds" value={String(config.retryDelaySeconds)} /></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit">Save</button><span id="pipe-result"></span></div>
        </form>
      </div>
      <div class="card">
        <div class="tbl-title">Parallelism</div>
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/parallelism"}' hx-target="#para-result" hx-swap="innerHTML">
          <div class="form-group" style="max-width:200px;"><label>Parallelism</label><input type="number" name="parallelism" value={String(parallelism.parallelism)} /></div>
          <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit">Save</button><span id="para-result"></span></div>
        </form>
      </div>
    </Layout>
  );
});
