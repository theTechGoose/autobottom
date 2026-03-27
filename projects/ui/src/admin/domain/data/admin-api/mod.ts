import { Service } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AnyData = any;

@Service({ scope: "singleton" })
export class AdminApi {
  // Dashboard
  async getDashboardData(): Promise<AnyData> {
    const res = await fetch("/admin/dashboard/data");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Webhooks
  async getWebhook(kind: string): Promise<AnyData> {
    const res = await fetch(`/admin/settings/${kind}`);
    return res.json();
  }

  async saveWebhook(kind: string, data: AnyData): Promise<void> {
    const res = await fetch(`/admin/settings/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // Pipeline
  async getParallelism(): Promise<AnyData> {
    const res = await fetch("/admin/parallelism");
    return res.json();
  }

  async setParallelism(n: number): Promise<void> {
    const res = await fetch("/admin/parallelism", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parallelism: n }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async getPipelineConfig(): Promise<AnyData> {
    const res = await fetch("/admin/pipeline-config");
    return res.json();
  }

  async savePipelineConfig(data: AnyData): Promise<void> {
    const res = await fetch("/admin/pipeline-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // Users
  async getUsers(): Promise<AnyData[]> {
    const res = await fetch("/admin/users");
    const d = await res.json();
    return Array.isArray(d) ? d : [];
  }

  async createUser(data: AnyData): Promise<AnyData> {
    const res = await fetch("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getMe(): Promise<AnyData> {
    const res = await fetch("/admin/api/me");
    return res.json();
  }

  // Dev tools
  async seedData(): Promise<AnyData> {
    const res = await fetch("/admin/seed", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async wipeData(): Promise<AnyData> {
    const res = await fetch("/admin/wipe-kv", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Email reports
  async getEmailReports(): Promise<AnyData[]> {
    const res = await fetch("/admin/email-reports");
    const d = await res.json();
    return Array.isArray(d) ? d : [];
  }

  async saveEmailReport(data: AnyData): Promise<AnyData> {
    const res = await fetch("/admin/email-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async deleteEmailReport(id: string): Promise<void> {
    const res = await fetch("/admin/email-reports/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // Trigger audit
  async triggerAudit(findingId: string): Promise<void> {
    const res = await fetch("/admin/trigger-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // Super-admin: Orgs
  async getOrgs(): Promise<AnyData[]> {
    const res = await fetch("/super-admin/api/orgs");
    if (!res.ok) throw new Error("Load failed");
    return res.json();
  }

  async createOrg(name: string): Promise<AnyData> {
    const res = await fetch("/super-admin/api/org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Create failed");
    return data;
  }

  async seedOrg(orgId: string): Promise<AnyData> {
    const res = await fetch("/super-admin/api/org/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Seed failed");
    return data;
  }

  async wipeOrg(orgId: string): Promise<AnyData> {
    const res = await fetch("/super-admin/api/org/wipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Wipe failed");
    return data;
  }

  async deleteOrg(orgId: string): Promise<AnyData> {
    const res = await fetch("/super-admin/api/org/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    return data;
  }

  async impersonate(orgId: string): Promise<AnyData> {
    const res = await fetch("/super-admin/api/org/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Impersonate failed");
    return data;
  }

  async seedSounds(orgId: string, packIds: string[]): Promise<AnyData> {
    const res = await fetch("/super-admin/api/org/seed-sounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, packIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Seed sounds failed");
    return data;
  }
}
