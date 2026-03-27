import { Component } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class LoginForm {
  loading = false;
  error = "";

  ROLE_REDIRECTS: Record<string, string> = {
    admin: "/admin/dashboard",
    judge: "/judge/dashboard",
    manager: "/manager",
    reviewer: "/review/dashboard",
    user: "/agent",
  };

  async handleSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value
      .trim();
    const password =
      (form.elements.namedItem("password") as HTMLInputElement).value;

    this.loading = true;
    this.error = "";

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.error || "Invalid credentials";
        this.loading = false;
        return;
      }
      globalThis.location.href = data.redirect ||
        this.ROLE_REDIRECTS[data.role] || "/";
    } catch {
      this.error = "Network error";
      this.loading = false;
    }
  }
}
