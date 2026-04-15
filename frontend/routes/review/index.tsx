/** Review queue page — split layout with verdict panel + transcript. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { VerdictPanel } from "../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";
import { apiFetch } from "../../lib/api.ts";
import type { ReviewItem } from "../../components/VerdictPanel.tsx";
import HotkeyHandler from "../../islands/HotkeyHandler.tsx";
import SoundEngine from "../../islands/SoundEngine.tsx";

interface BufferResponse { buffer: ReviewItem[]; remaining: number; }

export default define.page(async function ReviewQueue(ctx) {
  const user = ctx.state.user!;
  let data: BufferResponse = { buffer: [], remaining: 0 };
  try {
    data = await apiFetch<BufferResponse>(`/review/api/next?reviewer=${encodeURIComponent(user.email)}&types=`, ctx.req);
  } catch (e) { console.error("Failed to load review queue:", e); }
  const item = data.buffer?.[0] ?? null;

  return (
    <Layout title="Review Queue" section="review" user={user}>
      <HotkeyHandler mode="review" />
      <SoundEngine />
      <div class="queue-layout" id="queue-content">
        <div class="queue-left">
          <VerdictPanel item={item} mode="review" remaining={data.remaining} email={user.email} combo={0} />
        </div>
        <div class="queue-right">
          <TranscriptPanel snippet={item?.snippet ?? ""} />
        </div>
      </div>
    </Layout>
  );
});
