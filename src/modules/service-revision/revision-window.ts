import { RevisionStatus } from '@prisma/client';

/** Service warranty: a completed order can be sent back for revision (re-touch / re-work) for this long. */
export const REVISION_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A revision the provider still has to finish. */
export const OPEN_REVISION_STATUSES: readonly RevisionStatus[] = [RevisionStatus.REQUESTED, RevisionStatus.ACCEPTED];

export const hasOpenRevision = (revisions: ReadonlyArray<{ revisionStatus: RevisionStatus | string }> = []) =>
  revisions.some((revision) => (OPEN_REVISION_STATUSES as readonly string[]).includes(revision.revisionStatus));

/**
 * The last moment a revision may be requested: 7 days after the order was first completed. Finishing a
 * revision does not restart the clock. Null when the order was never completed.
 */
export function revisionDeadline(order: { completedAt?: Date | string | null }): Date | null {
  if (!order.completedAt) return null;
  return new Date(new Date(order.completedAt).getTime() + REVISION_WINDOW_DAYS * DAY_MS);
}
