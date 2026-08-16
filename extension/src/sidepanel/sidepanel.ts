import type {
  ApplyFilters,
  ExtensionRunOverview,
  Identity,
  LiveQueueJob,
  BoardCatalog,
  BoardFilter,
} from "@ext/lib/types";
import type { PopupToBackground, Result } from "@ext/lib/messages";
import type { ProbeSessionResult } from "@ext/lib/messages";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stateLabels: Record<string, string> = {
  paused: "متوقف",
  running: "در حال اجرا",
  blocked: "نیاز به اقدام",
  completed: "تکمیل شد",
};
const stageLabels: Record<string, string> = {
  starting: "آماده‌سازی",
  discovering: "کشف آگهی‌ها",
  claiming: "دریافت مورد بعدی",
  preparing_resume: "ساخت رزومه اختصاصی",
  downloading_resume: "دریافت فایل رزومه",
  opening_job: "باز کردن آگهی",
  uploading_resume: "آپلود و ارسال رزومه",
  applying: "ارسال رزومه",
  blocked: "متوقف شده",
  paused: "مکث شده",
  stopped: "متوقف",
  completed: "صف تکمیل شد",
  waiting: "پایش آگهی‌های جدید",
};

type ViewName = "live" | "filters" | "history" | "detail" | "resume";
type DetailRef = { kind: "queue"; taskId: string } | { kind: "history"; applicationId: string };

let paired = false;
let busy = false;
let activeView: ViewName = "live";
let previousView: ViewName = "live";
let overviewState: ExtensionRunOverview | null = null;
let detailRef: DetailRef | null = null;
let selectedCategories = new Set<string>();
let filtersLoaded = false;
let filtersDirty = false;
let filtersState: ApplyFilters | null = null;
let filterBoard: "jobinja" | "jobvision" = "jobinja";
const catalogs = new Map<string, BoardCatalog>();
const connectedBoards = new Set<string>();
let sessionProbeInFlight: Promise<void> | null = null;
let lastSessionProbeAt = 0;
let queueVisible = 20;
let historyVisible = 20;

async function send<T>(message: PopupToBackground): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as Result<T>;
  if (!response?.ok) throw new Error(response?.error ?? "خطای ناشناخته");
  return response.data;
}

function showError(error: unknown): void {
  const box = $("error");
  box.textContent = error instanceof Error ? error.message : String(error);
  box.classList.remove("hidden");
}

function clearError(): void { $("error").classList.add("hidden"); }
function setBusy(value: boolean): void {
  busy = value;
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = value;
  });
}

function switchView(next: ViewName): void {
  if (next === "detail" || next === "resume") previousView = activeView === "detail" ? previousView : activeView;
  activeView = next;
  for (const name of ["live", "filters", "history", "detail", "resume"] as ViewName[]) {
    $(`${name}View`).classList.toggle("hidden", name !== next);
  }
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === next);
  });
  if (next === "filters") {
    if (!filtersLoaded) void loadFilters();
    else void refreshBoardSessionStatus(true);
  }
}

async function refresh(): Promise<void> {
  try {
    const identity = await send<Identity | null>({ type: "GET_IDENTITY" });
    paired = Boolean(identity);
    $("pairing").classList.toggle("hidden", paired);
    $("workspace").classList.toggle("hidden", !paired);
    $("account").textContent = identity?.email ?? identity?.displayName ?? "متصل نشده";
    if (!paired) return;
    const overview = await send<ExtensionRunOverview | null>({ type: "GET_RUN_OVERVIEW" });
    if (overview) {
      overviewState = overview;
      render(overview);
      if (activeView === "detail") renderDetail();
    }
    clearError();
  } catch (error) {
    showError(error);
  }
}

function render(overview: ExtensionRunOverview): void {
  const { run, counts } = overview;
  $("queued").textContent = String(counts.queued);
  $("today").textContent = String(counts.appliedToday);
  $("total").textContent = String(counts.appliedTotal);
  $("review").textContent = String(counts.reviewNeeded ?? 0);
  $("queueCount").textContent = `${overview.queue.length} مورد بعدی`;
  $("updatedAt").textContent = new Date(overview.updatedAt).toLocaleTimeString("fa-IR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const pill = $("statusPill");
  pill.textContent = stateLabels[run.state] ?? run.state;
  pill.className = `status-pill ${run.state}`;
  ($("backgroundToggle") as HTMLInputElement).checked = run.backgroundEnabled;
  $("ownerLine").textContent = run.owner === "server"
    ? "صف اکنون روی سرور اجرا می‌شود. برای اجرا در مرورگر، مالکیت را منتقل کنید."
    : run.owner === "extension"
      ? "این مرورگر مالک اجرای صف است."
      : "صف در حال حاضر مالک فعال ندارد.";
  $("startBtn").classList.toggle("hidden", run.owner === "server" || (run.state === "running" && run.owner === "extension"));
  $("pauseBtn").classList.toggle("hidden", run.state !== "running" || run.owner !== "extension");
  $("stopBtn").classList.toggle("hidden", run.owner !== "extension");
  $("takeoverBtn").classList.toggle("hidden", run.owner !== "server" || run.state === "completed");

  const alert = $("alert");
  const showAlert = run.state === "blocked" || run.owner === "server";
  alert.classList.toggle("hidden", !showAlert);
  alert.textContent = run.state === "blocked"
    ? (run.blockedReason?.startsWith("resume_") || run.blockedReason?.startsWith("tailored_resume_")
      ? "رزومهٔ اختصاصی آماده یا آپلود نشد. هیچ رزومه‌ای ارسال نشده است؛ پس از رفع خطا دوباره شروع کنید."
      : "جابینجا نیاز به ورود یا بررسی امنیتی دارد. صف حفظ شده است.")
    : run.owner === "server"
      ? "اجرای فعلی در اختیار سرور است. می‌توانید همین حالا آن را به افزونه منتقل کنید."
      : "";

  const stage = typeof run.progress.stage === "string" ? run.progress.stage : run.state;
  $("stage").textContent = stageLabels[stage] ?? stage;
  $("currentJob").textContent = [run.progress.title, run.progress.company].filter(Boolean).join(" · ") ||
    (run.blockedReason ?? "هنوز کاری در حال انجام نیست.");
  document.querySelector(".pulse")?.classList.toggle("running", run.state === "running");
  ($("currentJobButton") as HTMLButtonElement).disabled = !run.currentTaskId || busy;

  renderQueue();
  renderHistory();
}

function renderQueue(): void {
  if (!overviewState) return;
  $("queueList").replaceChildren(...overviewState.queue.slice(0, queueVisible).map(queueRow));
  $("queueEmpty").classList.toggle("hidden", overviewState.queue.length > 0);
  $("queueMore").classList.toggle("hidden", overviewState.queue.length <= queueVisible);
}

function filteredHistory(): ExtensionRunOverview["recent"] {
  if (!overviewState) return [];
  const board = ($<HTMLSelectElement>("historyBoard")).value;
  const query = ($<HTMLInputElement>("historySearch")).value.trim().toLowerCase();
  return overviewState.recent.filter((item) =>
    (board === "all" || item.listing.board === board) &&
    (!query || `${item.listing.title} ${item.listing.company ?? ""}`.toLowerCase().includes(query)),
  );
}

function renderHistory(): void {
  const items = filteredHistory();
  $("recentList").replaceChildren(...items.slice(0, historyVisible).map(historyRow));
  $("recentEmpty").classList.toggle("hidden", items.length > 0);
  $("historyMore").classList.toggle("hidden", items.length <= historyVisible);
}

function queueRow(job: LiveQueueJob): HTMLLIElement {
  const li = document.createElement("li");
  const button = document.createElement("button");
  const title = document.createElement("strong");
  const subtitle = document.createElement("span");
  const state = document.createElement("small");
  title.textContent = job.listing.title;
  subtitle.textContent = [job.listing.company, job.listing.city].filter(Boolean).join(" · ");
  state.textContent = job.resumeStrategy === "native_profile_resume"
    ? "رزومه پروفایل جاب‌ویژن"
    : job.hasTailoredResume ? "PDF اختصاصی آماده" : "در انتظار PDF اختصاصی";
  state.className = job.resumeStrategy === "native_profile_resume" || job.hasTailoredResume ? "result-ok" : "result-wait";
  button.append(title, subtitle, state);
  button.addEventListener("click", () => openDetail({ kind: "queue", taskId: job.taskId }));
  li.append(button);
  return li;
}

function historyRow(item: ExtensionRunOverview["recent"][number]): HTMLLIElement {
  const li = document.createElement("li");
  const button = document.createElement("button");
  const title = document.createElement("strong");
  const subtitle = document.createElement("span");
  const actions = document.createElement("small");
  const label = item.status === "submitted" ? "ارسال شد" : item.status === "failed" ? "ناموفق" : item.status === "skipped" ? "رد شد" : item.status;
  title.textContent = item.listing.title;
  subtitle.textContent = `${label} · ${new Date(item.happenedAt).toLocaleString("fa-IR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  subtitle.className = item.status === "submitted" ? "result-ok" : item.status === "failed" ? "result-fail" : "";
  actions.textContent = [
    item.resumeStrategy === "native_profile_resume" ? "رزومه پروفایل" : item.hasResume ? "PDF ارسال‌شده" : null,
    item.retryEligible ? "تلاش دوباره" : null,
  ].filter(Boolean).join(" · ");
  button.append(title, subtitle, actions);
  button.addEventListener("click", () => openDetail({ kind: "history", applicationId: item.applicationId }));
  li.append(button);
  return li;
}

function openDetail(ref: DetailRef): void {
  detailRef = ref;
  renderDetail();
  switchView("detail");
}

function renderDetail(): void {
  if (!overviewState || !detailRef) return;
  const ref = detailRef;
  const queueItem = ref.kind === "queue"
    ? [...overviewState.applying, ...overviewState.queue].find((item) => item.taskId === ref.taskId)
    : null;
  const historyItem = ref.kind === "history"
    ? overviewState.recent.find((item) => item.applicationId === ref.applicationId)
    : null;
  const item = queueItem ?? historyItem;
  if (!item) return;
  const listing = item.listing;
  $("detailTitle").textContent = listing.title;
  $("detailCompany").textContent = [listing.company, listing.city].filter(Boolean).join(" · ");
  $("detailStatus").textContent = queueItem ? (queueItem.status === "leased" ? "در حال اجرا" : "در صف") : (historyItem?.status ?? "");
  $("detailDescription").textContent = listing.description?.trim() || "شرح کامل آگهی ذخیره نشده است.";
  $("detailMeta").replaceChildren(
    meta("سایت", listing.board),
    meta("روش رزومه", item.resumeStrategy === "native_profile_resume" ? "رزومه پروفایل سایت" : "PDF اختصاصی این آگهی"),
    meta("تاریخ انتشار", listing.postedAt ? new Date(listing.postedAt).toLocaleDateString("fa-IR") : "نامشخص"),
    ...(queueItem ? [meta("تلاش‌ها", String(queueItem.attempts ?? 0)), meta("آخرین خطا", queueItem.lastError ?? "ندارد")] : []),
    ...(historyItem ? [meta("کانال", historyItem.channel ?? "نامشخص"), meta("دلیل", historyItem.reason ?? "ندارد")] : []),
  );
  ($("openJobBtn") as HTMLButtonElement).dataset.url = listing.url;
  $("viewResumeBtn").classList.toggle("hidden", !historyItem?.hasResume);
  ($("viewResumeBtn") as HTMLButtonElement).dataset.applicationId = historyItem?.applicationId ?? "";
  $("retryBtn").classList.toggle("hidden", !historyItem?.retryEligible);
  ($("retryBtn") as HTMLButtonElement).dataset.applicationId = historyItem?.applicationId ?? "";
}

function meta(label: string, value: string): HTMLDivElement {
  const div = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  div.append(dt, dd);
  return div;
}

async function action(actionName: "start" | "takeover" | "pause" | "stop"): Promise<void> {
  if (busy) return;
  setBusy(true);
  clearError();
  try {
    await send({
      type: "MUTATE_RUN",
      action: actionName,
      backgroundEnabled: ($("backgroundToggle") as HTMLInputElement).checked,
    });
    await refresh();
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}

async function loadFilters(force = false): Promise<void> {
  if (filtersDirty && !force) return;
  try {
    const [response, jobinjaCatalog, jobvisionCatalog] = await Promise.all([
      send<{ filters: ApplyFilters; previewUrl: string }>({ type: "GET_APPLY_FILTERS" }),
      send<BoardCatalog>({ type: "GET_BOARD_CATALOG", board: "jobinja" }),
      send<BoardCatalog>({ type: "GET_BOARD_CATALOG", board: "jobvision" }),
    ]);
    catalogs.set("jobinja", jobinjaCatalog);
    catalogs.set("jobvision", jobvisionCatalog);
    filtersState = response.filters;
    fillFilters(response.filters);
    filtersLoaded = true;
    void refreshBoardSessionStatus(true);
    clearError();
  } catch (error) { showError(error); }
}

function fillFilters(filters: ApplyFilters): void {
  const board = filters.boardFilters[filterBoard];
  selectedCategories = new Set(board.categoryKeys);
  ($<HTMLInputElement>("boardEnabledInput")).checked = board.enabled;
  ($<HTMLInputElement>("citiesInput")).value = board.cities.join("، ");
  ($<HTMLInputElement>("fulltimeInput")).checked = board.employmentTypeKeys.includes(filterBoard === "jobinja" ? "is_fulltime" : "full-time");
  ($<HTMLInputElement>("parttimeInput")).checked = board.employmentTypeKeys.includes(filterBoard === "jobinja" ? "is_parttime" : "part-time");
  ($<HTMLInputElement>("projectInput")).checked = board.employmentTypeKeys.includes("project-based");
  ($<HTMLInputElement>("remoteInput")).checked = board.remoteOnly;
  ($<HTMLInputElement>("salaryInput")).value = board.minSalary ? String(board.minSalary) : "";
  ($<HTMLSelectElement>("sortInput")).value = board.sort ?? "published_at_desc";
  ($("dailyInput") as HTMLInputElement).value = filters.dailyLimit ? String(filters.dailyLimit) : "";
  ($("weeklyInput") as HTMLInputElement).value = filters.weeklyLimit ? String(filters.weeklyLimit) : "";
  ($("discoveryPausedInput") as HTMLInputElement).checked = filters.paused;
  ($<HTMLInputElement>("maxAgeInput")).value = String(filters.maxAgeDays);
  $("projectLabel").classList.toggle("hidden", filterBoard === "jobinja");
  $("sortField").classList.toggle("hidden", filterBoard === "jobvision");
  document.querySelectorAll<HTMLButtonElement>(".board-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.board === filterBoard);
  });
  renderCategories();
}

function missingSessionLabel(status: ProbeSessionResult): string {
  if (status.reason === "no_tab") return "صفحهٔ سایت در مرورگر باز نیست";
  if (status.reason === "probe_unavailable") return "بررسی صفحه ممکن نشد؛ صفحه را بازخوانی کنید";
  return "ورود معتبر تشخیص داده نشد";
}

async function detectAndConnectBoard(board: "jobinja" | "jobvision", openSiteOnMissing: boolean): Promise<void> {
  $("boardSessionStatus").textContent = "در حال بررسی ورود…";
  const status = await send<ProbeSessionResult>({ type: "DETECT_BOARD", board });
  if (board !== filterBoard) return;
  if (!status.loggedIn) {
    $("boardSessionStatus").textContent = missingSessionLabel(status);
    connectedBoards.delete(board);
    if (openSiteOnMissing) {
      const url = board === "jobvision" ? "https://jobvision.ir/jobs" : "https://jobinja.ir/jobs";
      await chrome.tabs.create({ url, active: true });
    }
    return;
  }
  if (!connectedBoards.has(board)) {
    await send({ type: "CONNECT_BOARD", board, accountLabel: status.accountLabelHint });
    connectedBoards.add(board);
  }
  if (board === filterBoard) $("boardSessionStatus").textContent = "وارد شده، متصل و آماده";
}

async function refreshBoardSessionStatus(force = false, openSiteOnMissing = false): Promise<void> {
  if (!paired || activeView !== "filters") return;
  const now = Date.now();
  if (!force && (sessionProbeInFlight || now - lastSessionProbeAt < 5_000)) return;
  lastSessionProbeAt = now;
  const probe = detectAndConnectBoard(filterBoard, openSiteOnMissing)
    .catch(showError)
    .finally(() => { sessionProbeInFlight = null; });
  sessionProbeInFlight = probe;
  await probe;
}

function renderCategories(): void {
  const query = ($("categorySearch") as HTMLInputElement).value.trim().toLowerCase();
  const visible = (catalogs.get(filterBoard)?.categories ?? []).filter((category) =>
    !query || `${category.label} ${category.englishLabel}`.toLowerCase().includes(query),
  );
  $("categoryCount").textContent = `${selectedCategories.size} انتخاب`;
  $("categoryOptions").replaceChildren(...visible.map((category) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const span = document.createElement("span");
    input.type = "checkbox";
    input.checked = selectedCategories.has(category.key);
    input.addEventListener("change", () => {
      if (input.checked) selectedCategories.add(category.key);
      else selectedCategories.delete(category.key);
      filtersDirty = true;
      $("categoryCount").textContent = `${selectedCategories.size} انتخاب`;
    });
    span.textContent = category.englishLabel ? `${category.label} · ${category.englishLabel}` : category.label;
    label.append(input, span);
    return label;
  }));
}

function optionalPositive(id: string): number | undefined {
  const value = Number(($<HTMLInputElement>(id)).value);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function collectBoardFilter(): BoardFilter {
  const jobTypes: string[] = [];
  if (($<HTMLInputElement>("fulltimeInput")).checked) jobTypes.push(filterBoard === "jobinja" ? "is_fulltime" : "full-time");
  if (($<HTMLInputElement>("parttimeInput")).checked) jobTypes.push(filterBoard === "jobinja" ? "is_parttime" : "part-time");
  if (filterBoard === "jobvision" && ($<HTMLInputElement>("projectInput")).checked) jobTypes.push("project-based");
  const cities = ($("citiesInput") as HTMLInputElement).value
    .split(/[,،]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    enabled: ($<HTMLInputElement>("boardEnabledInput")).checked,
    categoryKeys: [...selectedCategories],
    cities,
    employmentTypeKeys: jobTypes,
    remoteOnly: ($("remoteInput") as HTMLInputElement).checked,
    ...(optionalPositive("salaryInput") ? { minSalary: optionalPositive("salaryInput") } : {}),
    ...(filterBoard === "jobinja" ? { sort: ($<HTMLSelectElement>("sortInput")).value } : {}),
  };
}

function saveActiveBoardDraft(): void {
  if (!filtersState) return;
  filtersState = {
    ...filtersState,
    boardFilters: { ...filtersState.boardFilters, [filterBoard]: collectBoardFilter() },
  };
}

function collectFilters(): Omit<ApplyFilters, "aiFilterEnabled"> {
  if (!filtersState) throw new Error("فیلترها هنوز بارگذاری نشده‌اند.");
  saveActiveBoardDraft();
  const jobinja = filtersState.boardFilters.jobinja;
  return {
    categorySlugs: jobinja.categoryKeys,
    cities: jobinja.cities,
    jobTypes: jobinja.employmentTypeKeys,
    remoteOnly: jobinja.remoteOnly,
    ...(jobinja.minSalary ? { minSalary: jobinja.minSalary } : {}),
    ...(jobinja.sort ? { sort: jobinja.sort as ApplyFilters["sort"] } : {}),
    paused: ($("discoveryPausedInput") as HTMLInputElement).checked,
    ...(optionalPositive("dailyInput") ? { dailyLimit: optionalPositive("dailyInput") } : {}),
    ...(optionalPositive("weeklyInput") ? { weeklyLimit: optionalPositive("weeklyInput") } : {}),
    maxAgeDays: Math.min(45, optionalPositive("maxAgeInput") ?? 45),
    boardFiltersVersion: 1,
    boardFilters: filtersState.boardFilters,
  };
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.tab as ViewName));
});
document.querySelectorAll<HTMLButtonElement>(".board-tab").forEach((button) => {
  button.addEventListener("click", () => {
    if (!filtersState) return;
    saveActiveBoardDraft();
    filterBoard = button.dataset.board as "jobinja" | "jobvision";
    fillFilters(filtersState);
    filtersDirty = true;
    void refreshBoardSessionStatus(true);
  });
});
$("pairForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setBusy(true);
  try { await send({ type: "PAIR", code: ($("pairCode") as HTMLInputElement).value.trim() }); await refresh(); }
  catch (error) { showError(error); } finally { setBusy(false); }
});
$("startBtn").addEventListener("click", () => void action("start"));
$("takeoverBtn").addEventListener("click", () => void action("takeover"));
$("pauseBtn").addEventListener("click", () => void action("pause"));
$("stopBtn").addEventListener("click", () => void action("stop"));
$("backgroundToggle").addEventListener("change", async () => {
  try { await send({ type: "SET_RUN_BACKGROUND", enabled: ($("backgroundToggle") as HTMLInputElement).checked }); }
  catch (error) { showError(error); }
});
$("currentJobButton").addEventListener("click", () => {
  const taskId = overviewState?.run.currentTaskId;
  if (taskId) openDetail({ kind: "queue", taskId });
});
$("detailBack").addEventListener("click", () => switchView(previousView));
$("resumeBack").addEventListener("click", () => switchView("detail"));
$("openJobBtn").addEventListener("click", () => {
  const url = ($("openJobBtn") as HTMLButtonElement).dataset.url;
  if (url) void chrome.tabs.create({ url, active: true });
});
$("viewResumeBtn").addEventListener("click", async () => {
  const applicationId = ($("viewResumeBtn") as HTMLButtonElement).dataset.applicationId;
  if (!applicationId) return;
  setBusy(true);
  try {
    const html = await send<string>({ type: "GET_APPLICATION_RESUME", applicationId });
    ($("resumeFrame") as HTMLIFrameElement).srcdoc = html;
    switchView("resume");
  } catch (error) { showError(error); } finally { setBusy(false); }
});
$("retryBtn").addEventListener("click", async () => {
  const applicationId = ($("retryBtn") as HTMLButtonElement).dataset.applicationId;
  if (!applicationId) return;
  setBusy(true);
  try {
    await send({ type: "RETRY_APPLICATION", applicationId });
    switchView("live");
    await refresh();
  } catch (error) { showError(error); } finally { setBusy(false); }
});
$("categorySearch").addEventListener("input", renderCategories);
$("connectBoardBtn").addEventListener("click", async () => {
  setBusy(true);
  try { await refreshBoardSessionStatus(true, true); } catch (error) { showError(error); } finally { setBusy(false); }
});
$("queueMore").addEventListener("click", () => { queueVisible += 20; renderQueue(); });
$("historyMore").addEventListener("click", () => { historyVisible += 20; renderHistory(); });
$("historySearch").addEventListener("input", () => { historyVisible = 20; renderHistory(); });
$("historyBoard").addEventListener("change", () => { historyVisible = 20; renderHistory(); });
$("filtersForm").addEventListener("input", () => { filtersDirty = true; });
$("filtersForm").addEventListener("change", () => { filtersDirty = true; });
$("filtersForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setBusy(true);
  try {
    const response = await send<{ filters: ApplyFilters; previewUrl: string }>({
      type: "SAVE_APPLY_FILTERS", filters: collectFilters(),
    });
    filtersState = response.filters;
    fillFilters(response.filters);
    filtersDirty = false;
    renderCategories();
    $("filterSaved").textContent = "ذخیره شد";
    setTimeout(() => { $("filterSaved").textContent = ""; }, 2500);
  } catch (error) { showError(error); } finally { setBusy(false); }
});

void refresh();
setInterval(() => {
  if (paired && !busy) {
    void refresh();
    if (activeView === "filters" && !filtersDirty) void loadFilters();
    if (activeView === "filters") void refreshBoardSessionStatus();
  }
}, 2_000);
window.addEventListener("pagehide", () => {
  if (paired && !( $("backgroundToggle") as HTMLInputElement).checked) {
    void chrome.runtime.sendMessage({ type: "MUTATE_RUN", action: "pause" });
  }
});
