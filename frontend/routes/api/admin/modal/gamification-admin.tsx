/** Modal content: Gamification Admin — three-tab UI for browsing every
 *  user's XP/level/streak/cosmetics, granting XP, and awarding badges.
 *
 *  Shape mirrors Data Maintenance: tab dispatch via ?tab=<key>, top-row
 *  TabBar swaps the shell on click, no islands needed (forms are pure
 *  HTMX). The Users tab is the default and auto-refreshes every 30s. */

import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import { apiFetch } from "../../../../lib/api.ts";
import { resolveCosmetics } from "../../../../lib/cosmetics.ts";
import { EquippedName } from "../../../../components/EquippedName.tsx";
import {
  BADGE_CATALOG, TIER_COLORS,
} from "@gamification/domain/business/badge-system/mod.ts";

type TabKey = "users" | "grant-xp" | "award-badge";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "users", label: "Users" },
  { key: "grant-xp", label: "Grant XP" },
  { key: "award-badge", label: "Award Badge" },
];

interface UserRow {
  email: string;
  role: "user" | "reviewer" | "judge" | "manager";
  totalXp: number;
  level: number;
  dayStreak: number;
  earnedBadgeCount: number;
  equippedTitle: string | null;
  equippedNameColor: string | null;
  equippedFrame: string | null;
  equippedFlair: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = (url.searchParams.get("tab") ?? "users") as TabKey;
    const active = TABS.find((t) => t.key === tab) ? tab : "users";
    const prefillEmail = url.searchParams.get("email") ?? "";

    // Each tab fetches its own data. Loading the users list is needed for
    // both the table and the dropdowns on the form tabs.
    let users: UserRow[] = [];
    try {
      const resp = await apiFetch<{ ok: boolean; users?: UserRow[] }>(
        "/admin/gamification/users-list", ctx.req,
      );
      users = resp.users ?? [];
    } catch (err) {
      console.error("[GAM-ADMIN-MODAL] users-list fetch failed:", err);
    }

    const html = renderToString(
      <div id="gam-admin-shell">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div class="modal-title">Gamification Admin</div>
            <div class="modal-sub">Browse users, grant XP, award badges</div>
          </div>
          <button data-close-modal="gamification-admin-modal" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>

        <TabBar active={active} />

        <div style="margin-top:14px;">
          {active === "users" && <UsersPanel rows={users} />}
          {active === "grant-xp" && <GrantXpPanel users={users} prefillEmail={prefillEmail} />}
          {active === "award-badge" && <AwardBadgePanel users={users} prefillEmail={prefillEmail} />}
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});

// ── Tab strip ────────────────────────────────────────────────────────────────

function TabBar({ active }: { active: TabKey }) {
  return (
    <div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px;">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const color = isActive ? "var(--blue)" : "var(--text-dim)";
        const bg = isActive ? "var(--bg)" : "transparent";
        const border = isActive ? "1px solid var(--blue)" : "1px solid var(--border)";
        return (
          <button
            type="button"
            class="sf-btn ghost"
            style={`padding:6px 12px;font-size:11px;font-weight:600;color:${color};background:${bg};border:${border};border-radius:4px;`}
            hx-get={`/api/admin/modal/gamification-admin?tab=${t.key}`}
            hx-target="#gam-admin-shell"
            hx-swap="outerHTML"
          >{t.label}</button>
        );
      })}
    </div>
  );
}

// ── Users panel ──────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    user: "#f97316", reviewer: "#8b5cf6", judge: "#14b8a6", manager: "#bc8cff",
  };
  const c = colors[role] ?? "var(--text-dim)";
  return (
    <span style={`font-size:10px;font-weight:600;color:${c};text-transform:uppercase;letter-spacing:0.5px;`}>
      {role === "user" ? "agent" : role}
    </span>
  );
}

function CosmeticSwatches({ row }: { row: UserRow }) {
  const cos = resolveCosmetics(row);
  const hasAny = row.equippedFrame || row.equippedNameColor || row.equippedFlair;
  if (!hasAny) {
    return <span style="font-size:10px;color:var(--text-dim);">—</span>;
  }
  return (
    <div style="display:inline-flex;align-items:center;gap:4px;">
      {row.equippedFrame && (
        <span
          title={`Frame: ${row.equippedFrame}`}
          style={`display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--bg-2);${cos.frameStyle}`}
        />
      )}
      {row.equippedNameColor && (
        <span
          title={`Color: ${row.equippedNameColor}`}
          style={`display:inline-block;width:10px;height:10px;border-radius:50%;background:${cos.nameColor};`}
        />
      )}
      {cos.flair && (
        <span title={`Flair: ${row.equippedFlair}`} style="font-size:14px;line-height:1;">{cos.flair}</span>
      )}
    </div>
  );
}

function UsersPanel({ rows }: { rows: UserRow[] }) {
  return (
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:11px;color:var(--text-dim);">
          {rows.length} user{rows.length === 1 ? "" : "s"} sorted by XP. Refreshes every 30s.
        </div>
      </div>
      <div
        id="gam-admin-users-table"
        hx-get="/api/admin/modal/gamification-admin?tab=users"
        hx-trigger="every 30s"
        hx-target="#gam-admin-shell"
        hx-swap="outerHTML"
        hx-select="#gam-admin-users-table"
        style="overflow:auto;max-height:60vh;border:1px solid var(--border);border-radius:6px;"
      >
        <table class="data-table" style="width:100%;font-size:11px;">
          <thead>
            <tr style="background:var(--bg);position:sticky;top:0;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;font-size:10px;">
              <th style="text-align:left;padding:8px 10px;">User</th>
              <th style="text-align:left;padding:8px 10px;width:80px;">Role</th>
              <th style="text-align:right;padding:8px 10px;width:60px;">Level</th>
              <th style="text-align:right;padding:8px 10px;width:80px;">Total XP</th>
              <th style="text-align:right;padding:8px 10px;width:70px;">Streak</th>
              <th style="text-align:right;padding:8px 10px;width:70px;">Badges</th>
              <th style="text-align:left;padding:8px 10px;width:80px;">Equipped</th>
              <th style="text-align:right;padding:8px 10px;width:160px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr class="empty-row"><td colSpan={8} style="padding:24px;text-align:center;color:var(--text-dim);">No users found.</td></tr>
            ) : rows.map((u) => {
              const cos = resolveCosmetics(u);
              const emailHref = encodeURIComponent(u.email);
              return (
                <tr key={u.email} style="border-top:1px solid var(--border);">
                  <td style="padding:6px 10px;">
                    <EquippedName email={u.email} cosmetics={cos} weight={500} />
                  </td>
                  <td style="padding:6px 10px;"><RoleBadge role={u.role} /></td>
                  <td style="padding:6px 10px;text-align:right;font-family:var(--mono);">L{u.level}</td>
                  <td style="padding:6px 10px;text-align:right;font-family:var(--mono);color:var(--blue);">{u.totalXp.toLocaleString()}</td>
                  <td style="padding:6px 10px;text-align:right;font-family:var(--mono);">{u.dayStreak > 0 ? `🔥 ${u.dayStreak}` : "—"}</td>
                  <td style="padding:6px 10px;text-align:right;font-family:var(--mono);">{u.earnedBadgeCount}</td>
                  <td style="padding:6px 10px;"><CosmeticSwatches row={u} /></td>
                  <td style="padding:6px 10px;text-align:right;white-space:nowrap;">
                    <button
                      type="button"
                      class="sf-btn ghost"
                      style="font-size:10px;padding:3px 8px;margin-right:4px;"
                      hx-get={`/api/admin/modal/gamification-admin?tab=grant-xp&email=${emailHref}`}
                      hx-target="#gam-admin-shell"
                      hx-swap="outerHTML"
                    >Grant XP</button>
                    <button
                      type="button"
                      class="sf-btn ghost"
                      style="font-size:10px;padding:3px 8px;"
                      hx-get={`/api/admin/modal/gamification-admin?tab=award-badge&email=${emailHref}`}
                      hx-target="#gam-admin-shell"
                      hx-swap="outerHTML"
                    >Award Badge</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Grant XP panel ───────────────────────────────────────────────────────────

function PanelCard(props: { title: string; subtitle?: string; danger?: boolean; children: preact.ComponentChildren }) {
  const accent = props.danger ? "var(--red)" : "var(--text-bright)";
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px;background:var(--bg);">
      <div style={`font-size:13px;font-weight:700;color:${accent};margin-bottom:4px;`}>{props.title}</div>
      {props.subtitle && <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">{props.subtitle}</div>}
      {props.children}
    </div>
  );
}

function GrantXpPanel({ users, prefillEmail }: { users: UserRow[]; prefillEmail: string }) {
  return (
    <PanelCard
      title="Grant XP"
      subtitle="Additive XP grant. Uses the same awardXp helper the natural earning flow uses, so level thresholds and tokenBalance update correctly. Caps at 5,000 XP per grant."
    >
      <form
        id="grant-xp-form"
        hx-post="/api/admin/modal/gamification-admin/grant-xp"
        hx-target="#grant-xp-result"
        hx-swap="innerHTML"
      >
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px;">
          <div class="sf">
            <label class="sf-label">User</label>
            <select name="email" class="sf-input" required>
              {users.map((u) => (
                <option key={u.email} value={u.email} selected={u.email === prefillEmail}>
                  {u.email} ({u.role === "user" ? "agent" : u.role}, L{u.level}, {u.totalXp.toLocaleString()} xp)
                </option>
              ))}
            </select>
          </div>
          <div class="sf">
            <label class="sf-label">Amount (1-5000)</label>
            <input type="number" name="amount" class="sf-input" min="1" max="5000" value="100" required />
          </div>
        </div>
        <div class="sf" style="margin-bottom:10px;">
          <label class="sf-label">Reason (optional, logged only)</label>
          <input type="text" name="reason" class="sf-input" placeholder="e.g. compensation for missing audit" />
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text);margin-bottom:14px;">
          <input type="checkbox" name="broadcast" value="1" checked />
          <span>Notify recipient — fires the level_up toast if this grant pushes them past a level threshold.</span>
        </label>
        <div style="display:flex;gap:8px;align-items:center;">
          <button
            type="submit"
            class="sf-btn primary"
            style="padding:8px 16px;"
            hx-confirm="Grant the selected user this XP?"
          >Grant XP</button>
          <span style="font-size:11px;color:var(--text-dim);">Irreversible — XP can only be undone via Reset XP.</span>
        </div>
      </form>
      <div id="grant-xp-result" style="margin-top:14px;"></div>
    </PanelCard>
  );
}

// ── Award Badge panel ────────────────────────────────────────────────────────

function AwardBadgePanel({ users, prefillEmail }: { users: UserRow[]; prefillEmail: string }) {
  // Pre-compute badge options per role so client-side filter is a simple
  // hidden-via-data-attr trick. Each <option> carries data-role; the user
  // <select> change handler toggles `hidden` on non-matching options.
  return (
    <PanelCard
      title="Award Badge"
      subtitle="Force-award a specific badge from the built-in catalog. Atomic — duplicate awards no-op. Also grants the badge's xpReward so admin awards match natural earns."
    >
      <form
        id="award-badge-form"
        hx-post="/api/admin/modal/gamification-admin/award-badge"
        hx-target="#award-badge-result"
        hx-swap="innerHTML"
      >
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div class="sf">
            <label class="sf-label">User</label>
            <select
              name="email"
              id="award-user-select"
              class="sf-input"
              required
              {...{
                "hx-on:change": `(() => { const role = this.options[this.selectedIndex]?.dataset.role; const badges = document.getElementById('award-badge-select'); if (!badges || !role) return; Array.from(badges.options).forEach((o) => { o.hidden = o.dataset.role !== role; }); const visible = Array.from(badges.options).find((o) => !o.hidden); if (visible) badges.value = visible.value; })()`,
              }}
            >
              {users.map((u) => {
                const roleForBadge = u.role === "user" ? "agent" : u.role;
                return (
                  <option key={u.email} value={u.email} data-role={roleForBadge} selected={u.email === prefillEmail}>
                    {u.email} ({u.role === "user" ? "agent" : u.role})
                  </option>
                );
              })}
            </select>
          </div>
          <div class="sf">
            <label class="sf-label">Badge</label>
            <select name="badgeId" id="award-badge-select" class="sf-input" required>
              {BADGE_CATALOG.map((b) => {
                // Pre-select based on first matched-role option
                const firstUser = users.find((u) => u.email === prefillEmail) ?? users[0];
                const firstRole = firstUser ? (firstUser.role === "user" ? "agent" : firstUser.role) : "agent";
                const hidden = b.role !== firstRole;
                return (
                  <option key={b.id} value={b.id} data-role={b.role} hidden={hidden}>
                    {b.icon} {b.name} ({b.tier}, +{b.xpReward} XP)
                  </option>
                );
              })}
            </select>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text);margin-bottom:14px;">
          <input type="checkbox" name="broadcast" value="1" checked />
          <span>Fire the badge_earned toast for this award.</span>
        </label>
        <div style="display:flex;gap:8px;align-items:center;">
          <button
            type="submit"
            class="sf-btn primary"
            style="padding:8px 16px;"
            hx-confirm="Award this badge to the selected user?"
          >Award Badge</button>
        </div>
      </form>
      <div id="award-badge-result" style="margin-top:14px;"></div>
      <details style="margin-top:14px;">
        <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">Badge catalog reference ({BADGE_CATALOG.length} total)</summary>
        <table class="data-table" style="width:100%;font-size:10px;margin-top:8px;">
          <thead>
            <tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;">
              <th style="text-align:left;padding:4px 6px;">Badge</th>
              <th style="text-align:left;padding:4px 6px;">Role</th>
              <th style="text-align:left;padding:4px 6px;">Tier</th>
              <th style="text-align:right;padding:4px 6px;">XP</th>
              <th style="text-align:left;padding:4px 6px;">Description</th>
            </tr>
          </thead>
          <tbody>
            {BADGE_CATALOG.map((b) => (
              <tr key={b.id} style="border-top:1px solid var(--border);">
                <td style="padding:4px 6px;">{b.icon} {b.name}</td>
                <td style="padding:4px 6px;">{b.role}</td>
                <td style={`padding:4px 6px;color:${TIER_COLORS[b.tier]};`}>{b.tier}</td>
                <td style="padding:4px 6px;text-align:right;font-family:var(--mono);">+{b.xpReward}</td>
                <td style="padding:4px 6px;color:var(--text-dim);">{b.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </PanelCard>
  );
}
