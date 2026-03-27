import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import JudgeDashboard from "@/islands/JudgeDashboard.tsx";

export default define.page(function JudgeDashboardPage() {
  return (
    <>
      <Head>
        <title>Judge Dashboard - Auto-Bot</title>
      </Head>
      <JudgeDashboard />
    </>
  );
});
