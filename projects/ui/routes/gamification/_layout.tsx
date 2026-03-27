import { define } from "@/utils.ts";

export default define.layout(function GamificationLayout({ Component, state }) {
  const user = state.user;
  const dashHref = user?.role === "admin" ? "/admin/dashboard" : "/judge/dashboard";

  return (
    <div class="page-wrap">
      <nav class="topbar">
        <a href={dashHref} class="topbar-back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Back to Dashboard
        </a>
        <h1 class="topbar-title">Gamification</h1>
      </nav>
      <Component />
    </div>
  );
});
