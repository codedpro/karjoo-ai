/**
 * Popup controller.
 *
 * Three jobs:
 *   1. PAIRING — paste the one-time code → POST /api/extension/link (no 2nd OTP).
 *   2. CONNECT BOARDS — detect local login per board; on connect, send ONLY the
 *      metadata payload { board, status, accountLabel } (RULE 1). The UI never
 *      handles a raw board cookie/token.
 *   3. ASSISTED APPLY — render queue cards with the AI cover letter; "Pre-fill"
 *      fills the form, and a SEPARATE explicit "Approve & submit" click is the
 *      only thing that records a submission (RULE 2).
 *
 * All decision logic lives in tested pure libs (queue-view, pairing-code, etc.);
 * this file is the thin DOM binding.
 */
import { BOARDS, type BoardId } from "@ext/lib/config";
import { isPaired, getApiOrigin } from "@ext/lib/storage";
import { isValidPairingCodeShape, normalizePairingCode } from "@ext/lib/pairing-code";
import { toQueueCardViews, type QueueCardView } from "@ext/lib/queue-view";
import { stateLabel, thresholdLabel, lastRunLabel } from "@ext/lib/auto-apply-view";
import { checkForUpdate, type UpdateCheckResult } from "@ext/lib/update-check";
import type {
  Identity,
  ApplyQueueItem,
  AutoApplySettings,
  AutoApplyStatus,
} from "@ext/lib/types";
import type { ProbeSessionResult, BoardImportOutcome } from "@ext/lib/messages";
import { send } from "@ext/popup/messaging";

/* ── tiny DOM utils ────────────────────────────────────────────────────── */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};
/** Null-tolerant lookup: used where a missing element must NOT throw and blank the popup. */
const $opt = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;
const show = (el: HTMLElement, on = true) => (el.hidden = !on);
const setText = (el: HTMLElement, text: string) => (el.textContent = text);

function showGlobalError(message: string) {
  const el = $opt("global-error");
  if (!el) return;
  setText(el, message);
  show(el, true);
}

/* ── boot (RENDER-FIRST — must never blank the popup, BUG 3) ─────────────────
 * The popup previously awaited getApiOrigin()/isPaired()/a cold-SW round-trip at
 * the top of boot(); if any of those threw or hung, the popup painted nothing and
 * the user had to toggle devtools until it appeared. Now boot() paints a visible
 * shell SYNCHRONOUSLY (choose a view + wire the always-safe handlers), then loads
 * async state in a separate, fully guarded phase. No await runs before the first
 * paint, and every async call is try/caught so a rejection can't leave a blank UI.
 */
function boot() {
  // Wiring is pure DOM (no await, no messaging) → always safe, paints instantly.
  wirePairing();
  wireSignOut();

  // Kick off the async phase WITHOUT awaiting it here — the shell is already up.
  void bootAsync();

  // Update check is best-effort and fully isolated; never blocks or blanks.
  void maybeShowUpdateBanner();
}

/**
 * Async boot phase: decide paired vs. pairing view and hydrate main. Guarded so
 * a slow/asleep service worker or a storage hiccup shows a view + error, never a
 * blank popup.
 */
async function bootAsync() {
  let paired = false;
  try {
    paired = await isPaired();
  } catch (e) {
    // Storage unreadable → fall back to the pairing view so the popup is usable.
    showGlobalError(errMsg(e));
  }

  if (paired) {
    try {
      await enterMain();
    } catch (e) {
      // enterMain hydrates the main view; a structural/DOM failure here must not
      // leave a blank popup — surface it and still show whatever painted.
      showGlobalError(errMsg(e));
    }
  } else {
    const view = $opt("view-pair");
    if (view) show(view, true);
  }
}

/* ── pairing view ──────────────────────────────────────────────────────── */
function wirePairing() {
  const submit = $opt("pair-submit");
  if (!submit) return;
  submit.addEventListener("click", async () => {
    const errEl = $opt("pair-error");
    if (errEl) show(errEl, false);
    const codeInput = $opt<HTMLInputElement>("pair-code");
    const code = normalizePairingCode(codeInput?.value ?? "");
    if (!isValidPairingCodeShape(code)) {
      if (errEl) {
        setText(errEl, "کد اتصال نامعتبر است. دوباره از داشبورد کپی کنید.");
        show(errEl, true);
      }
      return;
    }
    const btn = submit as HTMLButtonElement;
    btn.disabled = true;
    try {
      // The control-plane origin is LOCKED at build time (getApiOrigin), so /link
      // always hits the production plane — no per-user origin to persist first.
      await send<Identity | null>({ type: "PAIR", code });
      const view = $opt("view-pair");
      if (view) show(view, false);
      await enterMain();
    } catch (e) {
      if (errEl) {
        setText(errEl, errMsg(e));
        show(errEl, true);
      }
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── update banner (BUG 5 — notify + one-click re-download) ───────────────────
 * Compares this build's manifest version to the control plane's latest. On a
 * newer server version, reveals the banner linking to the zip + reload steps.
 * Fully best-effort: any network/parse failure leaves the banner hidden and the
 * popup unaffected (never blocks, never throws).
 */
async function maybeShowUpdateBanner() {
  try {
    const current = chrome.runtime.getManifest().version;
    const origin = await getApiOrigin();
    const result = await checkForUpdate(origin, current);
    renderUpdateBanner(result, origin);
  } catch {
    // Any failure → no banner. The popup is already rendered regardless.
  }
}

function renderUpdateBanner(result: UpdateCheckResult, origin: string) {
  if (!result.updateAvailable) return;
  const banner = $opt("update-banner");
  if (!banner) return;

  const download = $opt<HTMLAnchorElement>("update-download");
  if (download && result.downloadUrl) download.href = result.downloadUrl;

  const steps = $opt<HTMLAnchorElement>("update-steps");
  if (steps) steps.href = `${origin.replace(/\/+$/, "")}/dashboard/extension`;

  const notes = $opt("update-banner-notes");
  if (notes) {
    if (result.notes) {
      setText(notes, result.notes);
      show(notes, true);
    } else {
      show(notes, false);
    }
  }

  show(banner, true);
}

function wireSignOut() {
  const btn = $opt("signout");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await send({ type: "SIGN_OUT" });
    } catch (e) {
      // Best-effort: even if the SW is asleep/unreachable, reload to a clean state.
      showGlobalError(errMsg(e));
    } finally {
      location.reload();
    }
  });
}

/* ── main view ─────────────────────────────────────────────────────────── */
async function enterMain() {
  show($("view-main"), true);
  show($("signout"), true);
  wireTabs();

  try {
    const identity = await send<Identity | null>({ type: "GET_IDENTITY" });
    setText($("identity-label"), identityLabel(identity));
  } catch (e) {
    setText($("identity-label"), "وارد شده");
    showGlobalError(errMsg(e));
  }

  renderBoards();
  wireImport();
  wireAutoApply();
  $("refresh-queue").addEventListener("click", () => void loadQueue());
  void loadQueue();
}

/* ── auto-apply tab (§10 — opt-in, revocable) ──────────────────────────────── */
function wireAutoApply() {
  const toggle = $("auto-toggle") as HTMLInputElement;
  const runNow = $("auto-run-now") as HTMLButtonElement;

  // Mirror the server's current settings into the control.
  void refreshAutoApplyView();

  toggle.addEventListener("change", async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    try {
      const saved = await send<AutoApplySettings>({ type: "SET_AUTO_APPLY", enabled });
      renderAutoSettings(saved);
    } catch (e) {
      // Revert the checkbox to the truthful (server) state on failure.
      showGlobalError(errMsg(e));
      await refreshAutoApplyView();
    } finally {
      toggle.disabled = false;
    }
  });

  runNow.addEventListener("click", async () => {
    runNow.disabled = true;
    const original = runNow.textContent;
    runNow.textContent = "در حال اجرا…";
    try {
      const status = await send<AutoApplyStatus>({ type: "RUN_AUTO_APPLY_NOW" });
      renderAutoStatus(status);
    } catch (e) {
      showGlobalError(errMsg(e));
    } finally {
      runNow.disabled = false;
      runNow.textContent = original;
    }
  });
}

async function refreshAutoApplyView() {
  try {
    const settings = await send<AutoApplySettings>({ type: "GET_AUTO_APPLY" });
    renderAutoSettings(settings);
  } catch (e) {
    setText($("auto-state"), "وضعیت نامشخص");
    showGlobalError(errMsg(e));
  }
  try {
    const status = await send<AutoApplyStatus | null>({ type: "GET_AUTO_APPLY_STATUS" });
    renderAutoStatus(status);
  } catch {
    // Status is best-effort; leave the default text.
  }
}

function renderAutoSettings(settings: AutoApplySettings) {
  (($("auto-toggle") as HTMLInputElement).checked = settings.enabled);
  setText($("auto-state"), stateLabel(settings));
  setText($("auto-threshold"), thresholdLabel(settings));
  // "Run now" is only meaningful when the toggle is on.
  ($("auto-run-now") as HTMLButtonElement).disabled = !settings.enabled;
}

function renderAutoStatus(status: AutoApplyStatus | null) {
  setText($("auto-last-run"), lastRunLabel(status));
}

function identityLabel(identity: Identity | null): string {
  if (!identity) return "وارد شده";
  return identity.displayName || identity.email || "وارد شده";
}

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));
  const activate = (name: string) => {
    for (const t of tabs) t.classList.toggle("active", t.dataset.tab === name);
    for (const p of panels) show(p, p.dataset.panel === name);
  };
  for (const t of tabs) t.addEventListener("click", () => activate(t.dataset.tab!));
  activate("boards");
}

/* ── connect boards ────────────────────────────────────────────────────── */
function renderBoards() {
  const list = $("boards-list");
  list.innerHTML = "";
  for (const board of Object.values(BOARDS)) {
    list.appendChild(boardCard(board.id, board.displayName));
  }
}

function boardCard(board: BoardId, displayName: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "board-card";
  li.innerHTML = `
    <div class="board-head">
      <span class="board-name">${escapeHtml(displayName)}</span>
      <span class="status-pill" data-status>در حال بررسی…</span>
    </div>
    <input class="input board-label-input" data-label placeholder="برچسب حساب (اختیاری)" autocomplete="off" />
    <div class="board-actions">
      <button class="btn btn-ghost btn-sm" data-detect>بررسی ورود</button>
      <button class="btn btn-primary btn-sm" data-connect>اتصال</button>
    </div>
  `;
  const statusEl = li.querySelector<HTMLElement>("[data-status]")!;
  const connectBtn = li.querySelector<HTMLButtonElement>("[data-connect]")!;
  const detectBtn = li.querySelector<HTMLButtonElement>("[data-detect]")!;
  const labelInput = li.querySelector<HTMLInputElement>("[data-label]")!;

  // تشخیصِ ورود «مشورتی» است، نه دروازه‌بان: هرگز دکمه‌ی «اتصال» را غیرفعال نمی‌کند.
  // خودِ کاربر می‌داند وارد شده یا نه؛ و «اتصال» فقط متادیتای {board} را ذخیره می‌کند
  // (هیچ کوکی/توکنی فرستاده نمی‌شود). پس تشخیصِ ناموفق نباید کاربر را قفل کند.
  const detect = async () => {
    setStatus(statusEl, "در حال بررسی…", "");
    detectBtn.disabled = true;
    try {
      const res = await send<ProbeSessionResult>({ type: "DETECT_BOARD", board });
      if (res.loggedIn) {
        setStatus(statusEl, "وارد شده در مرورگر شما", "ok");
      } else {
        setStatus(statusEl, "ورود تشخیص داده نشد — اگر واردید، «اتصال» را بزنید", "warn");
      }
    } catch {
      setStatus(statusEl, "بررسی ناموفق بود — می‌توانید دستی «اتصال» بزنید", "warn");
    } finally {
      detectBtn.disabled = false;
    }
  };

  detectBtn.addEventListener("click", () => void detect());
  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    try {
      // accountLabel is the ONLY user-provided string sent; it is NOT a credential.
      await send({ type: "CONNECT_BOARD", board, accountLabel: labelInput.value || undefined });
      setStatus(statusEl, "متصل شد", "ok");
    } catch (e) {
      showGlobalError(errMsg(e));
      connectBtn.disabled = false;
    }
  });

  // Auto-detect on render for convenience.
  void detect();
  return li;
}

function setStatus(el: HTMLElement, text: string, cls: "" | "ok" | "warn") {
  el.textContent = text;
  el.className = `status-pill${cls ? " " + cls : ""}`;
}

/* ── import my profile (DATA only — §10) ───────────────────────────────────
 * Asks the background to read the user's OWN profile DATA from each connected
 * board and POST it to Karjoo. The popup never touches a board cookie/token; it
 * only triggers the action and renders the per-board outcome summary.
 */
function wireImport() {
  const btn = $("import-profiles") as HTMLButtonElement;
  const resultsEl = $("import-results");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "در حال وارد کردن…";
    resultsEl.innerHTML = "";
    try {
      // No `boards` → background imports from all configured boards (those the
      // user is logged into return data; others report "not found" gracefully).
      const outcomes = await send<BoardImportOutcome[]>({ type: "IMPORT_PROFILES" });
      renderImportResults(resultsEl, outcomes);
    } catch (e) {
      showGlobalError(errMsg(e));
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function renderImportResults(listEl: HTMLElement, outcomes: BoardImportOutcome[]) {
  listEl.innerHTML = "";
  for (const o of outcomes) {
    const li = document.createElement("li");
    li.className = `import-result ${o.ok ? "ok" : "warn"}`;
    const name = BOARDS[o.board]?.displayName ?? o.board;
    const detail = o.ok ? (o.importedSummary ?? "وارد شد") : (o.message ?? "ناموفق");
    li.innerHTML = `<span class="import-board">${escapeHtml(name)}</span><span class="import-detail">${escapeHtml(detail)}</span>`;
    listEl.appendChild(li);
  }
}

/* ── apply queue ───────────────────────────────────────────────────────── */
async function loadQueue() {
  const listEl = $("queue-list");
  const emptyEl = $("queue-empty");
  listEl.innerHTML = "";
  show(emptyEl, false);
  try {
    const items = await send<ApplyQueueItem[]>({ type: "CLAIM_QUEUE" });
    const views = toQueueCardViews(items);
    if (views.length === 0) {
      show(emptyEl, true);
      return;
    }
    for (const v of views) {
      listEl.appendChild(queueCard(v, items.find((i) => i.id === v.id)!));
    }
  } catch (e) {
    showGlobalError(errMsg(e));
  }
}

function queueCard(view: QueueCardView, item: ApplyQueueItem): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "queue-card";
  card.innerHTML = `
    <div class="queue-meta">
      <span class="status-pill">${escapeHtml(view.boardLabel)}</span>
      ${view.matchLabel ? `<span class="match-pill">${escapeHtml(view.matchLabel)} تطبیق</span>` : ""}
    </div>
    <h3>${escapeHtml(view.title)}</h3>
    ${view.subtitle ? `<div class="queue-sub">${escapeHtml(view.subtitle)}</div>` : ""}
    <div class="cover">${escapeHtml(view.coverLetter)}</div>
    <div class="queue-actions">
      <button class="btn btn-ghost btn-sm" data-prefill>پیش‌تکمیل فرم</button>
      <button class="btn btn-approve btn-sm" data-approve disabled>تأیید و ارسال</button>
      <button class="btn btn-ghost btn-sm" data-skip>رد کردن</button>
    </div>
    <div class="fill-status" data-fill hidden></div>
  `;

  const prefillBtn = card.querySelector<HTMLButtonElement>("[data-prefill]")!;
  const approveBtn = card.querySelector<HTMLButtonElement>("[data-approve]")!;
  const skipBtn = card.querySelector<HTMLButtonElement>("[data-skip]")!;
  const fillEl = card.querySelector<HTMLElement>("[data-fill]")!;

  prefillBtn.addEventListener("click", async () => {
    prefillBtn.disabled = true;
    fillEl.hidden = false;
    fillEl.textContent = "در حال باز کردن آگهی و پیش‌تکمیل…";
    try {
      const res = await send<{ ok: boolean; filledFields: string[] }>({ type: "PREFILL", item });
      if (res.ok) {
        fillEl.textContent = `پر شد: ${res.filledFields.join("، ")} — اکنون در صفحه بررسی و تأیید کنید.`;
        fillEl.className = "fill-status ok";
        // Enabling "approve" ONLY records the outcome; the actual submit click is
        // the user's, on the board page. No background auto-submit (RULE 2).
        approveBtn.disabled = false;
      } else {
        fillEl.textContent = res.filledFields.length
          ? `پر شد: ${res.filledFields.join("، ")}`
          : "فیلدی برای پر کردن پیدا نشد. مطمئن شوید فرم اپلای باز است.";
      }
    } catch (e) {
      fillEl.textContent = errMsg(e);
    } finally {
      prefillBtn.disabled = false;
    }
  });

  approveBtn.addEventListener("click", async () => {
    // The user has reviewed the pre-filled form on the board page and clicks
    // submit THERE; this button records that approved outcome to Karjoo.
    approveBtn.disabled = true;
    try {
      await send({ type: "REPORT_RESULT", report: { id: item.id, status: "submitted" } });
      card.remove();
    } catch (e) {
      showGlobalError(errMsg(e));
      approveBtn.disabled = false;
    }
  });

  skipBtn.addEventListener("click", async () => {
    try {
      await send({ type: "REPORT_RESULT", report: { id: item.id, status: "skipped", reason: "user skipped" } });
      card.remove();
    } catch (e) {
      showGlobalError(errMsg(e));
    }
  });

  return card;
}

/* ── helpers ───────────────────────────────────────────────────────────── */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── entry (RENDER-FIRST) ──────────────────────────────────────────────────
 * Run boot() once the DOM exists (so element lookups resolve and the shell can
 * paint on the very first click of the toolbar icon). boot() is synchronous and
 * only wires DOM + kicks off guarded async work, so nothing here can hang or
 * blank the popup; a defensive try/catch turns any unexpected synchronous throw
 * into a visible error instead of an empty window.
 */
function start() {
  try {
    boot();
  } catch (e) {
    showGlobalError(errMsg(e));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  // The document already parsed (module script at end of <body>) → boot now.
  start();
}
