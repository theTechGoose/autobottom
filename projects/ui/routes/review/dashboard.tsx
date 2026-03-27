import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ReviewDashboard from "@/islands/ReviewDashboard.tsx";

export default define.page(function ReviewDashboardPage() {
  return (
    <>
      <Head>
        <title>Review Dashboard - Auto-Bot</title>
      </Head>
      <ReviewDashboard />
    </>
  );
});
