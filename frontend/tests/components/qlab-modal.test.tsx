import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { QlabModalBody } from "../../routes/api/admin/modal/qlab.tsx";

const configs = [
  { id: "c1", name: "Internal Config A", type: "internal" as const },
  { id: "c2", name: "Internal Config B", type: "internal" as const },
  { id: "c3", name: "Partner Config Z", type: "partner" as const },
];

Deno.test("QlabModal — internal tab shows title, builder link, and tab labels", () => {
  const html = renderHTML(<QlabModalBody tab="internal" configs={configs} assignments={{}} />);
  assertContains(html, "Question Lab");
  assertContains(html, "Open Config Builder");
  assertContains(html, "/question-lab");
  assertContains(html, "Internal (Date Legs)");
  assertContains(html, "Partner (Packages)");
});

Deno.test("QlabModal — internal tab dropdown lists internal configs only + remove sentinel", () => {
  const html = renderHTML(<QlabModalBody tab="internal" configs={configs} assignments={{}} />);
  assertContains(html, "Remove / Use Product default");
  assertContains(html, "Internal Config A");
  assertContains(html, "Internal Config B");
  assertNotContains(html, "Partner Config Z");
});

Deno.test("QlabModal — partner tab dropdown lists partner configs only", () => {
  const html = renderHTML(<QlabModalBody tab="partner" configs={configs} assignments={{}} />);
  assertContains(html, "Partner Config Z");
  assertNotContains(html, "Internal Config A");
});

Deno.test("QlabModal — empty assignments shows empty state", () => {
  const html = renderHTML(<QlabModalBody tab="internal" configs={configs} assignments={{}} />);
  assertContains(html, "No destination assignments yet.");
});

Deno.test("QlabModal — current assignments render with Unbind button", () => {
  const assignments = {
    internal: { "dest-123": "Internal Config A" },
    partner: {},
  };
  const html = renderHTML(<QlabModalBody tab="internal" configs={configs} assignments={assignments} />);
  assertContains(html, "dest-123");
  assertContains(html, "Internal Config A");
  assertContains(html, "Unbind");
  assertContains(html, "/api/admin/modal/qlab/clear");
  assertContains(html, "type=internal");
});

Deno.test("QlabModal — assign form posts to /api/admin/modal/qlab/set with hidden type", () => {
  const html = renderHTML(<QlabModalBody tab="partner" configs={configs} assignments={{}} />);
  assertContains(html, '/api/admin/modal/qlab/set');
  assertContains(html, 'name="type" value="partner"');
});
