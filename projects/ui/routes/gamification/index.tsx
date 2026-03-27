import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import GamificationSettings from "@/islands/GamificationSettings.tsx";

export default define.page(function GamificationPage() {
  return (
    <>
      <Head>
        <title>Gamification - Auto-Bot</title>
      </Head>
      <GamificationSettings />
    </>
  );
});
