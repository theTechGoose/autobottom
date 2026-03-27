import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import QuestionLabEditor from "@/islands/QuestionLabEditor.tsx";

export default define.page(function QuestionLabPage() {
  return (
    <>
      <Head>
        <title>Question Lab - Auto-Bot</title>
      </Head>
      <QuestionLabEditor />
    </>
  );
});
