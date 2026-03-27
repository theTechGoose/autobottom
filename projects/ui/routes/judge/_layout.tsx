import { define } from "@/utils.ts";
import { Sidebar } from "@/components/Sidebar.tsx";

export default define.layout(function JudgeLayout({ Component }) {
  return (
    <div class="layout">
      <Sidebar role="judge" active="/judge/dashboard" />
      <main class="main">
        <Component />
      </main>
    </div>
  );
});
