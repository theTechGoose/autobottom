/** Broadcast — event broadcasting logic. */
export function shouldBroadcast(type: string, subscriptions: Record<string, boolean>): boolean {
  return !!subscriptions[type];
}
