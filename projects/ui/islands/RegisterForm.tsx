import { useSignal } from "@preact/signals";

export default function RegisterForm() {
  const loading = useSignal(false);
  const error = useSignal("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const orgName = (form.elements.namedItem("orgName") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    loading.value = true;
    error.value = "";

    try {
      const res = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.value = data.error || "Registration failed";
        loading.value = false;
        return;
      }
      window.location.href = data.redirect || "/admin/dashboard";
    } catch {
      error.value = "Network error";
      loading.value = false;
    }
  }

  return (
    <div class="card">
      <div class="logo">Auto-Bot</div>
      <p class="sub">Create your organization</p>
      <form onSubmit={handleSubmit}>
        <div class="form-group">
          <label>Organization Name</label>
          <input type="text" name="orgName" placeholder="My Company" required />
        </div>
        <div class="form-group">
          <label>Admin Email</label>
          <input type="email" name="email" placeholder="admin@example.com" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" placeholder="Min 6 characters" minLength={6} required />
        </div>
        <button class="btn full" type="submit" disabled={loading.value}>
          {loading.value ? "Creating..." : "Create Organization"}
        </button>
        {error.value && <p class="error-msg">{error.value}</p>}
      </form>
      <p class="link">Already have an account? <a href="/login">Sign in</a></p>
    </div>
  );
}
