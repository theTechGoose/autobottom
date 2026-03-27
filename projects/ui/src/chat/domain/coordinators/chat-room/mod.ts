import { Component } from "@sprig/kit";

interface Conversation {
  email: string;
  lastMessage?: string;
  lastTime?: string;
  unread?: number;
}

interface Message {
  from: string;
  to: string;
  body: string;
  time: string;
}

interface Me {
  email: string;
  role: string;
}

interface User {
  email: string;
  role: string;
}

@Component({ template: "./mod.html", island: true })
export class ChatRoom {
  me: Me | null = null;
  conversations: Conversation[] = [];
  allUsers: User[] = [];
  activeEmail = "";
  messages: Message[] = [];
  msgInput = "";
  sending = false;
  convSearch = "";
  modalOpen = false;
  modalSearch = "";
  loadingConv = false;
  initialized = false;

  private pollInterval: number | null = null;

  async init() {
    try {
      const [meRes, convsRes, usersRes] = await Promise.all([
        fetch("/chat/api/me"),
        fetch("/api/messages/conversations"),
        fetch("/api/users"),
      ]);

      if (!meRes.ok) return;

      this.me = await meRes.json();
      if (convsRes.ok) this.conversations = await convsRes.json();
      if (usersRes.ok) this.allUsers = await usersRes.json();
      this.initialized = true;
    } catch {
      // ignore init errors
    }
  }

  async openConversation(email: string) {
    this.activeEmail = email;
    this.loadingConv = true;

    this.conversations = this.conversations.map((c) =>
      c.email === email ? { ...c, unread: 0 } : c
    );

    try {
      const res = await fetch(
        "/api/messages/" + encodeURIComponent(email),
      );
      if (res.ok) {
        this.messages = await res.json();
      }
    } catch {
      // ignore
    } finally {
      this.loadingConv = false;
    }
  }

  async sendMsg() {
    const body = this.msgInput.trim();
    if (!body || !this.activeEmail || this.sending) return;

    this.sending = true;
    this.msgInput = "";

    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: this.activeEmail, body }),
      });
    } catch {
      // ignore send errors
    }

    this.sending = false;
  }

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(async () => {
      if (!this.activeEmail) return;
      try {
        const res = await fetch(
          "/api/messages/" + encodeURIComponent(this.activeEmail),
        );
        if (res.ok) {
          this.messages = await res.json();
        }
      } catch {
        // ignore
      }
    }, 5000) as unknown as number;
  }

  stopPolling() {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
