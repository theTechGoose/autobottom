/** The genie IDs the appeal form's "Different Recording" tab starts with:
 *  every recording the audit used, so an agent adding a callback appends it
 *  rather than unknowingly dropping a recording (REQ-007). Single-recording
 *  audits carry no `genieIds`, so fall back to `recordingId`, then VoGenie. */
export function appealGenieIds(finding: {
  genieIds?: unknown;
  recordingId?: unknown;
  record?: Record<string, unknown>;
}): string[] {
  const all = Array.isArray(finding.genieIds)
    ? finding.genieIds.map((g) => String(g ?? "").trim()).filter(Boolean)
    : [];
  if (all.length) return all;
  const one = String(finding.recordingId ?? finding.record?.VoGenie ?? "").trim();
  return one ? [one] : [];
}
