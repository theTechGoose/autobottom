/** Gamification settings page — admin-only. Two tabs:
 *    1. Streak & Combo Settings
 *    2. Sound Pack Manager (with S3 upload + slot editor)
 *  Also seeds the 5 default sound packs on first visit if KV is empty. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import GamificationPanel from "../../islands/GamificationPanel.tsx";

export default define.page(function GamificationPage(ctx) {
  const user = ctx.state.user!;
  if (user.role !== "admin") {
    return new Response(null, { status: 302, headers: { location: "/admin/dashboard" } });
  }
  return (
    <Layout title="Gamification" section="admin" user={user} pathname="/gamification">
      <div style="max-width:960px;margin:0 auto;padding:20px 24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;color:var(--green);">Gamification</div>
            <h1 style="font-size:22px;color:var(--text-bright);margin-top:4px;">Streak Settings & Sound Packs</h1>
          </div>
          <a href="/admin/dashboard" class="sf-btn ghost" style="text-decoration:none;font-size:11px;">&larr; Admin Dashboard</a>
        </div>
        <GamificationPanel />
      </div>
    </Layout>
  );
});
