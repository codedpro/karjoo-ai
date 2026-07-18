/**
 * Jobinja cvId capture — MAIN-world content script.
 *
 * WHY main-world: the cvId (e.g. "L1VB") is a client-side hashid Jobinja's CV-builder SPA
 * computes in JS — it is never in the server-rendered HTML, so the server can't derive it.
 * This hook observes the URLs the page's OWN JS calls (…/cv-builder/{cvId}/{section}) and
 * lifts just the id — no cookies, no tokens, no profile data (§10). It hands the id to the
 * isolated content script via window.postMessage; that script forwards it to the SW, which
 * stores it (POST /api/boards/jobinja/push) so server-side profile writes can address the CV.
 */

const SECTIONS = new Set([
  "basic-data",
  "cv-file",
  "personal",
  "about",
  "skills",
  "experience",
  "education",
]);

/** cvId را از یک URLِ cv-builder می‌کشد (اولین قطعه پس از cv-builder/؛ نه نامِ بخش). */
export function extractCvId(url: string): string | null {
  const m = /\/api\/v10\/jobseeker-app\/cv-builder\/([A-Za-z0-9]{2,8})(?:\/|$|\?)/.exec(url);
  const id = m?.[1];
  return id && !SECTIONS.has(id) ? id : null;
}

/** پیامِ بردنِ cvId به دنیای isolated (نامِ کلید عمداً یکتا برای امنیت). */
export const CVID_MESSAGE = "karjoo:jobinja-cvid" as const;

function report(url: string): void {
  try {
    const cvId = extractCvId(url);
    if (cvId) window.postMessage({ source: CVID_MESSAGE, cvId }, window.location.origin);
  } catch {
    /* never throw into the page */
  }
}

// این ماژول در دنیای MAINِ صفحه اجرا می‌شود — به‌جز install، بدونِ عوارضِ جانبی.
function install(): void {
  const g = window as unknown as { __karjooCvidHooked?: boolean };
  if (g.__karjooCvidHooked) return;
  g.__karjooCvidHooked = true;

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      try {
        report(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      } catch {
        /* ignore */
      }
      return origFetch.call(this as typeof globalThis, input, init);
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    try {
      report(typeof url === "string" ? url : url.href);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origOpen as any).call(this, method, url, ...rest);
  };
}

// در محیطِ مرورگر نصب کن (در تست import می‌شود بدونِ اجرا شدن روی window واقعی).
if (typeof window !== "undefined" && typeof XMLHttpRequest !== "undefined") {
  install();
}
