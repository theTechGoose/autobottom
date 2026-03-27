import { Component, Input } from "@sprig/kit";

interface Message {
  from: string;
  to: string;
  body: string;
  time: string;
}

interface MessageGroup {
  label: string;
  messages: Message[];
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

@Component({ template: "./mod.html" })
export class MessageThread {
  @Input() messages: Message[] = [];
  @Input() myEmail: string = "";

  get groupedMessages(): MessageGroup[] {
    const sorted = [...this.messages].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
    const groups: MessageGroup[] = [];
    let lastLabel = "";
    for (const m of sorted) {
      const label = dateLabel(m.time);
      if (label !== lastLabel) {
        groups.push({ label, messages: [m] });
        lastLabel = label;
      } else {
        groups[groups.length - 1].messages.push(m);
      }
    }
    return groups;
  }
}
