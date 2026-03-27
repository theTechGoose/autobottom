import { Component, Input } from "@sprig/kit";

export interface PackListItem {
  id: string;
  name: string;
  slots?: Record<string, string>;
}

@Component({ template: "./mod.html" })
export class PackList {
  @Input() packs: PackListItem[] = [];
  @Input() selectedId: string = "";
}
