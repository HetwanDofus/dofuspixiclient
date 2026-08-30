/**
 * The expiry job's vocabulary, on its own so that both the flow (which
 * arms and disarms jobs) and the service (which runs them) can name it
 * without importing each other.
 */

/** The event a due listing fires. */
export const BIG_STORE_EXPIRE = "bigstore.expire";

export interface BigStoreExpiryPayload {
  listingId: string;
}

/** `SchedulerService` job ids are a flat namespace; this owns one prefix. */
export function expiryJobId(listingId: string): string {
  return `bigstore:${listingId}`;
}
