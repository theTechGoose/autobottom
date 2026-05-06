/** Question config management — config lifecycle. */
export function isValidConfigName(name: string): boolean {
  return name.trim().length >= 3 && name.length <= 100;
}
