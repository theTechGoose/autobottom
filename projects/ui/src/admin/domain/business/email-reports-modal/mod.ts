import { Component, Input } from "@sprig/kit";

interface SectionConfig {
  enabled: boolean;
  detail: "low" | "medium" | "high";
}

interface EmailReportConfig {
  id?: string;
  createdAt?: number;
  name: string;
  recipients: string[];
  cadence: "daily" | "weekly" | "biweekly" | "monthly";
  cadenceDay: number | null;
  sections: Record<string, SectionConfig>;
}

const SECTIONS = ["pipeline", "review", "appeals", "manager", "tokens"] as const;

function defaultSections(): Record<string, SectionConfig> {
  const s: Record<string, SectionConfig> = {};
  for (const k of SECTIONS) s[k] = { enabled: true, detail: "medium" };
  return s;
}

@Component({ template: "./mod.html", island: true })
export class EmailReportsModal {
  @Input() open: boolean = false;

  configs: EmailReportConfig[] = [];
  view: "list" | "edit" = "list";
  editing: EmailReportConfig | null = null;

  // Form fields
  name: string = "";
  recipients: string = "";
  cadence: string = "weekly";
  day: number | null = 1;
  sections: Record<string, SectionConfig> = defaultSections();
  saving: boolean = false;

  loadConfigs() {
    // Coordinator handles API call
  }

  openEdit(config?: EmailReportConfig) {
    const c = config || {
      name: "",
      recipients: [],
      cadence: "weekly" as const,
      cadenceDay: 1,
      sections: defaultSections(),
    };
    this.editing = config || null;
    this.name = c.name;
    this.recipients = (c.recipients || []).join("\n");
    this.cadence = c.cadence || "weekly";
    this.day = c.cadenceDay ?? 1;
    this.sections = { ...defaultSections(), ...c.sections };
    this.view = "edit";
  }

  saveConfig() {
    // Coordinator handles API call
  }

  deleteConfig(_id?: string) {
    // Coordinator handles API call
  }
}
