/** Date-leg poll: the fields it asks QuickBase for and how they land on the
 *  record. QuickBase is stubbed at fetch — only calls to its base URL (the
 *  replay emulator under the gate) are intercepted; everything else, like the
 *  Firestore emulator, passes through. */
import { assertEquals } from "#assert";
import { quickbaseBaseUrl } from "@core/config/endpoints.ts";
import { getDateLegByRid } from "./mod.ts";

async function withQuickbase<T>(
  respond: (body: { select: number[] }) => Record<string, { value: unknown }>,
  run: (requests: { select: number[] }[]) => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  const requests: { select: number[] }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(quickbaseBaseUrl())) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push(body);
    return Promise.resolve(new Response(JSON.stringify({ data: [respond(body)] }), { status: 200 }));
  }) as typeof fetch;
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("REQ-030: the date-leg poll asks QuickBase for field 148 (Reservation ID#)", async () => {
  await withQuickbase(() => ({ 3: { value: 524147 }, 148: { value: 419649 } }), async (requests) => {
    await getDateLegByRid("524147");
    assertEquals(requests.length, 1);
    assertEquals(requests[0].select.includes(148), true);
  });
});

Deno.test("REQ-030: the date-leg record carries Reservation ID# as ReservationId", async () => {
  await withQuickbase(() => ({ 3: { value: 524147 }, 148: { value: 419649.0 } }), async () => {
    const record = await getDateLegByRid("524147");
    assertEquals(record?.ReservationId, "419649");
  });
});

Deno.test("REQ-030: a date leg with no reservation gets an empty ReservationId, not 0", async () => {
  // Field 148 is blank-is-zero, so a leg with no related reservation reads 0.
  await withQuickbase(() => ({ 3: { value: 524147 }, 148: { value: 0 } }), async () => {
    const record = await getDateLegByRid("524147");
    assertEquals(record?.ReservationId, "");
  });
});
