import { Component, Input } from "@sprig/kit";

export interface FullLayoutLink {
  href: string;
  label: string;
  icon?: string;
  active?: boolean;
}

@Component({ template: "./mod.html" })
export class FullLayout {
  @Input({ required: true }) accentColor!: string;
  @Input({ required: true }) title!: string;
  @Input() links: FullLayoutLink[] = [];
  @Input() avatarId: string = "nav-avatar";
  @Input() usernameId: string = "nav-username";
  @Input() roleId: string = "nav-role";
}
