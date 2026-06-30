/**
 * Credential-store tests — persistence round-trip with an in-memory FS.
 */
import { describe, expect, it, vi } from "vitest";

import { loadCredential, saveCredential, type CredentialFs } from "./credential-store.js";
import type { NodeCredentialRecord } from "./types.js";

function memFs(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  const mkdirp = vi.fn(async () => {});
  const write = vi.fn(async (path: string, data: string) => void (files[path] = data));
  const fs: CredentialFs = {
    files,
    mkdirp,
    write,
    async read(path) {
      if (!(path in files)) {
        const err = new Error("ENOENT") as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      return files[path]!;
    },
  } as CredentialFs & { files: Record<string, string> };
  return { fs, files, mkdirp, write };
}

const REC: NodeCredentialRecord = {
  credential: "RAW",
  nodeId: "n1",
  nodeKey: "k1",
  enrolledAt: "2026-06-30T00:00:00.000Z",
};

describe("loadCredential", () => {
  it("returns null when the file does not exist (first run)", async () => {
    const { fs } = memFs();
    expect(await loadCredential("/x.json", fs)).toBeNull();
  });

  it("returns null on a malformed file (node re-enrolls safely)", async () => {
    const { fs } = memFs({ "/x.json": "not json{" });
    expect(await loadCredential("/x.json", fs)).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const { fs } = memFs({ "/x.json": JSON.stringify({ credential: "", nodeId: "n", nodeKey: "k" }) });
    expect(await loadCredential("/x.json", fs)).toBeNull();
  });

  it("round-trips a saved credential", async () => {
    const { fs, mkdirp } = memFs();
    await saveCredential("/data/cred.json", REC, fs);
    expect(mkdirp).toHaveBeenCalledWith("/data");
    const loaded = await loadCredential("/data/cred.json", fs);
    expect(loaded).toEqual(REC);
  });
});
