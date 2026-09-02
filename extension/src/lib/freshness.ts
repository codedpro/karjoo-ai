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
