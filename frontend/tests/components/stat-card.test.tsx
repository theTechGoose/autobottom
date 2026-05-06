import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { StatCard } from "../../components/StatCard.tsx";

Deno.test("StatCard renders label and value", () => {
  const html = renderHTML(<StatCard label="Total" value={42} />);
  assertContains(html, "Total");
  assertContains(html, "42");
});

Deno.test("StatCard renders subtitle when provided", () => {
  const html = renderHTML(<StatCard label="Errors" value={3} sub="2 unique" />);
  assertContains(html, "stat-sub");
  assertContains(html, "2 unique");
});

Deno.test("StatCard omits subtitle when absent", () => {
  const html = renderHTML(<StatCard label="Count" value={0} />);
  assertNotContains(html, "stat-sub");
});

Deno.test("StatCard applies color class", () => {
  const html = renderHTML(<StatCard label="Errors" value={5} color="red" />);
  assertContains(html, "red");
});
