import { Component, Input } from "@sprig/kit";

interface Conversation {
  email: string;
  lastMessage?: string;
  lastTime?: string;
  unread?: number;
}

@Component({ template: "./mod.html" })
export class ConversationList {
  @Input() conversations: Conversation[] = [];
  @Input() activeEmail: string = "";
  @Input() searchQuery: string = "";

  get filteredConversations(): Conversation[] {
    const q = this.searchQuery.toLowerCase();
    if (!q) return this.conversations;
    return this.conversations.filter((c) =>
      c.email.toLowerCase().includes(q)
    );
  }
}
