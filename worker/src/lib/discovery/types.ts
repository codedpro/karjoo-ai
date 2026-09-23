/**
 * Shared discovery types and freshness rules for the node's crawlers.
 *
 * MIRRORS extension/src/lib/{types,freshness}.ts. The extension and the node run
 * the same per-board discovery, and both feed the same control-plane ingest, so a
 * listing must mean the same thing and "fresh" must use the same cutoff in both.
 */

/** One listing as a board presents it — the wire shape the control plane ingests. */
export interface DiscoveredListing {
  externalId: string;
  title: string;
  company?: string | null;
  city?: string | null;
  url: string;
  description?: string | null;
  salary?: string | null;
  postedAt: string;
  gender?: string | null;
  alreadyApplied?: boolean;
}

/** What to search for on one board — produced by the control plane per user. */
export interface DiscoveryOptions {
  categoryKeys: string[];
  cities: string[];
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  maxAgeDays: number;
  /** Unix ms after which pagination stops, even mid-board. */
  deadlineAt?: number;
  /** Hard ceiling on listings collected in one pass. */
  maxListings?: number;
}

export const MAX_PROVIDER_SYNC_AGE_DAYS = 45;
export const MS_PER_DAY = 86_400_000;

export function clampProviderAgeDays(value: number | undefined): number {
  return Math.min(
    MAX_PROVIDER_SYNC_AGE_DAYS,
    Math.max(1, Math.floor(value ?? MAX_PROVIDER_SYNC_AGE_DAYS)),
  );
}

export function providerCutoffMs(maxAgeDays: number | undefined, now = Date.now()): number {
  return now - clampProviderAgeDays(maxAgeDays) * MS_PER_DAY;
}
