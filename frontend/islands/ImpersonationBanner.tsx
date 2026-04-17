/** Golden "ADMIN VIEW · Viewing as: [dropdown] · Exit Impersonation" banner.
 *  Self-detects from URL (`?as=<email>`) so it works on any page without
 *  threading props through every route. The middleware does the actual
 *  user-swap; this island is pure UI. */
import { useEffect, useState } from "preact/hooks";

interface UserRow { email: string; role: string }

export default function ImpersonationBanner() {
  const [asEmail, setAsEmail] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const target = url.searchParams.get("as");
    if (!target) return;
    setAsEmail(target);

    // Fetch reviewer/judge list for the dropdown. Endpoint exists: /admin/users
    // returns { users: [...] } via the admin UserController.
    fetch("/admin/users", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((d: { users?: UserRow[] }) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  }, []);

  if (!asEmail) return null;

  const onChange = (e: Event) => {
    const email = (e.target as HTMLSelectElement).value;
    if (!email) return;
    const url = new URL(window.location.href);
    url.searchParams.set("as", email);
    window.location.href = url.toString();
  };

  // Filter out admins from the dropdown — can't impersonate yourself usefully.
  const reviewers = users.filter((u) => u.role !== "admin");

  return (
    <div class="admin-impersonation-bar">
      <div class="aib-left">
        <span class="aib-label">Admin View</span>
        <span>Viewing as:</span>
        <select class="aib-select" onChange={onChange} value={asEmail}>
          <option value="">— select reviewer —</option>
          {reviewers.map((u) => <option key={u.email} value={u.email}>{u.email}</option>)}
        </select>
      </div>
      <a class="aib-exit" href="/admin/dashboard">Exit Impersonation</a>
    </div>
  );
}
