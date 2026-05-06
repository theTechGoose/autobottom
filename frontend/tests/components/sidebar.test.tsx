import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { Sidebar } from "../../components/Sidebar.tsx";

const adminUser = { email: "alice@example.com", orgId: "org1", role: "admin" as const };
const reviewerUser = { email: "bob@example.com", orgId: "org1", role: "reviewer" as const };
const judgeUser = { email: "carol@example.com", orgId: "org1", role: "judge" as const };

Deno.test("Sidebar — admin has Configuration section with modal triggers", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "Configuration");
  assertContains(html, "Users");
  assertContains(html, "Webhook");
  assertContains(html, "Question Lab");
  assertContains(html, "Pipeline");
  assertContains(html, "Bad Words");
  assertContains(html, "data-modal");
});

Deno.test("Sidebar — admin has Role Views flyout", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "Role Views");
  assertContains(html, "sb-rv-flyout");
  assertContains(html, "Judge Dashboard");
  assertContains(html, "Review Dashboard");
});

Deno.test("Sidebar — admin has Impersonate with Specific User", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "Impersonate");
  assertContains(html, "Specific User");
});

Deno.test("Sidebar — reviewer sees Review Queue, Store, Chat", () => {
  const html = renderHTML(<Sidebar user={reviewerUser} section="review" />);
  assertContains(html, "Review Queue");
  assertContains(html, "Store");
  assertContains(html, "Chat");
  assertNotContains(html, "Impersonate");
});

Deno.test("Sidebar — judge sees Judge Queue", () => {
  const html = renderHTML(<Sidebar user={judgeUser} section="judge" />);
  assertContains(html, "Judge Queue");
  assertContains(html, "/judge");
});

Deno.test("Sidebar — user initials from email", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "AL");
});

Deno.test("Sidebar — sign out link", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "/api/logout");
});
