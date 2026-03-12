/** DTOs for SSE events, broadcasts, and messaging. */

export class AppEvent {
  id = "";
  type = "";
  payload: Record<string, unknown> = {};
  createdAt = 0;
}

export class BroadcastEvent {
  id = "";
  type = "";
  triggerEmail = "";
  displayName = "";
  message = "";
  animationId: string | null = null;
  ts = 0;
}

export class PrefabSubscriptions {
  subs: Record<string, boolean> = {};
}

export class MessageDto {
  id = "";
  from = "";
  to = "";
  body = "";
  ts = 0;
  read = false;
}

export class UnreadCount {
  count = 0;
}
