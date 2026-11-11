/** Overturn Review page (REQ-048) — appeals a judge overturned anything on,
 *  waiting for the team's final call. Laid out like the reviewer queue: the
 *  verdict panel on the left, the transcript on the right. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import TranscriptInteractive from "../../islands/TranscriptInteractive.tsx";
import OverturnReverseModal from "../../islands/OverturnReverseModal.tsx";
import { canReviewOverturns, loadOverturnReview, OverturnReviewColumns, OverturnReviewToastSlot } from "../../lib/overturn-review.tsx";
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
      <OverturnReverseModal />
      <div class="queue-layout" id="ovr-content" data-mode="judge">
        <OverturnReviewColumns data={data} />
      </div>
      <OverturnReviewToastSlot />
    </Layout>
  );
});
