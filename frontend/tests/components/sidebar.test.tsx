import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { Sidebar } from "../../components/Sidebar.tsx";

const adminUser = { email: "alice@example.com", orgId: "org1", role: "admin" as const };
const reviewerUser = { email: "bob@example.com", orgId: "org1", role: "reviewer" as const };
const judgeUser = { email: "carol@example.com", orgId: "org1", role: "judge" as const };

Deno.test("Sidebar — admin sees Dashboard, Users, Audits links", () => {
  const html = renderHTML(<Sidebar user={adminUser} section="admin" />);
  assertContains(html, "Dashboard");
  assertContains(html, "Users");
  assertContains(html, "Audits");
  assertContains(html, "/admin/dashboard");
  assertContains(html, "/admin/users");
});

Deno.test("Sidebar — reviewer sees Review Queue, Store, Chat", () => {
  const html = renderHTML(<Sidebar user={reviewerUser} section="review" />);
  assertContains(html, "Review Queue");
  assertContains(html, "Store");
  assertContains(html, "Chat");
  assertNotContains(html, "/admin/users");
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
