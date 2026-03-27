import { Component } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class Counter {
  count = 0;

  increment() {
    this.count++;
  }

  decrement() {
    this.count--;
  }
}
