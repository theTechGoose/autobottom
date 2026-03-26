import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";

export default define.page(function Home() {
  return (
    <div class="center-card">
      <Head>
        <title>Auto-Bot - Audit Automation</title>
      </Head>
      <div class="card" style={{ textAlign: "center" }}>
        <div class="logo" style={{ fontSize: "32px", marginBottom: "12px" }}>Auto-Bot</div>
        <p class="sub" style={{ marginBottom: "40px" }}>
          AI-powered audit automation platform
        </p>
        <a href="/login" class="btn full" style={{ marginBottom: "12px", textDecoration: "none" }}>
          Sign In
        </a>
        <a href="/register" class="btn full ghost" style={{ textDecoration: "none" }}>
          Create Organization
        </a>
      </div>
    </div>
  );
});
