import { define } from "@/utils.ts";
import { Sidebar } from "@/components/Sidebar.tsx";

export default define.layout(function ReviewLayout({ Component }) {
  return (
    <div class="layout">
      <Sidebar role="reviewer" active="/review/dashboard" />
      <main class="main">
        <Component />
      </main>
    </div>
  );
});
