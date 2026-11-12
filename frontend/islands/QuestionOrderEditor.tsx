/** QuestionOrderEditor — the Configure tab's "worst fails" list (REQ-053/055).
 *
 *  One box per question, top = worst. A box is dragged up or down, or moved one
 *  step with its ↑/↓ arrows (keyboard and trackpad users). Each box takes its
 *  color from its POSITION on the dark red → orange → yellow → green gradient,
 *  so moving a question recolors it. Every move saves the department's list
 *  straight away; "Reset to default" puts back the default order.
 *
 *  The list belongs to the department, not to this manager — the footer says
 *  who changed it last, because managers sharing a department share it. */
import { useRef, useState } from "preact/hooks";
import { severityColor } from "@core/business/question-order/mod.ts";

interface Props {
  department: string;
  order: string[];
  defaultOrder: string[];
  updatedBy?: string;
  updatedAt?: number;
  /** An admin viewing as a manager edits that manager's departments. */
  asEmail?: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

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
  const [state, setState] = useState<SaveState>("idle");
  const [changed, setChanged] = useState<{ by?: string; at?: number }>({ by: props.updatedBy, at: props.updatedAt });
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  async function save(next: string[]) {
    setOrder(next);
    setState("saving");
    try {
      const qs = props.asEmail ? `?as=${encodeURIComponent(props.asEmail)}` : "";
      const res = await fetch(`/manager/api/question-order${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ dept: props.department, order: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = await res.json() as { order: string[]; updatedBy?: string; updatedAt?: number };
      setOrder(saved.order);
      setChanged({ by: saved.updatedBy, at: saved.updatedAt });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  const n = order.length;
  return (
    <div class="qo">
      <style>{`
        .qo-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; max-width:640px; }
        .qo-item { display:flex; align-items:center; gap:10px; padding:8px 10px; border:2px solid var(--qo-c);
          border-radius:8px; background:color-mix(in srgb, var(--qo-c) 12%, var(--bg-raised, #fff)); cursor:grab;
          user-select:none; transition:transform .08s ease; }
        .qo-item:active { cursor:grabbing; }
        .qo-item.qo-over { transform:translateY(2px); box-shadow:0 -3px 0 0 var(--accent, #6366f1); }
        .qo-rank { font-variant-numeric:tabular-nums; font-weight:700; color:color-mix(in srgb, var(--qo-c) 70%, #fff); width:22px; text-align:right; }
        .qo-swatch { width:10px; height:22px; border-radius:3px; background:var(--qo-c); flex:0 0 auto; }
        .qo-name { flex:1; font-size:13px; font-weight:600; color:var(--text, inherit); }
        .qo-arrows { display:flex; flex-direction:column; gap:2px; }
        .qo-arrows button { border:none; background:transparent; cursor:pointer; padding:0 6px; line-height:1; font-size:12px;
          color:var(--text-muted, #666); }
        .qo-arrows button:disabled { opacity:.25; cursor:default; }
        .qo-bar { display:flex; align-items:center; gap:12px; margin:0 0 12px; flex-wrap:wrap; font-size:12px; color:var(--text-muted); }
      `}</style>

      <div class="qo-bar">
        <span>Drag a question, or use its arrows. Top is the worst.</span>
        <button
          type="button"
          class="btn btn-ghost btn-sm qo-reset"
          onClick={() => save([...props.defaultOrder])}
        >Reset to default</button>
        <span class="qo-status" data-state={state}>
          {state === "saving" && "Saving…"}
          {state === "saved" && "Saved"}
          {state === "error" && <span style="color:var(--red);">Couldn't save — try again</span>}
        </span>
      </div>

      <ol class="qo-list">
        {order.map((q, i) => (
          <li
            key={q}
            class={`qo-item${dragOver === i ? " qo-over" : ""}`}
            style={`--qo-c:${severityColor(i, n)};`}
            data-question={q}
            data-color={severityColor(i, n)}
            draggable
            onDragStart={(e) => {
              dragFrom.current = i;
              e.dataTransfer?.setData("text/plain", q);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
            onDragLeave={() => setDragOver((cur) => (cur === i ? null : cur))}
            onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = null;
              setDragOver(null);
              if (from == null || from === i) return;
              save(move(order, from, i));
            }}
          >
            <span class="qo-arrows">
              <button type="button" class="qo-up" aria-label={`Move ${q} up`} disabled={i === 0}
                onClick={() => save(move(order, i, i - 1))}>▲</button>
              <button type="button" class="qo-down" aria-label={`Move ${q} down`} disabled={i === n - 1}
                onClick={() => save(move(order, i, i + 1))}>▼</button>
            </span>
            <span class="qo-rank">{i + 1}</span>
            <span class="qo-swatch"></span>
            <span class="qo-name">{q}</span>
          </li>
        ))}
      </ol>

      <p class="qo-changed" style="margin-top:12px;font-size:11px;color:var(--text-dim);">
        {changed.by
          ? <>Last changed by <strong>{changed.by}</strong> on {fmtWhen(changed.at)}</>
          : "Using the default order — nobody has changed it yet."}
      </p>
    </div>
  );
}
