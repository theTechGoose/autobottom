/** Island: keyboard shortcuts for review/judge queue pages.
 *  Reads hidden inputs for current item data, triggers HTMX requests programmatically. */
import { useEffect } from "preact/hooks";

interface HotkeyHandlerProps {
  mode: "review" | "judge";
}

export default function HotkeyHandler({ mode }: HotkeyHandlerProps) {
  useEffect(() => {
    function getVal(id: string): string {
      return (document.getElementById(id) as HTMLInputElement)?.value ?? "";
    }

    function triggerDecide(decision: string, reason?: string) {
      const findingId = getVal("hx-findingId");
      const questionIndex = getVal("hx-questionIndex");
      const email = getVal("hx-email");
      if (!findingId) return;

      const apiPath = mode === "review" ? "/api/review/decide" : "/api/judge/decide";
      const body: Record<string, string> = { findingId, questionIndex, decision };
      if (mode === "review") body.reviewer = email;
      else body.judge = email;
      if (reason) body.reason = reason;

      // @ts-ignore — htmx is loaded via CDN
      if (typeof htmx !== "undefined") {
        // @ts-ignore
        htmx.ajax("POST", apiPath, {
          target: "#queue-content",
          swap: "innerHTML",
          values: body,
        });
      }
    }

    function triggerUndo() {
      const findingId = getVal("hx-findingId");
      const questionIndex = getVal("hx-questionIndex");
      const email = getVal("hx-email");
      if (!findingId) return;

      const apiPath = mode === "review" ? "/api/review/back" : "/api/judge/back";
      const body: Record<string, string> = { findingId, questionIndex };
      if (mode === "review") body.reviewer = email;
      else body.judge = email;

      // @ts-ignore
      if (typeof htmx !== "undefined") {
        // @ts-ignore
        htmx.ajax("POST", apiPath, { target: "#queue-content", swap: "innerHTML", values: body });
      }
    }

    function handleKeydown(e: KeyboardEvent) {
      // Ignore if typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key.toLowerCase();

      if (mode === "review") {
        switch (key) {
          case "y": triggerDecide("confirm"); break;
          case "n": triggerDecide("flip"); break;
          case "b": triggerUndo(); break;
          case "d": toggleDetails(); break;
        }
      } else {
        switch (key) {
          case "y": triggerDecide("uphold"); break;
          case "a": triggerDecide("overturn", "error"); break;
          case "s": triggerDecide("overturn", "logic"); break;
          case "d": triggerDecide("overturn", "fragment"); break;
          case "f": triggerDecide("overturn", "transcript"); break;
          case "b": triggerUndo(); break;
          case "g": toggleDetails(); break;
        }
      }
    }

    function toggleDetails() {
      const details = document.querySelector(".verdict-details") as HTMLDetailsElement | null;
      if (details) details.open = !details.open;
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [mode]);

  return <div style="display:none" data-hotkeys={mode}></div>;
}
