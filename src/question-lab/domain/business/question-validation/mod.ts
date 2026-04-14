/** Question validation — ensures questions meet quality standards. */
export function validateQuestionText(text: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!text.trim()) errors.push("Question text is empty");
  if (text.length < 10) errors.push("Question text too short (min 10 chars)");
  if (!text.includes("?") && !text.toLowerCase().includes("was") && !text.toLowerCase().includes("did")) {
    errors.push("Question should be interrogative");
  }
  return { valid: errors.length === 0, errors };
}
