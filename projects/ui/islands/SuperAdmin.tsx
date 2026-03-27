/**
 * SuperAdmin island — god-mode org management.
 * Org list + per-org actions: seed data, seed sounds, wipe, delete, impersonate.
 *
 * API base: /super-admin/api
 *   GET  /super-admin/api/orgs
 *   POST /super-admin/api/org            { name }
 *   POST /super-admin/api/org/seed       { orgId }
 *   POST /super-admin/api/org/seed-sounds { orgId, packIds }
 *   POST /super-admin/api/org/wipe       { orgId }
 *   POST /super-admin/api/org/delete     { orgId }
 *   POST /super-admin/api/org/impersonate { orgId }
 */

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  userCount: number;
  findingCount: number;
}

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error" | "info";
}

const SOUND_PACKS = [
  { id: "smite", label: "SMITE Announcer" },
  { id: "opengameart", label: "OpenGameArt CC0" },
  { id: "mixkit-punchy", label: "Mixkit Punchy" },
  { id: "mixkit-epic", label: "Mixkit Epic" },
];

let toastCounter = 0;

export default function SuperAdmin() {
  const orgs = useSignal<OrgSummary[]>([]);
  const selectedOrg = useSignal<OrgSummary | null>(null);
  const newOrgName = useSignal("");
  const toasts = useSignal<Toast[]>([]);
  const loading = useSignal<Record<string, boolean>>({});
  const selectedPacks = useSignal<Set<string>>(new Set(["smite"]));

  function addToast(msg: string, type: Toast["type"] = "info") {
    const id = ++toastCounter;
    toasts.value = [...toasts.value, { id, msg, type }];
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2400);
  }

  function setLoading(key: string, val: boolean) {
    loading.value = { ...loading.value, [key]: val };
  }

  async function loadOrgs() {
    try {
      const res = await fetch("/super-admin/api/orgs");
      if (!res.ok) throw new Error("Load failed");
      orgs.value = await res.json();

      // If an org was selected, keep it in sync
      if (selectedOrg.value) {
        const updated = orgs.value.find((o) => o.id === selectedOrg.value!.id);
        if (updated) selectedOrg.value = updated;
        else selectedOrg.value = null;
      }
    } catch (e) {
      addToast(`Failed to load orgs: ${(e as Error).message}`, "error");
    }
  }

  async function createOrg() {
    const name = newOrgName.value.trim();
    if (!name) { addToast("Enter an org name", "error"); return; }
    setLoading("create", true);
    try {
      const res = await fetch("/super-admin/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      newOrgName.value = "";
      addToast("Org created", "success");
      await loadOrgs();
    } catch (e) {
      addToast((e as Error).message, "error");
    } finally {
      setLoading("create", false);
    }
  }

  async function postAction(
    path: string,
    body: Record<string, unknown>,
    key: string,
    successMsg: string,
  ) {
    setLoading(key, true);
    try {
      const res = await fetch(`/super-admin/api${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      addToast(successMsg, "success");
      await loadOrgs();
    } catch (e) {
      addToast((e as Error).message, "error");
    } finally {
      setLoading(key, false);
    }
  }

  async function seedSounds() {
    if (!selectedOrg.value) return;
    const packIds = [...selectedPacks.value];
    if (!packIds.length) { addToast("Select at least one pack", "error"); return; }
    setLoading("seed-sounds", true);
    try {
      const res = await fetch("/super-admin/api/org/seed-sounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: selectedOrg.value.id, packIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seed failed");
      addToast("Sound packs uploaded", "success");
    } catch (e) {
      addToast((e as Error).message, "error");
    } finally {
      setLoading("seed-sounds", false);
    }
  }

  async function wipeOrg() {
    if (!selectedOrg.value) return;
    if (!confirm(`Wipe all data for "${selectedOrg.value.name}"? This cannot be undone.`)) return;
    await postAction(
      "/org/wipe",
      { orgId: selectedOrg.value.id },
      "wipe",
      "Org data wiped",
    );
  }

  async function deleteOrg() {
    if (!selectedOrg.value) return;
    if (!confirm(`DELETE org "${selectedOrg.value.name}"? This removes all data AND the org record.`)) return;
    setLoading("delete", true);
    try {
      const res = await fetch("/super-admin/api/org/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: selectedOrg.value.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      addToast("Org deleted", "success");
      selectedOrg.value = null;
      await loadOrgs();
    } catch (e) {
      addToast((e as Error).message, "error");
    } finally {
      setLoading("delete", false);
    }
  }

  async function impersonate() {
    if (!selectedOrg.value) return;
    setLoading("impersonate", true);
    try {
      const res = await fetch("/super-admin/api/org/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: selectedOrg.value.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impersonate failed");
      globalThis.location.href = data.redirect;
    } catch (e) {
      addToast((e as Error).message, "error");
      setLoading("impersonate", false);
    }
  }

  function togglePack(id: string) {
    const s = new Set(selectedPacks.value);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selectedPacks.value = s;
  }

  useEffect(() => {
    loadOrgs();
  }, []);

  const org = selectedOrg.value;

  return (
    <div class="layout">
      {/* Sidebar: org list */}
      <div class="sidebar">
        <div class="create-row">
          <input
            type="text"
            value={newOrgName.value}
            onInput={(e) => { newOrgName.value = (e.target as HTMLInputElement).value; }}
            placeholder="New org name..."
            onKeyDown={(e) => { if (e.key === "Enter") createOrg(); }}
          />
          <button class="btn btn-primary" onClick={createOrg} disabled={loading.value.create}>
            {loading.value.create ? "..." : "Create"}
          </button>
        </div>

        <div>
          {orgs.value.map((o) => (
            <div
              key={o.id}
              class={`org-card${org?.id === o.id ? " active" : ""}`}
              onClick={() => { selectedOrg.value = o; }}
            >
              <div class="org-name">{o.name}</div>
              <div class="org-slug">{o.slug} &middot; {o.id.slice(0, 8)}</div>
              <div class="org-badges">
                <span class="badge users">{o.userCount} users</span>
                <span class="badge findings">{o.findingCount} findings</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel */}
      <div class="panel">
        {!org
          ? <div class="panel-empty">Select an org to manage</div>
          : (
            <div>
              <div class="panel-title">{org.name}</div>
              <div class="panel-sub">{org.id}</div>

              <div class="action-grid">
                {/* Seed test data */}
                <div class="action-card">
                  <h3>Seed Test Data</h3>
                  <p>Populate users, findings, reviews, judge appeals, manager queue, and question lab.</p>
                  <button
                    class="btn btn-primary"
                    disabled={loading.value.seed}
                    onClick={() =>
                      postAction("/org/seed", { orgId: org.id }, "seed", "Test data seeded")}
                  >
                    {loading.value.seed ? "Seeding..." : "Seed Test Data"}
                  </button>
                </div>

                {/* Seed sound packs */}
                <div class="action-card">
                  <h3>Seed Sound Packs</h3>
                  <p>Upload built-in sound packs to S3 for this org.</p>
                  <div class="pack-checks">
                    {SOUND_PACKS.map((p) => (
                      <label key={p.id} class="pack-check">
                        <input
                          type="checkbox"
                          checked={selectedPacks.value.has(p.id)}
                          onChange={() => togglePack(p.id)}
                        />
                        {" "}{p.label}
                      </label>
                    ))}
                  </div>
                  <button
                    class="btn btn-blue"
                    disabled={loading.value["seed-sounds"]}
                    onClick={seedSounds}
                  >
                    {loading.value["seed-sounds"] ? "Uploading..." : "Seed Selected"}
                  </button>
                </div>

                {/* Wipe org data */}
                <div class="action-card">
                  <h3>Wipe Org Data</h3>
                  <p>Delete all KV entries scoped to this org. Org record stays.</p>
                  <button
                    class="btn btn-danger"
                    disabled={loading.value.wipe}
                    onClick={wipeOrg}
                  >
                    {loading.value.wipe ? "Wiping..." : "Wipe Data"}
                  </button>
                </div>

                {/* Delete org */}
                <div class="action-card">
                  <h3>Delete Org</h3>
                  <p>Wipe all data AND remove the org record. Cannot be undone.</p>
                  <button
                    class="btn btn-danger"
                    disabled={loading.value.delete}
                    onClick={deleteOrg}
                  >
                    {loading.value.delete ? "Deleting..." : "Delete Org"}
                  </button>
                </div>

                {/* Impersonate */}
                <div class="action-card" style={{ gridColumn: "1 / -1" }}>
                  <h3>Impersonate</h3>
                  <p>Create an admin session for this org and jump to the dashboard.</p>
                  <button
                    class="btn btn-primary"
                    disabled={loading.value.impersonate}
                    onClick={impersonate}
                  >
                    {loading.value.impersonate ? "Creating session..." : "Impersonate as Admin"}
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>

      {/* Toast stack */}
      <div class="t-wrap">
        {toasts.value.map((t) => (
          <div key={t.id} class={`t-toast ${t.type}`}>
            <span class="t-dot" />
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
