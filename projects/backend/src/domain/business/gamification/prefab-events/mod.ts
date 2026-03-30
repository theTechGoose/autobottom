export interface PrefabEventDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  defaultMessage: (name: string) => string;
}

export const PREFAB_EVENTS: PrefabEventDef[] = [
  { type: "sale_completed", label: "Sale Completed", icon: "\u{1F4B0}",
    description: "Fires when an agent completes an audit",
    defaultMessage: (n) => `${n} completed a sale!` },
  { type: "perfect_score", label: "Perfect Score", icon: "\u{1F4AF}",
    description: "Fires when an agent scores 100% on an audit",
    defaultMessage: (n) => `${n} got a perfect score!` },
  { type: "ten_audits_day", label: "10 Audits in a Day", icon: "\u{1F525}",
    description: "Fires when an agent completes 10 audits in a single day",
    defaultMessage: (n) => `${n} hit 10 audits today!` },
  { type: "level_up", label: "Level Up", icon: "\u{2B06}",
    description: "Fires when any user levels up",
    defaultMessage: (n) => `${n} leveled up!` },
  { type: "badge_earned", label: "Badge Earned", icon: "\u{1F3C5}",
    description: "Fires when any user earns a new badge",
    defaultMessage: (n) => `${n} earned a new badge!` },
  { type: "streak_milestone", label: "Streak Milestone", icon: "\u{1F525}",
    description: "Fires when a user hits a 7, 14, or 30 day streak",
    defaultMessage: (n) => `${n} hit a streak milestone!` },
  { type: "queue_cleared", label: "Queue Cleared", icon: "\u{1F5E1}",
    description: "Fires when the manager queue reaches zero",
    defaultMessage: (n) => `${n} cleared the queue!` },
  { type: "weekly_accuracy_100", label: "Weekly 100% Accuracy", icon: "\u{1F3AF}",
    description: "Fires when an agent has 100% accuracy for the week",
    defaultMessage: (n) => `${n} achieved 100% weekly accuracy!` },
];

export class PrefabEventService {
  /** Serialized prefab events for embedding in client pages. */
  getPrefabEventsJson(): string {
    return JSON.stringify(
      PREFAB_EVENTS.map(({ defaultMessage: _, ...rest }) => rest),
    );
  }
}

// Old API preserved as wrappers
const _svc = new PrefabEventService();
export function getPrefabEventsJson(
  ...args: Parameters<PrefabEventService["getPrefabEventsJson"]>
): string {
  return _svc.getPrefabEventsJson(...args);
}
