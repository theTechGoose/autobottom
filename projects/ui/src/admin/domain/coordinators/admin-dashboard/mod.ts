import { Component } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AnyData = any;

type ModalName = "none" | "webhook" | "users" | "pipeline" | "devtools" | "email-reports";

interface ToastMsg {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

@Component({ template: "./mod.html", island: true })
export class AdminDashboardCoordinator {
  data: AnyData = null;
  statusDot: "loading" | "ok" | "error" = "loading";
  countdown: number = 30;
  modal: ModalName = "none";
  toasts: ToastMsg[] = [];

  fetchData() {
    // Fetches dashboard data with 30s auto-refresh
  }

  openModal(name: ModalName) {
    this.modal = name;
  }

  closeModal() {
    this.modal = "none";
  }

  renderCharts() {
    // Delegates to AdminChartPanel canvas drawing
  }
}
