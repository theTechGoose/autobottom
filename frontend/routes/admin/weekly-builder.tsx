import { define } from "../../lib/define.ts";
import type { State } from "../../lib/auth.ts";
import { Layout } from "../../components/Layout.tsx";

export default define.page(function WeeklyBuilder(ctx) {
  return (
    <Layout title="Weekly Builder" section="admin" user={ctx.state.user!}>
      <div class="page-header"><h1>Weekly Report Builder</h1></div>
      <div class="placeholder-card"><p>Weekly builder coming in Phase 2</p></div>
    </Layout>
  );
});
