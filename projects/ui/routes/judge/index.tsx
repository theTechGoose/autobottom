import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import JudgeQueue from "@/islands/JudgeQueue.tsx";

export default define.page(function JudgePage() {
  return (
    <>
      <Head>
        <title>Auto-Bot Judge</title>
      </Head>
      <JudgeQueue />
    </>
  );
});
