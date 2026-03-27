import { Component } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class RegisterForm {
  loading = false;
  error = "";

  async handleSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const orgName =
      (form.elements.namedItem("orgName") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value
      .trim();
    const password =
      (form.elements.namedItem("password") as HTMLInputElement).value;

    this.loading = true;
    this.error = "";

    try {
      const res = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.error || "Registration failed";
        this.loading = false;
        return;
      }
      globalThis.location.href = data.redirect || "/admin/dashboard";
    } catch {
      this.error = "Network error";
      this.loading = false;
    }
  }
}
