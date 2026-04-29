/** Golden "ADMIN VIEW · Viewing as: [dropdown] · Exit Impersonation" banner.
 *  Shows whenever the REAL logged-in user is admin AND they're viewing a
 *  non-admin page — regardless of whether ?as=<email> is set. Lets admins
 *  switch between reviewers via the dropdown or exit back to admin.
 *
 *  Middleware handles the actual user-swap when ?as= is present; this
 *  island is pure UI. Fetches /admin/api/me on mount to read the REAL
 *  user from the session cookie (not the middleware-swapped state). */
import { useEffect, useState } from "preact/hooks";

interface UserRow { email: string; role: string }

export const EXCLUDED_PREFIXES = ["/admin", "/audit", "/login", "/register"];

/** Pure helper — true if the impersonation banner should probe for admin
 *  identity on this page. False on admin pages, audit-detail pages (no
 *  reviewer scope), login, register, and the root. Exception: when
 *  `?as=<email>` is explicitly set, always probe so admins can see who
 *  they're impersonating regardless of which page. */
export function shouldProbeForBanner(path: string, asEmail: string): boolean {
  if (asEmail) return true;
  if (path === "/") return false;
  if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return false;
  return true;
}

export default function ImpersonationBanner() {
  const [show, setShow] = useState(false);
  const [asEmail, setAsEmail] = useState<string>("");
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const path = url.pathname;
    const target = url.searchParams.get("as") ?? "";
    setAsEmail(target);

    if (!shouldProbeForBanner(path, target)) return;

    // Fetch the REAL user from the session cookie. /admin/api/me calls
    // authenticate(req) directly — unaffected by the middleware's ?as=
    // state swap — so this always returns the admin's actual identity.
    fetch("/admin/api/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((me: { role?: string } | null) => {
        if (!me || me.role !== "admin") return;
        setShow(true);
        return fetch("/admin/users", { credentials: "include" })
          .then((r) => r.ok ? r.json() : { users: [] })
          .then((d: { users?: UserRow[] }) => setUsers(d.users ?? []))
          .catch(() => setUsers([]));
      })
      .catch(() => { /* silent — banner just doesn't render */ });
  }, []);

  if (!show) return null;

  const onChange = (e: Event) => {
    const email = (e.target as HTMLSelectElement).value;
    const next = new URL(window.location.href);
    if (email) next.searchParams.set("as", email);
    else next.searchParams.delete("as");
    window.location.href = next.toString();
  };

  // Filter out admins — can't impersonate yourself usefully.
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
