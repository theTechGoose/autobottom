import { define } from "@/utils.ts";
import { Sidebar } from "@/components/Sidebar.tsx";

export default define.layout(function AdminLayout({ Component }) {
  return (
    <div class="layout">
      <Sidebar role="admin" active="/admin/dashboard" />
      <main class="main">
        <Component />
      </main>
    </div>
  );
});
