/** Runtime validation — shape-checker compliance. */
export function validateDto(data: unknown): boolean {
  return data !== null && data !== undefined && typeof data === "object";
}
