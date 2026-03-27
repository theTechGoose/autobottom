import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import BadgeEditor from "@/islands/BadgeEditor.tsx";

export default define.page(function BadgesPage() {
  return (
    <>
      <Head>
        <title>Store Catalog - Auto-Bot</title>
      </Head>
      <BadgeEditor />
    </>
  );
});
