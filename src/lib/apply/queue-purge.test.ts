/**
 * Clearing the queue must remove only what is still waiting.
 *
 * Changing a filter only changes the NEXT discovery — jobs already queued under
 * the old filter keep going out, and until now there was no way to take them
 * back. Because the source category is not stored on a listing, per-category
 * removal is impossible, so the honest unit is "this board's pending queue".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/apply/queue-purge.ts", "utf8");

describe("purge scope", () => {
  it("deletes only pending rows, never in-flight work or history", () => {
    expect(source).toContain('eq(tasks.status, "pending")');
    for (const kept of ["succeeded", "failed", "dead"]) {
      expect(source, kept).not.toContain(`"${kept}"`);
    }
    // `leased` means a browser is mid-apply; deleting that would strand it.
    expect(source).not.toContain('eq(tasks.status, "leased")');
  });

  it("deletes tasks, not matches — applications hang off matches", () => {
    expect(source).toContain("delete(tasks)");
    expect(source).not.toContain("delete(matches)");
    expect(source).not.toContain("delete(applications)");
  });

  it("is always bound to the calling user", () => {
    // Every path filters on matches.userId; a purge must never reach another
    // user's queue even if a board id is supplied.
    expect(source).toContain("eq(matches.userId, userId)");
    const purgeBody = source.slice(source.indexOf("export async function pursePendingQueue"));
    expect(purgeBody).toContain("eq(matches.userId, userId)");
  });

  it("can scope to one board or clear everything", () => {
    expect(source).toContain("eq(jobListings.board, board)");
    expect(source).toMatch(/board\s*\?/);
  });
});
