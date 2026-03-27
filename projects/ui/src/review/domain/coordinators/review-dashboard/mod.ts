import { Component } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type DashboardData = any;

@Component({ template: "./mod.html", island: true })
export class ReviewDashboard {
  loading = true;
  error = "";
  currentUser = "";
  data: DashboardData | null = null;
  earnedBadges: string[] = [];

  load() {
    // Fetch from ReviewApi.getMe() and ReviewApi.getDashboard()
  }

  loadBadges() {
    // Fetch earned badges from /api/badges
  }
}
