import { Component } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class MessageInput {
  text = "";
  sending = false;

  send() {
    if (!this.text.trim()) return;
    this.text = "";
  }
}
