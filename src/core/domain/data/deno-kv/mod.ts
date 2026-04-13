/** Deno KV connection factory and org-scoped key helper. */

export type OrgId = string;

export function orgKey(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Deno.KvKey {
  return [orgId, ...parts];
}

let _kv: Deno.Kv | undefined;

export async function getKv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  return _kv;
}

/** Reset the singleton for testing. */
export function resetKv(): void {
  _kv = undefined;
}
