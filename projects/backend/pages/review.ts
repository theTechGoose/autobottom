/** Inline HTML/CSS/JS for the review UI. */

import { generateQueuePage } from "./queue-page.ts";

export function getReviewPage(gamificationJson?: string): string {
  return generateQueuePage("review", gamificationJson);
}
