/**
 * Background service worker — the trusted core of the extension.
 *
 * Responsibilities:
 *   • Owns the Karjoo extension session token (in chrome.storage). The popup and
 *     content scripts never read it directly; they message the worker to act.
 *   • Talks to the Karjoo control plane via KarjooApi.
 *   • Performs LOCAL board-session detection (chrome.cookies for Jobinja; asks
 *     the JobVision content script for the SET of localStorage KEYS present).
 *   • Builds the metadata-only connect payload (no secret material — RULE 1).
 *
 * It is a thin message router; all decision logic lives in the tested pure libs.
 */
import {
  ACTIVE_PROVIDER_IDS,
  BOARDS,
  BOARD_IDS,
  PROVIDER_JOBS_URLS,
  type ActiveProviderId,
  type BoardId,
} from "@ext/lib/config";
import { ApiError, KarjooApi } from "@ext/lib/api-client";
import { buildConnectPayload } from "@ext/lib/connect-payload";
import { buildImportPayload } from "@ext/lib/import-payload";
import {
  deriveProviderState,
  needsKarjooReconcile,
  reconciledProviderState,
  withProviderEnabled,
} from "@ext/lib/provider-manager";
import {
  jobinjaLoggedIn,
  jobvisionLoggedIn,
  eEstekhdamLoggedIn,
  sessionTokenKeys,
  sessionShapeOf,
  type CookieLike,
} from "@ext/lib/board-detect";
import { boardTabPatterns } from "@ext/lib/board-session";
import { probeIranTalentIdentity } from "@ext/lib/irantalent-session";
import {
  getApiOrigin,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  setIdentity,
  getAutoApplySettings,
  getAutoApplyStatus,
} from "@ext/lib/storage";
import {
  setupAutoApplyAlarms,
  registerAutoApplyAlarmListener,
  getRunOverview,
  mutateRun,
  runAutoApplyTick,
  setRunBackground,
} from "@ext/background/auto-apply";
import { sendToTab, waitForTabComplete } from "@ext/background/tab-utils";
import type {
  PopupToBackground,
  ProbeSessionResult,
  Result,
} from "@ext/lib/messages";
import type {
  ApplyQueueItem,
  Identity,
  ApplyResultReport,
  AutoApplySettings,
  AutoApplyStatus,
  ApplyFilters,
  JobinjaCategory,
  BoardCatalog,
  ProviderState,
} from "@ext/lib/types";
import type { ScrapeProfileResult, BoardImportOutcome } from "@ext/lib/import-types";

/** Build an authed API client from current storage state. */
async function apiFromStorage(requireToken = true): Promise<KarjooApi> {
  const origin = await getApiOrigin();
  const token = await getSessionToken();
  if (requireToken && !token) throw new Error("not paired — pair the extension first");
  return new KarjooApi({ origin, token });
}

/* ── pairing (no second OTP — RULE 5) ──────────────────────────────────── */

async function handlePair(code: string): Promise<Identity | null> {
  const origin = await getApiOrigin();
  // No token yet — /link is the bootstrap call.
  const api = new KarjooApi({ origin, token: null });
  const { token, identity } = await api.link(code);
  await setSessionToken(token); // store KARJOO's own token (never a board secret)
  if (identity) await setIdentity(identity);
  return identity ?? null;
}

async function handleGetIdentity(): Promise<Identity | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const api = await apiFromStorage();
  const identity = await api.me();
  await setIdentity(identity);
  return identity;
}

/* ── local board-session detection (RULE 1: boolean only) ──────────────── */

async function probeBoardSession(board: BoardId): Promise<ProbeSessionResult> {
  if (board === "e-estekhdam") return probeEEstekhdamSession();
  // IranTalent answers authoritatively from its own profile endpoint, so it needs
  // no open tab — see irantalent-session.ts for why the token is read there.
  if (board === "irantalent") return probeIranTalentIdentity();
  // Cookie-shaped boards (Jobinja, e-estekhdam): read cookie NAMES via
  // chrome.cookies and decide a boolean. The cookie VALUE is never read out of
  // the browser, never sent to Karjoo (RULE 1).
  if (sessionShapeOf(board) === "cookie") {
    const host = boardCookieDomain(board);
    const cookies = await chrome.cookies.getAll({ domain: host });
    const cookieLikes: CookieLike[] = cookies.map((c) => ({ name: c.name, value: c.value }));
    const loggedIn =
      board === "jobinja" ? jobinjaLoggedIn(cookieLikes) : eEstekhdamLoggedIn(cookieLikes);
    return loggedIn ? { loggedIn } : { loggedIn, reason: "logged_out" };
  }

  // Token-shaped boards (JobVision): the token is in localStorage, invisible to
  // chrome.cookies. Ask the content script which KEYS exist (never values) and
  // decide a boolean from the key NAMES alone.
  const probe = await probeBrowserStorageKeys(board);
  return jobvisionLoggedIn(probe.keys)
    ? { loggedIn: true }
    : { loggedIn: false, reason: probe.reason };
}

/** Ask e-estekhdam's own session endpoint inside a site tab and return only a boolean. */
async function probeEEstekhdamSession(): Promise<ProbeSessionResult> {
  const tabs = await chrome.tabs.query({ url: boardTabPatterns(BOARDS["e-estekhdam"].origin) });
  if (tabs.length === 0) return { loggedIn: false, reason: "no_tab" };
  tabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
  let probeSucceeded = false;
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          try {
            const response = await fetch("/search-api/auth/session", {
              method: "POST",
              headers: { accept: "application/json", "content-type": "application/json" },
              credentials: "include",
              body: "{}",
            });
            if (!response.ok) return false;
            const payload = await response.json() as { data?: unknown };
            return Boolean(
              payload.data &&
              typeof payload.data === "object" &&
              Object.keys(payload.data as Record<string, unknown>).length > 0,
            );
          } catch {
            return false;
          }
        },
      });
      probeSucceeded = true;
      if (execution?.result === true) return { loggedIn: true };
    } catch {
      // Continue with another e-estekhdam tab; stale tabs can reject injection.
    }
  }
  return {
    loggedIn: false,
    reason: probeSucceeded ? "session_not_found" : "probe_unavailable",
  };
}

/** The chrome.cookies domain filter for a cookie-shaped board. */
function boardCookieDomain(board: BoardId): string {
  return new URL(BOARDS[board].origin).hostname.replace(/^www\./, "");
}

type StorageProbe = {
  keys: string[];
  reason: "no_tab" | "session_not_found" | "probe_unavailable";
};

/**
 * Inspect every board tab, including account/candidate subdomains. Only matching
 * storage KEY NAMES are returned; token values are never read.
 */
async function probeBrowserStorageKeys(board: BoardId): Promise<StorageProbe> {
  const tabs = await chrome.tabs.query({ url: boardTabPatterns(BOARDS[board].origin) });
  const candidates = sessionTokenKeys(board);
  let probeSucceeded = false;

  tabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      const response = (await chrome.tabs.sendMessage(tab.id, {
        type: "PROBE_SESSION",
        board,
      })) as { localStorageKeys?: string[] } | undefined;
      if (Array.isArray(response?.localStorageKeys)) {
        probeSucceeded = true;
        if (response.localStorageKeys.length > 0) {
          return { keys: response.localStorageKeys, reason: "session_not_found" };
        }
      }
    } catch {
      // Old tabs may not have the current content script. The scripting fallback
      // below works immediately without asking the user to reload the page.
    }

    try {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [candidates],
        func: (candidateKeys: string[]) => {
          const wanted = new Set(candidateKeys.map((key) => key.toLowerCase()));
          const present = new Set<string>();
          for (const storage of [window.localStorage, window.sessionStorage]) {
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              if (key && wanted.has(key.toLowerCase())) present.add(key);
            }
          }
          return [...present];
        },
      });
      if (Array.isArray(execution?.result)) {
        probeSucceeded = true;
        if (execution.result.length > 0) {
          return { keys: execution.result, reason: "session_not_found" };
        }
      }
    } catch {
      // Continue across tabs: another JobVision origin may own the active session.
    }
  }

  if (tabs.length === 0) return { keys: [], reason: "no_tab" };
  return {
    keys: [],
    reason: probeSucceeded ? "session_not_found" : "probe_unavailable",
  };
}

/* ── connect board (metadata-only POST — RULE 1) ───────────────────────── */

async function handleConnectBoard(board: BoardId, accountLabel?: string): Promise<{ ok: boolean }> {
  // Build the payload through the single chokepoint that PROVES no secret leaks.
  const payload = buildConnectPayload({ board, accountLabel });
  const api = await apiFromStorage();
  return api.connectBoard(payload);
}

async function handleGetProviderStates(): Promise<ProviderState[]> {
  const api = await apiFromStorage();
  const [{ boards }, { filters }, probes] = await Promise.all([
    api.meRaw(),
    api.getApplyFilters(),
    Promise.all(ACTIVE_PROVIDER_IDS.map((board) =>
      probeBoardSession(board).catch((): ProbeSessionResult => ({
        loggedIn: false,
        reason: "probe_unavailable",
      })),
    )),
  ]);
  const statusByBoard = new Map(boards.map((account) => [account.board, account.status ?? null]));

  const states = ACTIVE_PROVIDER_IDS.map((board, index) => deriveProviderState({
    board,
    enabled: filters.boardFilters[board].enabled,
    serverStatus: statusByBoard.get(board),
    probe: probes[index]!,
  }));

  // Read-and-reconcile: a real local session is the source of truth for "is this
  // provider usable?", so when we find one we bring Karjoo's own metadata into
  // line instead of showing a stale "login required". Idempotent — a provider
  // already marked connected reconciles to false and no write is made.
  return Promise.all(states.map(async (state, index) => {
    if (!needsKarjooReconcile(state)) return state;
    try {
      await handleConnectBoard(state.board, probes[index]!.accountLabelHint);
      return reconciledProviderState(state);
    } catch {
      // Karjoo is unreachable or refused; report what we actually observed.
      return state;
    }
  }));
}

async function setProviderEnabled(board: ActiveProviderId, enabled: boolean): Promise<void> {
  const api = await apiFromStorage();
  const { filters } = await api.getApplyFilters();
  await api.saveApplyFilters(withProviderEnabled(filters, board, enabled));
}

async function handleManageProvider(
  board: ActiveProviderId,
  action: "pause" | "resume" | "login" | "reconnect" | "disconnect",
): Promise<ProviderState[]> {
  if (action === "login") {
    await chrome.tabs.create({ url: PROVIDER_JOBS_URLS[board], active: true });
    return handleGetProviderStates();
  }

  if (action === "pause" || action === "resume") {
    await setProviderEnabled(board, action === "resume");
    return handleGetProviderStates();
  }

  if (action === "disconnect") {
    // Stop new discovery/claims first. This deliberately does not clear provider cookies.
    await setProviderEnabled(board, false);
    await (await apiFromStorage()).disconnectBoard(board);
    return handleGetProviderStates();
  }

  const probe = await probeBoardSession(board);
  if (!probe.loggedIn) {
    await chrome.tabs.create({ url: PROVIDER_JOBS_URLS[board], active: true });
    return handleGetProviderStates();
  }
  await handleConnectBoard(board, probe.accountLabelHint);
  await setProviderEnabled(board, true);
  return handleGetProviderStates();
}

/* ── apply queue ───────────────────────────────────────────────────────── */

async function handleClaimQueue(): Promise<ApplyQueueItem[]> {
  const api = await apiFromStorage();
  const { items } = await api.claimQueue();
  return items;
}

/**
 * Populate the apply queue on demand from the user's saved FILTER selections
 * (the pivot's default, NON-AI flow). POSTs /api/apply/find-jobs; the control
 * plane scrapes the user's filtered search and enqueues every matching listing
 * (bound to THIS session's user server-side). Returns the newly-queued count so
 * the popup can report it and then refresh the queue.
 */
async function handleFindJobs(): Promise<{ queued: number }> {
  const api = await apiFromStorage();
  return api.findJobs();
}

async function handleGetApplyFilters(): Promise<{ filters: ApplyFilters; previewUrl: string }> {
  return (await apiFromStorage()).getApplyFilters();
}

async function handleSaveApplyFilters(
  filters: Omit<ApplyFilters, "aiFilterEnabled">,
): Promise<{ filters: ApplyFilters; previewUrl: string }> {
  return (await apiFromStorage()).saveApplyFilters(filters);
}

async function handleGetJobinjaCategories(): Promise<JobinjaCategory[]> {
  return (await apiFromStorage()).getJobinjaCategories();
}

async function handleGetBoardCatalog(
  board: "jobinja" | "jobvision" | "e-estekhdam" | "irantalent",
): Promise<BoardCatalog> {
  return (await apiFromStorage()).getBoardCatalog(board);
}

async function handleRetryApplication(applicationId: string): Promise<{ ok: boolean; taskId: string }> {
  return (await apiFromStorage()).retryApplication(applicationId);
}

async function handleGetApplicationResume(applicationId: string): Promise<string> {
  return (await apiFromStorage()).getApplicationResumeHtml(applicationId);
}

/** Pre-fill (NEVER submit) the form in the relevant board tab. */
async function handlePrefill(item: ApplyQueueItem): Promise<{ ok: boolean; filledFields: string[] }> {
  const origin = BOARDS[item.board]?.origin;
  if (!origin) throw new Error(`unknown board: ${item.board}`);

  // Ensure the job page is open in a tab, then ask its content script to pre-fill.
  const tab = await ensureTab(item.jobUrl, origin);
  if (!tab?.id) throw new Error("could not open the job page");

  // Fresh tab: wait for load + retry so CONTENT_PREFILL doesn't hit "no receiving end".
  await waitForTabComplete(tab.id);
  const resp = await sendToTab<{ ok: boolean; filledFields: string[] } | undefined>(tab.id, {
    type: "CONTENT_PREFILL",
    item,
  });

  return resp ?? { ok: false, filledFields: [] };
}

/** Report the outcome of a user APPROVED/skipped application. */
async function handleReportResult(report: ApplyResultReport): Promise<{ ok: boolean }> {
  const api = await apiFromStorage();
  const res = await api.reportResult(report);
  return { ok: res.ok };
}

/* ── auto-apply (§10): toggle + status, all server-authoritative ───────────── */

/**
 * Read the auto-apply settings. The SERVER is authoritative; we return the
 * server's value and refresh the local cache. If the server call fails (e.g.
 * offline) we fall back to the cached value so the popup still renders.
 */
async function handleGetAutoApply(): Promise<AutoApplySettings> {
  try {
    const api = await apiFromStorage();
    const s = await api.getAutoApplySettings();
    const settings: AutoApplySettings = { enabled: s.enabled, minScore: s.minScore };
    return settings;
  } catch {
    return getAutoApplySettings();
  }
}

/**
 * Set the auto-apply toggle/threshold (explicit user consent in the popup). The
 * server is the source of truth — we PUT it and, on success, ensure the alarms
 * exist so a freshly-enabled toggle starts draining on the next tick.
 */
async function handleSetAutoApply(enabled: boolean, minScore?: number): Promise<AutoApplySettings> {
  const api = await apiFromStorage();
  const saved = await api.setAutoApplySettings({ enabled, ...(minScore !== undefined ? { minScore } : {}) });
  // Make sure the periodic drain is scheduled (idempotent).
  setupAutoApplyAlarms();
  return saved;
}

async function handleGetAutoApplyStatus(): Promise<AutoApplyStatus | null> {
  return getAutoApplyStatus();
}

/** Manual "run now" from the popup → one background tick (still fully gated). */
/**
 * cvIdِ جابینجا (که هوکِ دنیای MAIN برداشته) را روی سرور ذخیره می‌کند تا نوشتنِ سمتِ سرورِ
 * پروفایل بتواند CV را آدرس‌دهی کند. فقط id — نه کوکی/داده. خطا بی‌صدا (پیش‌فرضِ push بعدی).
 */
async function handleJobinjaCvid(cvId: string): Promise<{ ok: boolean }> {
  if (!/^[A-Za-z0-9]{2,8}$/.test(cvId)) return { ok: false };
  const api = await apiFromStorage();
  await api.pushJobinja({ profile: { cvId } });
  return { ok: true };
}

async function handleRunAutoApplyNow(): Promise<AutoApplyStatus> {
  return runAutoApplyTick();
}

/* ── profile import (DATA only — RULE 1) ───────────────────────────────────
 * For each requested board: open the user's OWN profile page, ask the import
 * content script to scrape DATA (text), build the DATA-ONLY payload through the
 * chokepoint that PROVES no credential is present, then POST to /api/profile/
 * import. The server binds the data to THIS session's user and re-runs the same
 * no-credentials guard (defense in depth). User-present, user-approved.
 */
async function handleImportProfiles(boards?: BoardId[]): Promise<BoardImportOutcome[]> {
  const api = await apiFromStorage();
  const targets = boards && boards.length > 0 ? boards : BOARD_IDS;
  const outcomes: BoardImportOutcome[] = [];

  for (const board of targets) {
    try {
      outcomes.push(await importOneBoard(api, board));
    } catch (err) {
      outcomes.push({
        board,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

/** Import one board: open profile page → scrape DATA → DATA-only POST. */
async function importOneBoard(api: KarjooApi, board: BoardId): Promise<BoardImportOutcome> {
  const cfg = BOARDS[board];
  const profileUrl = `${cfg.origin}${cfg.profilePath}`;

  // صفحه‌ی رزومه‌ی خودِ کاربر را باز (یا فوکوس) می‌کنیم — جابینجا: /app/cv-builder (راستی‌آزمایی‌شده).
  // اگر نشانیِ بردِ دیگری هنوز درست نباشد، اسکرپر «رزومه پیدا نشد» را با پیامِ راهنما برمی‌گرداند.
  const tab = await ensureTab(profileUrl, cfg.origin);
  if (!tab?.id) return { board, ok: false, message: "نتوانستم صفحه‌ی رزومه را باز کنم." };

  // Ask the import content script to read the user's OWN profile DOM (DATA only).
  let scraped: ScrapeProfileResult | undefined;
  try {
    scraped = (await chrome.tabs.sendMessage(tab.id, {
      type: "SCRAPE_PROFILE",
      board,
    })) as ScrapeProfileResult | undefined;
  } catch {
    return {
      board,
      ok: false,
      message: "اسکریپت ایمپورت روی صفحه آماده نشد. صفحه را تازه کنید و دوباره تلاش کنید.",
    };
  }

  if (!scraped?.ok || !scraped.profile) {
    return {
      board,
      ok: false,
      message:
        scraped?.message ??
        "رزومه‌ای در این صفحه پیدا نشد — صفحه‌ی رزومه‌ات را در این سایت باز کن و دوباره «وارد کردن» را بزن.",
    };
  }

  // Build the DATA-ONLY body. This THROWS if any credential-shaped key sneaked in
  // — the single chokepoint that makes "no secret leaves the browser" provable.
  const body = buildImportPayload(board, scraped.profile);
  const res = await api.importProfile(body);
  return { board, ok: res.ok, importedSummary: res.summary, message: "ایمپورت شد" };
}

/** Find an open tab for the job URL or open a new one focused on it. */
async function ensureTab(jobUrl: string, origin: string): Promise<chrome.tabs.Tab | undefined> {
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const match = existing.find((t) => t.url && sameJob(t.url, jobUrl));
  if (match) {
    await chrome.tabs.update(match.id!, { active: true });
    return match;
  }
  return chrome.tabs.create({ url: jobUrl, active: true });
}

function sameJob(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

/* ── message router ────────────────────────────────────────────────────── */

async function route(msg: PopupToBackground): Promise<Result<unknown>> {
  switch (msg.type) {
    case "PAIR":
      return { ok: true, data: await handlePair(msg.code) };
    case "GET_IDENTITY":
      return { ok: true, data: await handleGetIdentity() };
    case "SIGN_OUT":
      await clearSessionToken();
      return { ok: true, data: { signedOut: true } };
    case "DETECT_BOARD":
      return { ok: true, data: await probeBoardSession(msg.board) };
    case "CONNECT_BOARD":
      return { ok: true, data: await handleConnectBoard(msg.board, msg.accountLabel) };
    case "GET_PROVIDER_STATES":
      return { ok: true, data: await handleGetProviderStates() };
    case "MANAGE_PROVIDER":
      return { ok: true, data: await handleManageProvider(msg.board, msg.action) };
    case "CLAIM_QUEUE":
      return { ok: true, data: await handleClaimQueue() };
    case "FIND_JOBS":
      return { ok: true, data: await handleFindJobs() };
    case "PREFILL":
      return { ok: true, data: await handlePrefill(msg.item) };
    case "REPORT_RESULT":
      return { ok: true, data: await handleReportResult(msg.report) };
    case "IMPORT_PROFILES":
      return { ok: true, data: await handleImportProfiles(msg.boards) };
    case "GET_AUTO_APPLY":
      return { ok: true, data: await handleGetAutoApply() };
    case "SET_AUTO_APPLY":
      return { ok: true, data: await handleSetAutoApply(msg.enabled, msg.minScore) };
    case "GET_AUTO_APPLY_STATUS":
      return { ok: true, data: await handleGetAutoApplyStatus() };
    case "RUN_AUTO_APPLY_NOW":
      return { ok: true, data: await handleRunAutoApplyNow() };
    case "GET_RUN_OVERVIEW":
      return { ok: true, data: await getRunOverview() };
    case "MUTATE_RUN":
      return {
        ok: true,
        data: await mutateRun(msg.action, msg.backgroundEnabled ?? true),
      };
    case "SET_RUN_BACKGROUND":
      return { ok: true, data: await setRunBackground(msg.enabled) };
    case "GET_APPLY_FILTERS":
      return { ok: true, data: await handleGetApplyFilters() };
    case "SAVE_APPLY_FILTERS":
      return { ok: true, data: await handleSaveApplyFilters(msg.filters) };
    case "GET_JOBINJA_CATEGORIES":
      return { ok: true, data: await handleGetJobinjaCategories() };
    case "GET_BOARD_CATALOG":
      return { ok: true, data: await handleGetBoardCatalog(msg.board) };
    case "RETRY_APPLICATION":
      return { ok: true, data: await handleRetryApplication(msg.applicationId) };
    case "GET_APPLICATION_RESUME":
      return { ok: true, data: await handleGetApplicationResume(msg.applicationId) };
    case "JOBINJA_CVID":
      return { ok: true, data: await handleJobinjaCvid(msg.cvId) };
    default: {
      const _exhaustive: never = msg;
      return { ok: false, error: `unknown message: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: PopupToBackground, _sender, sendResponse) => {
  route(msg)
    .then(sendResponse)
    .catch(async (err: unknown) => {
      // A 401 from the control plane means our extension session is dead (expired or
      // revoked). Clear the stored token so the popup drops back to the pairing view
      // instead of a "logged-in but everything fails" limbo — and return an error the
      // popup recognizes as an auth failure (not a cold-worker timeout).
      if (err instanceof ApiError && err.status === 401) {
        await clearSessionToken().catch(() => {});
        sendResponse({
          ok: false,
          error: "401 نشستِ افزونه منقضی شده؛ دوباره از داشبورد متصل شوید.",
        } satisfies Result<never>);
        return;
      }
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error } satisfies Result<never>);
    });
  // Keep the message channel open for the async response.
  return true;
});

/* ── auto-apply alarms (§10) ────────────────────────────────────────────────
 * Register the alarm LISTENER at load (so it survives the SW being respawned to
 * handle an alarm), and (re)create the alarms on install/startup. The tick itself
 * does NOTHING unless the server-side toggle is ON — see auto-apply.ts. The
 * service worker (and thus background apply) runs only while the browser runs;
 * 24/7 apply is the Max/Max+ worker tier (README). */
registerAutoApplyAlarmListener();
async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
}
chrome.runtime.onInstalled.addListener(() => {
  setupAutoApplyAlarms();
  void configureSidePanel();
});
chrome.runtime.onStartup.addListener(() => setupAutoApplyAlarms());
// Also ensure on plain load (covers dev-reload where onInstalled may not fire).
setupAutoApplyAlarms();
void configureSidePanel();
