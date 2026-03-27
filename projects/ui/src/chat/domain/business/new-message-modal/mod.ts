import { Component, Input } from "@sprig/kit";

interface User {
  email: string;
  role: string;
}

@Component({ template: "./mod.html", island: true })
export class NewMessageModal {
  @Input() open: boolean = false;
  @Input() users: User[] = [];

  searchQuery = "";

  get filteredUsers(): User[] {
    const q = this.searchQuery.toLowerCase();
    if (!q) return this.users;
    return this.users.filter((u) => u.email.toLowerCase().includes(q));
  }
}
