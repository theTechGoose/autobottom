/** Judge queue page — split layout with verdict panel + transcript, appeal info. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { VerdictPanel } from "../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";
import { apiFetch } from "../../lib/api.ts";
import type { ReviewItem } from "../../components/VerdictPanel.tsx";
import HotkeyHandler from "../../islands/HotkeyHandler.tsx";
import SoundEngine from "../../islands/SoundEngine.tsx";
import QueueAudioPlayer from "../../islands/QueueAudioPlayer.tsx";

interface BufferResponse { buffer: ReviewItem[]; remaining: number; }

export default define.page(async function JudgeQueue(ctx) {
  const user = ctx.state.user!;
  let data: BufferResponse = { buffer: [], remaining: 0 };
  try {
    data = await apiFetch<BufferResponse>(`/judge/api/next?judge=${encodeURIComponent(user.email)}`, ctx.req);
  } catch (e) { console.error("Failed to load judge queue:", e); }
  const buffer = data.buffer ?? [];
  const currentIndex = 0;
  const item = buffer[currentIndex] ?? null;

  return (
    <Layout title="Judge Queue" section="judge" user={user}>
      <HotkeyHandler mode="judge" />
      <SoundEngine />
      <div class="queue-layout" id="queue-content">
        <div class="queue-left">
          <VerdictPanel
            item={item}
            buffer={buffer}
            currentIndex={currentIndex}
            mode="judge"
            remaining={data.remaining}
            email={user.email}
            combo={0}
          />
        </div>
        <div class="queue-right">
          <TranscriptPanel transcript={item?.transcript} snippet={item?.snippet} />
        </div>
      </div>
      <QueueAudioPlayer initialFindingId={item?.findingId ?? null} />
    </Layout>
  );
});
