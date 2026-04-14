/** Agent management — CRUD for team agents under a manager. */
export function validateAgentEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
