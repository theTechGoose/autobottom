import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { Sidebar } from "../../components/Sidebar.tsx";

const adminUser = { email: "alice@example.com", orgId: "org1", role: "admin" as const };
const reviewerUser = { email: "bob@example.com", orgId: "org1", role: "reviewer" as const };
const judgeUser = { email: "carol@example.com", orgId: "org1", role: "judge" as const };

Deno.test("Sidebar — admin has Configuration section with Users, Webhooks, Question Lab", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "Configuration");
  assertContains(html, "Users");
  assertContains(html, "Webhooks");
  assertContains(html, "Question Lab");
  assertContains(html, "Pipeline");
  assertContains(html, "Bad Words");
  assertContains(html, "/admin/users");
  assertContains(html, "/admin/webhooks");
});

Deno.test("Sidebar — admin has Impersonate section with role view links", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "Impersonate");
  assertContains(html, "Judge Dashboard");
  assertContains(html, "Review Dashboard");
  assertContains(html, "Manager Portal");
  assertContains(html, "Agent Dashboard");
});

Deno.test("Sidebar — reviewer sees Review Queue, Store, Chat", () => {
  const html = renderHTML(<Sidebar user={reviewerUser} section="review" />);
  assertContains(html, "Review Queue");
  assertContains(html, "Store");
  assertContains(html, "Chat");
  assertNotContains(html, "Impersonate");
});

Deno.test("Sidebar — judge sees Judge Queue link", () => {
  const html = renderHTML(<Sidebar user={judgeUser} section="judge" />);
  assertContains(html, "Judge Queue");
  assertContains(html, "/judge");
});

Deno.test("Sidebar — active link gets active class", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "active");
});

Deno.test("Sidebar — user initials from email", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "AL");
});

Deno.test("Sidebar — sign out link to /api/logout", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "/api/logout");
});
