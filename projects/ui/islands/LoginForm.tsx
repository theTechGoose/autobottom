import { useSignal } from "@preact/signals";

export default function LoginForm() {
  const loading = useSignal(false);
  const error = useSignal("");

  const ROLE_REDIRECTS: Record<string, string> = {
    admin: "/admin/dashboard",
    judge: "/judge/dashboard",
    manager: "/manager",
    reviewer: "/review/dashboard",
    user: "/agent",
  };

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    loading.value = true;
    error.value = "";

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.value = data.error || "Invalid credentials";
        loading.value = false;
        return;
      }
      window.location.href = data.redirect || ROLE_REDIRECTS[data.role] || "/";
    } catch {
      error.value = "Network error";
      loading.value = false;
    }
  }

  return (
    <div class="card">
      <div class="logo">Auto-Bot</div>
      <p class="sub">Sign in to your account</p>
      <form onSubmit={handleSubmit}>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" placeholder="you@example.com" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" required />
        </div>
        <button class="btn full" type="submit" disabled={loading.value}>
          {loading.value ? "Signing in..." : "Sign In"}
        </button>
        {error.value && <p class="error-msg">{error.value}</p>}
      </form>
      <p class="link">Need an account? <a href="/register">Create organization</a></p>
    </div>
  );
}
