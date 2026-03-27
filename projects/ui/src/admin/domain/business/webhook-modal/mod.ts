import { Component, Input } from "@sprig/kit";

type WebhookKind = "terminate" | "appeal" | "manager" | "judge-finish";

interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}

@Component({ template: "./mod.html", island: true })
export class WebhookModal {
  @Input() open: boolean = false;

  kind: WebhookKind = "terminate";
  postUrl: string = "";
  headers: string = "";
  cache: Partial<Record<WebhookKind, WebhookConfig>> = {};
  saving: boolean = false;

  loadTab(kind: WebhookKind) {
    this.kind = kind;
    const cached = this.cache[kind];
    if (cached) {
      this.postUrl = cached.postUrl || "";
      this.headers = cached.postHeaders
        ? JSON.stringify(cached.postHeaders, null, 2)
        : "";
    } else {
      this.postUrl = "";
      this.headers = "";
    }
  }

  save() {
    // Coordinator handles actual API call
  }
}
