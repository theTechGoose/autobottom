import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { Layout } from "../../components/Layout.tsx";

const USER = { email: "test@co.com", orgId: "org1", role: "admin" as const };

Deno.test("Layout — title formats as X — Auto-Bot", () => {
  const html = renderHTML(<Layout title="Dashboard" user={USER}>content</Layout>);
  assertContains(html, "<title>Dashboard \u2014 Auto-Bot</title>");
});

Deno.test("Layout — section sets accent CSS variable", () => {
  const html = renderHTML(<Layout section="review" user={USER}>content</Layout>);
  assertContains(html, "--accent: #8b5cf6");
});

Deno.test("Layout — shows sidebar when user provided", () => {
  const html = renderHTML(<Layout user={USER}>content</Layout>);
  assertContains(html, "sidebar");
});

Deno.test("Layout — hides sidebar when hideSidebar is true", () => {
  const html = renderHTML(<Layout hideSidebar user={USER}>content</Layout>);
  assertNotContains(html, "sb-brand");
});

Deno.test("Layout — uses main-full class when sidebar hidden", () => {
  const html = renderHTML(<Layout hideSidebar>content</Layout>);
  assertContains(html, "main-full");
});
