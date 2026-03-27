import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class ImpersonateBar {
  @Input({ required: true }) targetRole = "";
  @Input() currentAsEmail = "";

  users: Array<{ email: string; role: string }> = [];
}
