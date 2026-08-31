import type { ActiveProviderId } from "@ext/lib/config";
import type { ProbeSessionResult } from "@ext/lib/messages";
import type { ApplyFilters, ProviderState } from "@ext/lib/types";

export function deriveProviderState(input: {
  board: ActiveProviderId;
  enabled: boolean;
  serverStatus?: string | null;
  probe: ProbeSessionResult;
}): ProviderState {
  const serverStatus = input.serverStatus ?? null;
  const localSession = input.probe.loggedIn;
  let state: ProviderState["state"];

  if (serverStatus !== "connected") state = input.enabled ? "login_required" : "disconnected";
  else if (!input.enabled) state = "paused";
  else state = localSession ? "connected" : "login_required";

  return {
    board: input.board,
    enabled: input.enabled,
    state,
    localSession,
    serverStatus,
    ...(input.probe.reason ? { reason: input.probe.reason } : {}),
  };
}

/** Return a complete filters payload with only one provider's enabled flag changed. */
export function withProviderEnabled(
  filters: ApplyFilters,
  board: ActiveProviderId,
  enabled: boolean,
): Omit<ApplyFilters, "aiFilterEnabled"> {
  const nextBoard = { ...filters.boardFilters[board], enabled };
  const nextBoards = { ...filters.boardFilters, [board]: nextBoard };
  const jobinja = nextBoards.jobinja;

  return {
    categorySlugs: jobinja.categoryKeys,
    cities: jobinja.cities,
    jobTypes: jobinja.employmentTypeKeys,
    remoteOnly: jobinja.remoteOnly,
    ...(jobinja.minSalary ? { minSalary: jobinja.minSalary } : {}),
    ...(jobinja.sort ? { sort: jobinja.sort as ApplyFilters["sort"] } : {}),
    paused: filters.paused,
    ...(filters.dailyLimit ? { dailyLimit: filters.dailyLimit } : {}),
    ...(filters.weeklyLimit ? { weeklyLimit: filters.weeklyLimit } : {}),
    maxAgeDays: filters.maxAgeDays,
    boardFiltersVersion: 1,
    boardFilters: nextBoards,
  };
}
