import { Component, Input } from "@sprig/kit";

interface User {
  username: string;
  role: string;
  supervisor?: string;
}

@Component({ template: "./mod.html", island: true })
export class UsersModal {
  @Input() open: boolean = false;

  allUsers: User[] = [];
  tab: "list" | "add" = "list";
  selectedRole: string = "reviewer";
  newEmail: string = "";
  newPassword: string = "";
  newSupervisor: string = "";
  saving: boolean = false;
  currentAdminEmail: string = "";

  get supervisorOptions(): User[] {
    const role = this.selectedRole;
    if (role === "admin") return [];
    const filterFn = (role === "judge" || role === "manager")
      ? (u: User) => u.role === "admin"
      : (u: User) => u.role === "judge" || u.role === "manager";
    return this.allUsers.filter(filterFn);
  }

  fetchUsers() {
    // Coordinator handles API call
  }

  createUser() {
    // Coordinator handles API call
  }
}
