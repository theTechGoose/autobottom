import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class SlotUploadRow {
  @Input() slot: string = "";
  @Input() url: string = "";

  uploading = false;

  upload(_file: File) {
    this.uploading = true;
  }
}
