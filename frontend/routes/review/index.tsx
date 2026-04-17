/** Review queue page — split layout with verdict panel + transcript. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { VerdictPanel } from "../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";
import { apiFetch } from "../../lib/api.ts";
import type { ReviewItem } from "../../components/VerdictPanel.tsx";
import HotkeyHandler from "../../islands/HotkeyHandler.tsx";
import SoundEngine from "../../islands/SoundEngine.tsx";
import QueueAudioPlayer from "../../islands/QueueAudioPlayer.tsx";
import TranscriptInteractive from "../../islands/TranscriptInteractive.tsx";
import QueueModals from "../../islands/QueueModals.tsx";
import GamificationBar from "../../islands/GamificationBar.tsx";

interface BufferResponse { buffer: ReviewItem[]; remaining: number; }

export default define.page(async function ReviewQueue(ctx) {
  const user = ctx.state.user!;
  let data: BufferResponse = { buffer: [], remaining: 0 };
  try {
    data = await apiFetch<BufferResponse>(`/review/api/next?reviewer=${encodeURIComponent(user.email)}&types=`, ctx.req);
  } catch (e) { console.error("Failed to load review queue:", e); }
  const buffer = data.buffer ?? [];
  const currentIndex = 0;
  const item = buffer[currentIndex] ?? null;

  return (
    <Layout title="Review Queue" section="review" user={user}>
      <HotkeyHandler mode="review" />
      <SoundEngine />
      <div class="queue-layout" id="queue-content">
        <div class="queue-left">
          <VerdictPanel
            item={item}
            buffer={buffer}
            currentIndex={currentIndex}
            mode="review"
            remaining={data.remaining}
            email={user.email}
            combo={0}
          />
        </div>
        <div class="queue-right">
          <TranscriptPanel transcript={item?.transcript} snippet={item?.snippet} />
          <TranscriptInteractive
            defense={item?.defense ?? null}
            thinking={item?.thinking ?? null}
          />
        </div>
      </div>
      <GamificationBar mode="review" email={user.email} />
      <QueueAudioPlayer initialFindingId={item?.findingId ?? null} />
      <QueueModals />
    </Layout>
  );
});
