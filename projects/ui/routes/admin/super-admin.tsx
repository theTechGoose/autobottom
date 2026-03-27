import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import SuperAdmin from "@/islands/SuperAdmin.tsx";

export default define.page(function SuperAdminPage() {
  return (
    <>
      <Head>
        <title>Super Admin - Auto-Bot</title>
      </Head>
      <div class="page-wrap">
        <nav class="topbar">
          <a href="/admin/dashboard" class="topbar-back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 3L5 8l5 5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Dashboard
          </a>
          <h1 class="topbar-title">Super Admin</h1>
        </nav>
        <SuperAdmin />
      </div>
    </>
  );
});
