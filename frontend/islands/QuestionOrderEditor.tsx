/** QuestionOrderEditor — the Configure tab's "worst fails" list (REQ-053/055).
 *
 *  One box per question, top = most severe. A box is dragged up or down, or
 *  moved one step with its ↑/↓ arrows (keyboard and trackpad users). While a
 *  box is carried the list re-sorts live — the other boxes slide out of its way
 *  and its slot follows the cursor (REQ-053 AMENDMENT). Each box takes its
 *  color from its POSITION on the dark red → orange → yellow → green gradient,
 *  so moving a question recolors it.
 *
 *  Nothing is kept until Save (REQ-053 AMENDMENT 2): moves and "Reset to
 *  default" only change the list on screen. Leaving by a link with unsaved
 *  changes opens a modal (Save and leave / Leave without saving / Stay);
 *  closing or reloading the tab gets the browser's own warning.
 *
 *  The list belongs to the department, not to this manager — the footer says
 *  who changed it last, because managers sharing a department share it. */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { severityColor } from "@core/business/question-order/mod.ts";
import { shortQuestionLabel } from "@core/business/question-labels/mod.ts";

interface Props {
  /** The one department an admin is editing; empty for a manager, whose Save
   *  goes to every department in their scope (REQ-055 AMENDMENT). */
  department: string;
  /** What the list applies to, for the leave modal. */
  label: string;
  order: string[];
  defaultOrder: string[];
  updatedBy?: string;
  updatedAt?: number;
  /** An admin viewing as a manager edits that manager's departments. */
  asEmail?: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const same = (a: string[], b: string[]) => a.length === b.length && a.every((q, i) => q === b[i]);

const fmtWhen = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    }) + " ET"
    : "";

function move<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

export default function QuestionOrderEditor(props: Props) {
  const [order, setOrder] = useState<string[]>(props.order);
  // The order as last saved — what "unsaved changes" is measured against.
  const [saved, setSaved] = useState<string[]>(props.order);
  const [state, setState] = useState<SaveState>("idle");
  const dirty = !same(order, saved);
  // Where a link click was headed when the leave modal stopped it.
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const leaving = useRef(false);
  const [changed, setChanged] = useState<{ by?: string; at?: number }>({ by: props.updatedBy, at: props.updatedAt });
  // The question being carried, and the order when it was picked up.
  const [dragging, setDragging] = useState<string | null>(null);
  const startOrder = useRef<string[] | null>(null);

  // Slide boxes to their new slots (FLIP): after each re-order, start every
  // box that moved at its old offset and let it transition to the new one.
  const nodes = useRef(new Map<string, HTMLElement>());
  const lastTop = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    nodes.current.forEach((el, q) => {
      const top = el.offsetTop;
      const prev = lastTop.current.get(q);
      lastTop.current.set(q, top);
      if (prev == null || prev === top) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${prev - top}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 160ms ease";
        el.style.transform = "";
      });
    });
  }, [order]);

  /** The carried box is over box `i`: move it into that slot once the cursor
   *  passes the slot's middle. Measured on LAYOUT positions (offsetTop), not
   *  on-screen ones — a box still sliding under the cursor would otherwise
   *  bounce the order straight back. */
  function dragOverItem(e: DragEvent, i: number) {
    e.preventDefault();
    if (!dragging) return;
    const from = order.indexOf(dragging);
    if (from < 0 || from === i) return;
    const el = nodes.current.get(order[i]);
    const list = el?.offsetParent as HTMLElement | null;
    if (!el || !list) return;
    const mid = list.getBoundingClientRect().top + el.offsetTop + el.offsetHeight / 2;
    if (from < i ? e.clientY < mid : e.clientY > mid) return;
    setOrder(move(order, from, i));
  }

  function endDrag() {
    startOrder.current = null;
    setDragging(null);
  }

  /** Any change on screen drops the last "Saved" note — it no longer applies. */
  function change(next: string[]) {
    setOrder(next);
    if (state !== "saving") setState("idle");
  }

  // Ask before leaving with unsaved changes: links get the modal, closing or
  // reloading the tab gets the browser's own prompt.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.closest("#qo-leave-modal")) return;
      e.preventDefault();
      e.stopPropagation();
      setLeavingTo(a.href);
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    globalThis.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      globalThis.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  function leave(href: string) {
    leaving.current = true;
    location.href = href;
  }

  async function save(next: string[]): Promise<boolean> {
    setState("saving");
    try {
      const qs = props.asEmail ? `?as=${encodeURIComponent(props.asEmail)}` : "";
      const res = await fetch(`/manager/api/question-order${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ dept: props.department, order: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json() as { order: string[]; updatedBy?: string; updatedAt?: number };
      setOrder(body.order);
      setSaved(body.order);
      setChanged({ by: body.updatedBy, at: body.updatedAt });
      setState("saved");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }

  const status = state === "saving" || state === "error" ? state : dirty ? "dirty" : state;

  const n = order.length;
  return (
    <div class="qo">
      <style>{`
        .qo-list { position:relative; list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; max-width:640px; }
        .qo-item { display:flex; align-items:center; gap:10px; padding:8px 10px; border:2px solid var(--qo-c);
          border-radius:8px; background:color-mix(in srgb, var(--qo-c) 12%, var(--bg-raised, #fff)); cursor:grab;
          user-select:none; }
        .qo-item:active { cursor:grabbing; }
        .qo-item.qo-dragging { opacity:.35; border-style:dashed; }
        .qo-rank { font-variant-numeric:tabular-nums; font-weight:700; color:color-mix(in srgb, var(--qo-c) 70%, #fff); width:22px; text-align:right; }
        .qo-swatch { width:10px; height:22px; border-radius:3px; background:var(--qo-c); flex:0 0 auto; }
        .qo-name { flex:1; font-size:13px; font-weight:600; color:var(--text, inherit); }
        .qo-arrows { display:flex; flex-direction:column; gap:2px; }
        .qo-arrows button { border:none; background:transparent; cursor:pointer; padding:0 6px; line-height:1; font-size:12px;
          color:var(--text-muted, #666); }
        .qo-arrows button:disabled { opacity:.25; cursor:default; }
        .qo-bar { display:flex; align-items:center; gap:12px; margin:0 0 12px; flex-wrap:wrap; font-size:12px; color:var(--text-muted); }
        .qo-status[data-state="dirty"] { color:var(--yellow, #e0b400); font-weight:600; }
        .qo-status[data-state="saved"] { color:var(--green, #2b8a3e); font-weight:600; }
      `}</style>

      <div class="qo-bar">
        <span>Drag a question, or use its arrows. Top is the most severe.</span>
        <button
          type="button"
          class="btn btn-primary btn-sm qo-save"
          disabled={!dirty || state === "saving"}
          onClick={() => save(order)}
        >Save</button>
        <button
          type="button"
          class="btn btn-ghost btn-sm qo-reset"
          onClick={() => change([...props.defaultOrder])}
        >Reset to default</button>
        <span class="qo-status" data-state={status}>
          {status === "dirty" && "Unsaved changes"}
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
          {status === "error" && <span style="color:var(--red);">Couldn't save — try again</span>}
        </span>
      </div>

      <ol class="qo-list" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
        {order.map((q, i) => (
          <li
            key={q}
            ref={(el) => { if (el) nodes.current.set(q, el); else nodes.current.delete(q); }}
            class={`qo-item${dragging === q ? " qo-dragging" : ""}`}
            style={`--qo-c:${severityColor(i, n)};`}
            data-question={q}
            data-color={severityColor(i, n)}
            draggable
            onDragStart={(e) => {
              startOrder.current = order;
              if (state !== "saving") setState("idle");
              setDragging(q);
              e.dataTransfer?.setData("text/plain", q);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => dragOverItem(e, i)}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={endDrag}
          >
            <span class="qo-arrows">
              <button type="button" class="qo-up" aria-label={`Move ${shortQuestionLabel(q)} up`} disabled={i === 0}
                onClick={() => change(move(order, i, i - 1))}>▲</button>
              <button type="button" class="qo-down" aria-label={`Move ${shortQuestionLabel(q)} down`} disabled={i === n - 1}
                onClick={() => change(move(order, i, i + 1))}>▼</button>
            </span>
            <span class="qo-rank">{i + 1}</span>
            <span class="qo-swatch"></span>
            {/* The name people see everywhere else; the full question on hover. */}
            <span class="qo-name" title={q}>{shortQuestionLabel(q)}</span>
          </li>
        ))}
      </ol>

      <p class="qo-changed" style="margin-top:12px;font-size:11px;color:var(--text-dim);">
        {changed.by
          ? <>Last changed by <strong>{changed.by}</strong> on {fmtWhen(changed.at)}</>
          : "Using the default order — nobody has changed it yet."}
      </p>

      {/* Leaving with unsaved changes (REQ-053 AMENDMENT 2). */}
      <div id="qo-leave-modal" class={`modal-overlay${leavingTo ? " open" : ""}`} role="dialog" aria-modal="true">
        <div class="modal" style="width:min(460px,92vw);">
          <div class="modal-title">Save your changes?</div>
          <div class="modal-sub" style="margin-bottom:14px;">
            You changed the question order for {props.label} but haven't saved it.
          </div>
          {state === "error" && <div style="color:var(--red);font-size:12px;margin-bottom:10px;">Couldn't save — try again.</div>}
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost qo-leave-stay" onClick={() => setLeavingTo(null)}>Stay</button>
            <button type="button" class="btn btn-ghost qo-leave-discard" onClick={() => leavingTo && leave(leavingTo)}>Leave without saving</button>
            <button
              type="button"
              class="btn btn-primary qo-leave-save"
              disabled={state === "saving"}
              onClick={async () => {
                const to = leavingTo;
                if (to && await save(order)) leave(to);
              }}
            >Save and leave</button>
          </div>
        </div>
      </div>
    </div>
  );
}
