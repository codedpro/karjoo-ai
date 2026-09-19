/**
 * HTTP apply — the boards whose application is a plain HTTP transaction.
 *
 * Karboom is a server-driven wizard, e-estekhdam is a JSON API and IranTalent is
 * a JSON API. None of them has a form to drive, so none of them needs Playwright:
 * the whole application is a handful of authenticated requests carrying the
 * user's own session.
 *
 * WHY THEY RUN HERE AND NOT ON THE CONTROL PLANE: they used to run on the control
 * plane, which is exactly where they could never work — those boards sit behind
 * ArvanCloud, which accepts a TCP connection from a non-Iranian address and then
 * never answers the TLS handshake. The node is the thing with an Iranian IP, so
 * the node is where every board request belongs, browser or not. Moving them here
 * also means the adapters exist in ONE place rather than being copied into two
 * packages.
 *
 * Only two things differ from the browser path:
 *   • no browser is launched at all, unless the board uploads a per-ad résumé and
 *     one has to be rendered (that is the only thing Chromium is still needed for);
 *   • the outcome comes from the board's own JSON/redirect answers instead of
 *     from the DOM.
 *
 * §10 is unchanged: the user's own session, replayed faithfully, against the
 * board's own endpoints. A captcha or a security check is a STOP with a clear
 * reason, never something to work around.
 */
import { applyToEEstekhdam } from "./boards/eestekhdam-apply.js";
import { applyToIranTalent } from "./boards/irantalent-apply.js";
import { applyToKarboom } from "./boards/karboom-apply.js";
import type { FleetJob } from "./types.js";

/** The shape every HTTP adapter returns (identical across the three boards). */
export interface HttpApplyOutcome {
  status: "submitted" | "skipped" | "failed";
  reason?: string;
  ranSteps: string[];
  proof?: Record<string, unknown>;
}

/** A rendered per-ad résumé, when the board uploads one. */
export interface RenderedResume {
  pdf: Uint8Array;
  fileName: string;
}

interface HttpBoard {
  /**
   * Does this board upload the per-ad PDF? `false` means it sends the résumé
   * already on the user's provider profile (IranTalent), so no Chromium is
   * needed for the job at all.
   */
  needsTailoredResume: boolean;
  run(job: FleetJob, resume: RenderedResume | null): Promise<HttpApplyOutcome>;
}

/**
 * The boards that apply over plain HTTP. Adding one = one entry here.
 *
 * The control plane's apply-channels table decides which boards are DISPATCHED
 * as http jobs; this map decides how each one is executed. A board that reaches
 * the node without an entry here is reported as skipped rather than guessed at.
 */
const HTTP_BOARDS: Record<string, HttpBoard> = {
  karboom: {
    needsTailoredResume: true,
    run: (job, resume) =>
      applyToKarboom({
        session: job.session,
        jobUrl: job.listingUrl,
        resumePdf: resume!.pdf,
        resumeFileName: resume!.fileName,
        ...(job.coverLetter ? { coverLetter: job.coverLetter } : {}),
      }),
  },
  "e-estekhdam": {
    needsTailoredResume: true,
    run: (job, resume) =>
      applyToEEstekhdam({
        session: job.session,
        jobUrl: job.listingUrl,
        jobTitle: job.listingTitle ?? "",
        resumePdf: resume!.pdf,
        resumeFileName: resume!.fileName,
        ...(job.coverLetter ? { coverLetter: job.coverLetter } : {}),
      }),
  },
  irantalent: {
    needsTailoredResume: false,
    run: (job) =>
      applyToIranTalent({
        session: job.session,
        jobUrl: job.listingUrl,
        ...(job.coverLetter ? { coverLetter: job.coverLetter } : {}),
      }),
  },
};

/** Does this board apply over HTTP (no browser) rather than through the DOM? */
export function isHttpApplyBoard(board: string): boolean {
  return board in HTTP_BOARDS;
}

/** Does this board need a rendered per-ad résumé before it can apply? */
export function httpBoardNeedsResume(board: string): boolean {
  return HTTP_BOARDS[board]?.needsTailoredResume ?? false;
}

/**
 * Run the HTTP application for one job. Never throws — a thrown adapter becomes a
 * reported failure so the caller always has something to send back.
 */
export async function runHttpApply(
  job: FleetJob,
  resume: RenderedResume | null,
): Promise<HttpApplyOutcome> {
  const board = HTTP_BOARDS[job.board];
  if (!board) {
    return { status: "skipped", reason: `board '${job.board}' has no http adapter`, ranSteps: [] };
  }
  if (board.needsTailoredResume && !resume) {
    // We do NOT fall back to another résumé: the employer is supposed to receive
    // the one written for this specific ad, and sending a different file while
    // calling it an application misrepresents what they got.
    return { status: "skipped", reason: "tailored_resume_missing", ranSteps: [] };
  }
  try {
    return await board.run(job, resume);
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
      ranSteps: [],
    };
  }
}
