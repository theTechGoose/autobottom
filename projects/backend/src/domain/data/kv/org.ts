/** Org-scoped KV key helper. Every data key gets an orgId prefix. */

export type OrgId = string;

export function orgKey(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Deno.KvKey {
  return [orgId, ...parts];
}
