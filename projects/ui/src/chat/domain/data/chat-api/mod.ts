import { Service } from "@sprig/kit";

interface Me {
  email: string;
  role: string;
}

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

interface User {
  email: string;
  role: string;
}

@Service({ scope: "singleton" })
export class ChatApi {
  async getMe(): Promise<Me> {
    const res = await fetch("/chat/api/me");
    return res.json();
  }

  async getConversations(): Promise<Conversation[]> {
    const res = await fetch("/api/messages/conversations");
    return res.json();
  }

  async getMessages(email: string): Promise<Message[]> {
    const res = await fetch("/api/messages/" + encodeURIComponent(email));
    return res.json();
  }

  async sendMessage(to: string, body: string): Promise<void> {
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, body }),
    });
  }

  async getUsers(): Promise<User[]> {
    const res = await fetch("/api/users");
    return res.json();
  }
}
