/** Queue archive (REQ-057) — the pure rule for which queue items an org-level
 *  cutoff takes off the manager and VO queues, without deleting anything.
 *
 *  Only OPEN work is archived (the same "open" as isOpenQueueItem): closed
 *  items keep their place on the Completed side. "Landed" is the audit's
 *  completion time, falling back to when it was queued. An old audit that a
 *  denied appeal sends back to the queue AFTER the archive was set is new work
 *  and shows again. */

export interface QueueArchive {
  /** Open items that landed strictly before this (epoch ms) are archived. */
  before: number;
  /** When the archive was set, and by whom. */
  at: number;
  by: string;
}

interface ArchivableRow {
  status?: string;
  appealState?: string;
  completedAt?: number;
  addedAt?: number;
  appealDeniedAt?: number;
}

export function isArchivedFromQueue(row: ArchivableRow, archive: QueueArchive | null | undefined): boolean {
  if (!archive) return false;
  const open = row.status !== "remediated" && row.status !== "skipped" && !row.appealState;
  if (!open) return false;
  if ((row.appealDeniedAt ?? 0) > archive.at) return false;
  const landed = row.completedAt ?? row.addedAt ?? 0;
  return landed < archive.before;
}
