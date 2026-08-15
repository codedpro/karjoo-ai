import type { ExtensionRunOverview, Identity } from "@ext/lib/types";
import type { PopupToBackground, Result } from "@ext/lib/messages";

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
  applying: "ارسال رزومه",
  blocked: "متوقف شده",
  paused: "مکث شده",
  stopped: "متوقف",
  completed: "صف تکمیل شد",
  waiting: "پایش آگهی‌های جدید",
};

let paired = false;
let busy = false;

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
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = value; });
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
    if (overview) render(overview);
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
  $("queueCount").textContent = `${overview.queue.length} مورد بعدی`;
  $("updatedAt").textContent = new Date(overview.updatedAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const pill = $("statusPill");
  pill.textContent = stateLabels[run.state] ?? run.state;
  pill.className = `status-pill ${run.state}`;
  $("backgroundToggle").toggleAttribute("checked", run.backgroundEnabled);
  ($("backgroundToggle") as HTMLInputElement).checked = run.backgroundEnabled;
  $("startBtn").classList.toggle("hidden", run.owner === "server" || (run.state === "running" && run.owner === "extension"));
  $("pauseBtn").classList.toggle("hidden", run.state !== "running" || run.owner !== "extension");
  $("stopBtn").classList.toggle("hidden", run.owner !== "extension");
  $("takeoverBtn").classList.toggle("hidden", !(run.owner === "server" && run.state === "blocked"));

  const alert = $("alert");
  const isBlocked = run.state === "blocked";
  alert.classList.toggle("hidden", !isBlocked);
  alert.textContent = isBlocked
    ? (run.owner === "server"
      ? "جابینجا دسترسی سرور را متوقف کرده است. صف حفظ شده؛ با افزونه ادامه دهید."
      : "صفحهٔ جابینجا نیاز به ورود یا تایید امنیتی دارد. آن را تکمیل و دوباره شروع کنید.")
    : "";

  const stage = typeof run.progress.stage === "string" ? run.progress.stage : run.state;
  $("stage").textContent = stageLabels[stage] ?? stage;
  $("currentJob").textContent = [run.progress.title, run.progress.company].filter(Boolean).join(" · ") ||
    (run.blockedReason ?? "هنوز کاری در حال انجام نیست.");
  document.querySelector(".pulse")?.classList.toggle("running", run.state === "running");

  const queue = $("queueList");
  queue.replaceChildren(...overview.queue.slice(0, 8).map((job) => row(job.listing.title, [job.listing.company, job.listing.city].filter(Boolean).join(" · "))));
  $("queueEmpty").classList.toggle("hidden", overview.queue.length > 0);

  const recent = $("recentList");
  recent.replaceChildren(...overview.recent.slice(0, 8).map((item) => {
    const label = item.status === "submitted" ? "ارسال شد" : item.status === "failed" ? "ناموفق" : item.status;
    return row(item.listing.title, `${label} · ${new Date(item.happenedAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`, item.status === "submitted" ? "result-ok" : item.status === "failed" ? "result-fail" : "");
  }));
  $("recentEmpty").classList.toggle("hidden", overview.recent.length > 0);
}

function row(title: string, subtitle: string, className = ""): HTMLLIElement {
  const li = document.createElement("li");
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = title;
  span.textContent = subtitle;
  if (className) span.className = className;
  li.append(strong, span);
  return li;
}

async function action(action: "start" | "takeover" | "pause" | "stop"): Promise<void> {
  if (busy) return;
  setBusy(true);
  clearError();
  try {
    await send({
      type: "MUTATE_RUN",
      action,
      backgroundEnabled: ($("backgroundToggle") as HTMLInputElement).checked,
    });
    await refresh();
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}

$("pairForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  try {
    await send({ type: "PAIR", code: ($("pairCode") as HTMLInputElement).value.trim() });
    await refresh();
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});
$("startBtn").addEventListener("click", () => void action("start"));
$("takeoverBtn").addEventListener("click", () => void action("takeover"));
$("pauseBtn").addEventListener("click", () => void action("pause"));
$("stopBtn").addEventListener("click", () => void action("stop"));
$("backgroundToggle").addEventListener("change", async () => {
  try { await send({ type: "SET_RUN_BACKGROUND", enabled: ($("backgroundToggle") as HTMLInputElement).checked }); }
  catch (error) { showError(error); }
});

void refresh();
setInterval(() => { if (paired && !busy) void refresh(); }, 2_000);
window.addEventListener("pagehide", () => {
  if (paired && !( $("backgroundToggle") as HTMLInputElement).checked) {
    void chrome.runtime.sendMessage({ type: "MUTATE_RUN", action: "pause" });
  }
});
