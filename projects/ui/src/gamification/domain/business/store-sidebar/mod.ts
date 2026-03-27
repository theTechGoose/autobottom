import { Component, Input } from "@sprig/kit";

export interface CategoryItem {
  key: string;
  label: string;
  count: number;
}

@Component({ template: "./mod.html" })
export class StoreSidebar {
  @Input() categories: CategoryItem[] = [];
  @Input() activeCategory: string = "";
}
