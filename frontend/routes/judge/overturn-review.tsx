/** Overturn Review page (REQ-048) — appeals a judge overturned anything on,
 *  waiting for the team's final call. Laid out like the judge queue: the
 *  appeal's questions on the left, the transcript on the right. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { OverturnReviewPanel } from "../../components/OverturnReviewPanel.tsx";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";
import TranscriptInteractive from "../../islands/TranscriptInteractive.tsx";
import { canReviewOverturns, loadOverturnReview } from "../../lib/overturn-review.tsx";
import { roleRedirect } from "../../lib/auth.ts";

export default define.page(async function OverturnReview(ctx) {
  const user = ctx.state.user!;
  if (!canReviewOverturns(user)) {
    return new Response(null, { status: 302, headers: { location: roleRedirect(user.role) } });
  }
  const findingId = new URL(ctx.req.url).searchParams.get("findingId") ?? undefined;
  const data = await loadOverturnReview(ctx.req, findingId);

  return (
    <Layout title="Overturn Review" section="judge" user={user} hideSidebar>
      <TranscriptInteractive />
      <div class="queue-layout" data-mode="judge">
        <div class="queue-left">
          <a href="/judge/dashboard" class="ovr-back">← Judge Dashboard</a>
          <OverturnReviewPanel {...data} isAdmin={user.role === "admin"} />
        </div>
        <div id="ovr-transcript" class="queue-right">
          <TranscriptPanel transcript={data.item?.transcript ?? null} />
        </div>
      </div>
      <style>{`.ovr-back{display:inline-block;margin:12px 18px 0;font-size:12px;color:var(--text-muted);text-decoration:none}.ovr-back:hover{color:#14b8a6}`}</style>
    </Layout>
  );
});
