import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type ReviewerRow = any;

@Component({ template: "./mod.html", island: true })
export class ReviewersTable {
  @Input() reviewers: ReviewerRow[] = [];

  addModalOpen = false;
  revEmail = "";
  revPassword = "";
  addLoading = false;
  addError = "";

  openAddModal(): void {
    this.addModalOpen = true;
    this.addError = "";
    this.revEmail = "";
    this.revPassword = "";
  }

  closeAddModal(): void {
    this.addModalOpen = false;
  }

  async addReviewer(): Promise<void> {
    if (!this.revEmail.trim() || !this.revPassword) {
      this.addError = "Email and password required";
      return;
    }
    this.addLoading = true;
    this.addError = "";
    try {
      const res = await fetch("/judge/api/reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: this.revEmail.trim(), password: this.revPassword }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      this.revEmail = "";
      this.revPassword = "";
      this.addModalOpen = false;
    } catch (err: unknown) {
      this.addError = (err as Error).message;
    }
    this.addLoading = false;
  }

  async removeReviewer(email: string): Promise<void> {
    try {
      const res = await fetch("/judge/api/reviewers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch (err: unknown) {
      this.addError = (err as Error).message;
    }
  }
}
