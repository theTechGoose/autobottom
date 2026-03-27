import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PipelineModal } from "./mod.ts";

Deno.test("PipelineModal - default open is false", () => {
  const modal = new PipelineModal();
  assertEquals(modal.open, false);
});

Deno.test("PipelineModal - default parallelism is 3", () => {
  const modal = new PipelineModal();
  assertEquals(modal.parallelism, 3);
});

Deno.test("PipelineModal - default retries is 2", () => {
  const modal = new PipelineModal();
  assertEquals(modal.retries, 2);
});

Deno.test("PipelineModal - default retryDelay is 5000", () => {
  const modal = new PipelineModal();
  assertEquals(modal.retryDelay, 5000);
});

Deno.test("PipelineModal - default saving is false", () => {
  const modal = new PipelineModal();
  assertEquals(modal.saving, false);
});

Deno.test("PipelineModal - has loadData method", () => {
  const modal = new PipelineModal();
  assertEquals(typeof modal.loadData, "function");
});

Deno.test("PipelineModal - has save method", () => {
  const modal = new PipelineModal();
  assertEquals(typeof modal.save, "function");
});
