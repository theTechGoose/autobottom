/** XP engine — calculates experience points and levels. */
export function calculateXp(baseXp: number, multiplier = 1): number {
  return Math.floor(baseXp * multiplier);
}
