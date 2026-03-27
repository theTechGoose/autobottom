import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class AdminChartPanel {
  @Input() completedTs: number[] = [];
  @Input() errorsTs: number[] = [];
  @Input() retriesTs: number[] = [];
  @Input() reviewPending: number = 0;
  @Input() reviewDecided: number = 0;

  drawActivityChart() {
    // Imperative canvas rendering via #activityCanvas template ref
  }

  drawDonut() {
    // Imperative canvas rendering via #donutCanvas template ref
  }
}
