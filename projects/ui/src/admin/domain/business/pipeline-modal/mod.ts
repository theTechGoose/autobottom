import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class PipelineModal {
  @Input() open: boolean = false;

  parallelism: number = 3;
  retries: number = 2;
  retryDelay: number = 5000;
  saving: boolean = false;

  loadData() {
    // Coordinator handles fetching pipeline config from API
  }

  save() {
    // Coordinator handles saving pipeline config to API
  }
}
