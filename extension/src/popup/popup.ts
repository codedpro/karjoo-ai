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
const show = (el: HTMLElement, on = true) => (el.hidden = !on);
const setText = (el: HTMLElement, text: string) => (el.textContent = text);

function showGlobalError(message: string) {
  const el = $("global-error");
  setText(el, message);
  show(el, true);
}
function clearGlobalError() {
  show($("global-error"), false);
}

/* ── boot ──────────────────────────────────────────────────────────────── */
async function boot() {
  // Prefill API origin field for the advanced section.
  ($("api-origin") as HTMLInputElement).value = await getApiOrigin();

  if (await isPaired()) {
    await enterMain();
  } else {
    show($("view-pair"), true);
  }
  wirePairing();
  wireSignOut();
}

/* ── pairing view ──────────────────────────────────────────────────────── */
function wirePairing() {
  $("save-origin").addEventListener("click", async () => {
    const origin = ($("api-origin") as HTMLInputElement).value;
    try {
      await send({ type: "SET_API_ORIGIN", origin });
      clearGlobalError();
    } catch (e) {
      showGlobalError(errMsg(e));
    }
  });

  $("pair-submit").addEventListener("click", async () => {
    const errEl = $("pair-error");
    show(errEl, false);
    const raw = ($("pair-code") as HTMLInputElement).value;
    const code = normalizePairingCode(raw);
    if (!isValidPairingCodeShape(code)) {
      setText(errEl, "کد اتصال نامعتبر است. دوباره از داشبورد کپی کنید.");
      show(errEl, true);
      return;
    }
    const btn = $("pair-submit") as HTMLButtonElement;
    btn.disabled = true;
    try {
      // First persist any edited origin so /link hits the right server.
      const origin = ($("api-origin") as HTMLInputElement).value;
      if (origin) await send({ type: "SET_API_ORIGIN", origin });
      await send<Identity | null>({ type: "PAIR", code });
      show($("view-pair"), false);
      await enterMain();
    } catch (e) {
      setText(errEl, errMsg(e));
      show(errEl, true);
    } finally {
      btn.disabled = false;
    }
  });
}

function wireSignOut() {
  const btn = $("signout");
  btn.addEventListener("click", async () => {
    await send({ type: "SIGN_OUT" });
    location.reload();
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
      <button class="btn btn-primary btn-sm" data-connect disabled>اتصال</button>
    </div>
  `;
  const statusEl = li.querySelector<HTMLElement>("[data-status]")!;
  const connectBtn = li.querySelector<HTMLButtonElement>("[data-connect]")!;
  const detectBtn = li.querySelector<HTMLButtonElement>("[data-detect]")!;
  const labelInput = li.querySelector<HTMLInputElement>("[data-label]")!;

  const detect = async () => {
    setStatus(statusEl, "در حال بررسی…", "");
    try {
      const res = await send<ProbeSessionResult>({ type: "DETECT_BOARD", board });
      if (res.loggedIn) {
        setStatus(statusEl, "وارد شده در مرورگر شما", "ok");
        connectBtn.disabled = false;
      } else {
        setStatus(statusEl, "وارد نشده‌اید", "warn");
        connectBtn.disabled = true;
      }
    } catch (e) {
      setStatus(statusEl, "خطا در بررسی", "warn");
      showGlobalError(errMsg(e));
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

void boot().catch((e) => showGlobalError(errMsg(e)));
