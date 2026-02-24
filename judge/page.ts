/** Inline HTML/CSS/JS for the judge UI. */

import { generateQueuePage } from "../shared/queue-page.ts";

export function getJudgePage(gamificationJson?: string): string {
  return generateQueuePage("judge", gamificationJson);
}
