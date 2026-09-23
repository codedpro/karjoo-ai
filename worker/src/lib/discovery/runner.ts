/**
 * The node's discovery loop — finding jobs around the clock, for every board.
 *
 * Two passes, on two cadences:
 *
 *   • USER pass (every few minutes): ask the control plane which assigned users
 *     are due. The SERVER decides — it knows each user's queue depth, whether
 *     their browser is live, their plan, their filters. For each, search every
 *     board they target with exactly their filters and hand the results back to
 *     be queued. This is what makes the apply queue refill with the browser shut.
 *
 *   • CATALOG pass (hourly): crawl every board's newest listings with no user at
 *     all, so the public jobs page reflects every site — not only whatever some
 *     user's filters happened to find.
 *
 * Both run concurrently with the apply loop and never block it.
 *
 * Everything goes out through politeFetch: identified as KarjooBot, robots.txt
 * checked per URL, requests spaced per host. When a board pushes back (429 or a
 * security check), the node stops asking THAT board for a while — for every
 * user — instead of retrying into it. No session is used: discovery is anonymous.
 */
import type { Logger } from "../logger.js";
import type { FleetDiscoveryBoardSpec, FleetDiscoveryUser } from "../types.js";
import { discoverEEstekhdamListings } from "./eestekhdam.js";
import { RobotsDisallowedError } from "./http.js";
import { discoverIranTalentListings } from "./irantalent.js";
import { discoverJobinjaListings } from "./jobinja.js";
import { JobvisionFeed, matchesJobvisionSpec } from "./jobvision.js";
import { discoverKarboomListings } from "./karboom.js";
import { MAX_PROVIDER_SYNC_AGE_DAYS, type DiscoveredListing } from "./types.js";

/** The slice of the fleet API discovery needs. */
export interface DiscoveryApi {
  claimDiscovery(): Promise<FleetDiscoveryUser[]>;
  submitDiscovery(input: {
    scope: "user" | "catalog";
    userId?: string;
    board: string;
    listings: DiscoveredListing[];
  }): Promise<{ ingested: number; queued: number }>;
}

export interface DiscoveryRunnerOptions {
  /**
   * Wall-clock slice for ONE board of one user. Per board, not per user: with a
   * single shared budget, e-estekhdam's detail-per-listing crawl (deliberately
   * spaced) plus the JobVision refresh used it all up, and the boards after them —
   * IranTalent and Karboom — were never searched. Karboom had never produced a
   * listing; being last in line was why.
   */
  boardBudgetMs: number;
  /** How long the user pass may spend refreshing the JobVision sitemap feed. */
  jobvisionRefreshBudgetMs: number;
  /** Listings one board may yield for one user per pass. */
  maxListingsPerBoard: number;
  /** Wall-clock budget for one catalog board. */
  catalogBudgetMs: number;
  /** Listings one board may yield to the catalog per pass. */
  catalogMaxPerBoard: number;
  /** JobVision posting pages fetched per refresh. */
  jobvisionPagesPerRun: number;
  /** How long a board is left alone after it pushes back. */
  boardCooldownMs: number;
  now?: () => number;
}

export const DEFAULT_DISCOVERY_OPTIONS: DiscoveryRunnerOptions = {
  boardBudgetMs: 90_000,
  jobvisionRefreshBudgetMs: 2 * 60_000,
  maxListingsPerBoard: 300,
  catalogBudgetMs: 5 * 60_000,
  catalogMaxPerBoard: 400,
  jobvisionPagesPerRun: 300,
  boardCooldownMs: 30 * 60_000,
};

/** The newest-first public search for each board — what the catalog walks. */
export const CATALOG_JOBINJA_URL = "https://jobinja.ir/jobs?sort_by=published_at_desc";

export interface PassSummary {
  users: number;
  boards: number;
  found: number;
  queued: number;
  skipped: Record<string, number>;
}

function emptySummary(): PassSummary {
  return { users: 0, boards: 0, found: 0, queued: 0, skipped: {} };
}

function bump(summary: PassSummary, reason: string): void {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
}

/** PURE: does this failure mean the board is pushing back on us? */
export function isBoardPushback(message: string): boolean {
  return /rate[_ -]?limit|security[_ -]?(check|challenge)|captcha|\b429\b/i.test(message);
}

export class DiscoveryRunner {
  private readonly jobvision: JobvisionFeed;
  /** JobVision ids already handed to each user, so the window is not resent. */
  private readonly sentJobvision = new Map<string, Set<string>>();
  /** board → time until which the node leaves it alone. */
  private readonly cooldownUntil = new Map<string, number>();
  private readonly options: DiscoveryRunnerOptions;
  private readonly now: () => number;

  constructor(
    private readonly api: DiscoveryApi,
    private readonly fetchImpl: typeof fetch,
    private readonly log: Logger,
    options: Partial<DiscoveryRunnerOptions> = {},
  ) {
    this.options = { ...DEFAULT_DISCOVERY_OPTIONS, ...options };
    this.now = this.options.now ?? Date.now;
    this.jobvision = new JobvisionFeed(fetchImpl);
  }

  /** Is this board resting after pushing back? */
  cooling(board: string): boolean {
    return (this.cooldownUntil.get(board) ?? 0) > this.now();
  }

  /** Run one board; translate failures into a skip reason and a cooldown. */
  private async guarded<T>(board: string, summary: PassSummary, run: () => Promise<T>): Promise<T | null> {
    if (this.cooling(board)) {
      bump(summary, `${board}:cooling_down`);
      return null;
    }
    try {
      return await run();
    } catch (err) {
      if (err instanceof RobotsDisallowedError) {
        // Not an error — the site said no. We simply do not go there.
        bump(summary, `${board}:robots_disallowed`);
        return null;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (isBoardPushback(message)) {
        this.cooldownUntil.set(board, this.now() + this.options.boardCooldownMs);
        this.log.warn("board pushed back; pausing discovery on it", { board, reason: message });
        bump(summary, `${board}:pushback`);
      } else {
        this.log.warn("discovery failed on board", { board, reason: message });
        bump(summary, `${board}:failed`);
      }
      return null;
    }
  }

  /**
   * Refresh JobVision once and send every newly read posting to the public
   * catalog — whichever pass triggered the refresh.
   */
  private async refreshJobvision(
    maxAgeDays: number,
    summary: PassSummary,
    budgetMs: number,
  ): Promise<void> {
    const fresh = await this.guarded("jobvision", summary, () =>
      this.jobvision.refresh({
        maxAgeDays,
        maxPagesPerRun: this.options.jobvisionPagesPerRun,
        deadlineAt: this.now() + budgetMs,
        now: this.now,
      }),
    );
    if (fresh && fresh.length > 0) {
      await this.api.submitDiscovery({ scope: "catalog", board: "jobvision", listings: fresh.map(stripJv) });
    }
  }

  /** One board for one user → listings, or null when skipped. */
  private async searchBoard(
    user: FleetDiscoveryUser,
    spec: FleetDiscoveryBoardSpec,
    deadlineAt: number,
    summary: PassSummary,
  ): Promise<DiscoveredListing[] | null> {
    const common = {
      categoryKeys: spec.categoryKeys ?? [],
      employmentTypeKeys: spec.employmentTypeKeys ?? [],
      remoteOnly: spec.remoteOnly ?? false,
      maxAgeDays: user.maxAgeDays,
      maxListings: this.options.maxListingsPerBoard,
      deadlineAt,
    };
    switch (spec.board) {
      case "jobinja":
        if (!spec.searchUrl) return null;
        return this.guarded("jobinja", summary, () =>
          discoverJobinjaListings(spec.searchUrl!, common, this.fetchImpl),
        );
      case "e-estekhdam":
        return this.guarded("e-estekhdam", summary, () =>
          discoverEEstekhdamListings({ ...common, cities: spec.cities ?? [] }, this.fetchImpl),
        );
      case "irantalent":
        return this.guarded("irantalent", summary, () =>
          discoverIranTalentListings(common, this.fetchImpl),
        );
      case "karboom":
        return this.guarded("karboom", summary, () =>
          discoverKarboomListings({ ...common, cities: spec.cities ?? [] }, this.fetchImpl),
        );
      case "jobvision": {
        // Matched against the retained window by exact category label.
        if (this.cooling("jobvision")) {
          bump(summary, "jobvision:cooling_down");
          return null;
        }
        const sent = this.sentJobvision.get(user.userId) ?? new Set<string>();
        const matches = this.jobvision
          .window(user.maxAgeDays, this.now())
          .filter((posting) =>
            matchesJobvisionSpec(posting, {
              categoryLabels: spec.categoryLabels ?? [],
              employmentTypeKeys: spec.employmentTypeKeys ?? [],
              remoteOnly: spec.remoteOnly ?? false,
            }),
          )
          .filter((posting) => !sent.has(posting.externalId))
          .slice(0, this.options.maxListingsPerBoard);
        for (const posting of matches) sent.add(posting.externalId);
        this.sentJobvision.set(user.userId, sent);
        return matches.map(stripJv);
      }
      default:
        return null;
    }
  }

  /** The user pass. The control plane has already decided who is due. */
  async runUsers(): Promise<PassSummary> {
    const summary = emptySummary();
    const users = await this.api.claimDiscovery();
    summary.users = users.length;
    if (users.length === 0) return summary;

    if (users.some((u) => u.boards.some((b) => b.board === "jobvision"))) {
      await this.refreshJobvision(
        Math.max(...users.map((u) => u.maxAgeDays)),
        summary,
        this.options.jobvisionRefreshBudgetMs,
      );
    }

    for (const user of users) {
      // JobVision is matched against the already-fetched window — no network — so
      // it goes first; the rest each get their own slice.
      const ordered = [...user.boards].sort(
        (a, b) => Number(b.board === "jobvision") - Number(a.board === "jobvision"),
      );
      for (const spec of ordered) {
        const deadlineAt = this.now() + this.options.boardBudgetMs;
        const listings = await this.searchBoard(user, spec, deadlineAt, summary);
        summary.boards += 1;
        if (!listings || listings.length === 0) continue;
        summary.found += listings.length;
        try {
          const result = await this.api.submitDiscovery({
            scope: "user",
            userId: user.userId,
            board: spec.board,
            listings,
          });
          summary.queued += result.queued;
        } catch (err) {
          this.log.warn("could not submit discovered listings", {
            board: spec.board,
            reason: err instanceof Error ? err.message : String(err),
          });
          bump(summary, `${spec.board}:submit_failed`);
        }
      }
    }
    return summary;
  }

  /** The catalog pass: every board's newest listings, no user involved. */
  async runCatalog(): Promise<PassSummary> {
    const summary = emptySummary();
    const maxAgeDays = MAX_PROVIDER_SYNC_AGE_DAYS;
    const empty = {
      categoryKeys: [] as string[],
      cities: [] as string[],
      employmentTypeKeys: [] as string[],
      remoteOnly: false,
      maxAgeDays,
      maxListings: this.options.catalogMaxPerBoard,
    };
    const boards: Array<[string, (deadlineAt: number) => Promise<DiscoveredListing[]>]> = [
      ["jobinja", (d) => discoverJobinjaListings(CATALOG_JOBINJA_URL, { ...empty, deadlineAt: d }, this.fetchImpl)],
      ["e-estekhdam", (d) => discoverEEstekhdamListings({ ...empty, deadlineAt: d }, this.fetchImpl)],
      ["irantalent", (d) => discoverIranTalentListings({ ...empty, deadlineAt: d }, this.fetchImpl)],
      ["karboom", (d) => discoverKarboomListings({ ...empty, deadlineAt: d }, this.fetchImpl)],
    ];

    for (const [board, run] of boards) {
      const listings = await this.guarded(board, summary, () =>
        run(this.now() + this.options.catalogBudgetMs),
      );
      summary.boards += 1;
      if (!listings || listings.length === 0) continue;
      summary.found += listings.length;
      try {
        await this.api.submitDiscovery({ scope: "catalog", board, listings });
      } catch (err) {
        this.log.warn("could not submit catalog listings", {
          board,
          reason: err instanceof Error ? err.message : String(err),
        });
        bump(summary, `${board}:submit_failed`);
      }
    }
    // JobVision's catalog is fed by the sitemap feed itself.
    await this.refreshJobvision(maxAgeDays, summary, this.options.catalogBudgetMs);
    summary.boards += 1;
    return summary;
  }
}

/** The wire shape carries only listing fields — not the matching metadata. */
function stripJv<T extends DiscoveredListing>(posting: T): DiscoveredListing {
  return {
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company ?? null,
    city: posting.city ?? null,
    url: posting.url,
    description: posting.description ?? null,
    postedAt: posting.postedAt,
  };
}

export interface DiscoveryLoopOptions {
  userIntervalMs: number;
  catalogIntervalMs: number;
  stopped: () => boolean;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Run both passes forever, each on its own cadence, until stopped.
 *
 * The two passes are INDEPENDENT loops. They used to share one: a catalog pass
 * is five polite per-board budgets back to back (≈20 minutes), and during it no
 * user could be searched, so every user's queue stalled for a third of each
 * hour. Running them side by side keeps per-user discovery on its 5-minute beat.
 *
 * Politeness is unaffected: both passes use the same politeFetch, whose per-host
 * queue serialises every request to a board no matter which pass made it. And
 * the JobVision feed de-duplicates a refresh both passes ask for at once.
 *
 * A failed pass is logged and its loop carries on — discovery must never take
 * the node down.
 */
export async function runDiscoveryLoop(
  runner: DiscoveryRunner,
  log: Logger,
  options: DiscoveryLoopOptions,
  now: () => number = Date.now,
): Promise<void> {
  // Wait in short slices so a stop request is honoured promptly — systemd
  // hard-kills a unit that has not exited ~90 s after SIGTERM.
  async function idle(ms: number): Promise<void> {
    const until = now() + ms;
    while (!options.stopped() && now() < until) {
      await options.sleep(Math.min(5_000, until - now()));
    }
  }

  const userLoop = (async () => {
    while (!options.stopped()) {
      try {
        const users = await runner.runUsers();
        if (users.users > 0) log.info("discovery user pass", { ...users });
      } catch (err) {
        log.warn("discovery user pass failed", { reason: err instanceof Error ? err.message : String(err) });
      }
      await idle(options.userIntervalMs);
    }
  })();

  const catalogLoop = (async () => {
    while (!options.stopped()) {
      try {
        log.info("discovery catalog pass", { ...(await runner.runCatalog()) });
      } catch (err) {
        log.warn("discovery catalog pass failed", { reason: err instanceof Error ? err.message : String(err) });
      }
      await idle(options.catalogIntervalMs);
    }
  })();

  await Promise.all([userLoop, catalogLoop]);
}
