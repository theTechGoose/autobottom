import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ReviewQueue from "@/islands/ReviewQueue.tsx";

export default define.page(function ReviewPage() {
  return (
    <>
      <Head>
        <title>Auto-Bot Review</title>
      </Head>
      <ReviewQueue />
    </>
  );
});
