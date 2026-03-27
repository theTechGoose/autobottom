import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EmailReportsModal } from "./mod.ts";

Deno.test("EmailReportsModal - default open is false", () => {
  const modal = new EmailReportsModal();
  assertEquals(modal.open, false);
});

Deno.test("EmailReportsModal - default configs is empty array", () => {
  const modal = new EmailReportsModal();
  assertEquals(modal.configs, []);
});

Deno.test("EmailReportsModal - default view is 'list'", () => {
  const modal = new EmailReportsModal();
  assertEquals(modal.view, "list");
});

Deno.test("EmailReportsModal - default editing is null", () => {
  const modal = new EmailReportsModal();
  assertEquals(modal.editing, null);
});

Deno.test("EmailReportsModal - default form fields", () => {
  const modal = new EmailReportsModal();
  assertEquals(modal.name, "");
  assertEquals(modal.recipients, "");
  assertEquals(modal.cadence, "weekly");
  assertEquals(modal.day, 1);
  assertEquals(typeof modal.sections, "object");
  assertEquals(modal.saving, false);
});

Deno.test("EmailReportsModal - has loadConfigs method", () => {
  const modal = new EmailReportsModal();
  assertEquals(typeof modal.loadConfigs, "function");
});

Deno.test("EmailReportsModal - has openEdit method", () => {
  const modal = new EmailReportsModal();
  assertEquals(typeof modal.openEdit, "function");
});

Deno.test("EmailReportsModal - has saveConfig method", () => {
  const modal = new EmailReportsModal();
  assertEquals(typeof modal.saveConfig, "function");
});

Deno.test("EmailReportsModal - has deleteConfig method", () => {
  const modal = new EmailReportsModal();
  assertEquals(typeof modal.deleteConfig, "function");
});

Deno.test("EmailReportsModal - openEdit sets form fields from config", () => {
  const modal = new EmailReportsModal();
  modal.openEdit({
    name: "Weekly Report",
    recipients: ["a@b.com"],
    cadence: "daily",
    cadenceDay: null,
    sections: {},
  });
  assertEquals(modal.name, "Weekly Report");
  assertEquals(modal.view, "edit");
});
