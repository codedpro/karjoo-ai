/**
 * Local credential store — persists the per-node credential issued ONCE at
 * enrollment, so the node re-uses it across restarts instead of re-enrolling.
 *
 * Security:
 *   • The file holds the RAW credential (the server stores only its HMAC hash).
 *     It is written with 0600 perms (owner-only) and lives under a path the
 *     operator controls (KARJOO_CREDENTIAL_PATH). It is git-ignored.
 *   • Read/write go through an injectable FS so tests never touch a real disk.
 *   • The credential is NEVER logged — call sites log `node.nodeId`/`nodeKey` only.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { NodeCredentialRecord } from "./types.js";

/** The minimal FS surface this store needs (injectable for tests). */
export interface CredentialFs {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdirp(dir: string): Promise<void>;
}

/** Default FS backed by node:fs/promises, writing the file owner-only (0600). */
export const nodeFs: CredentialFs = {
  async read(path) {
    return readFile(path, "utf8");
  },
  async write(path, data) {
    await writeFile(path, data, { encoding: "utf8", mode: 0o600 });
  },
  async mkdirp(dir) {
    await mkdir(dir, { recursive: true });
  },
};

/** A "file not found" check that works for the node FS without leaking other errors. */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

/**
 * Load the persisted credential record, or null when none exists yet (first run).
 * A malformed file is treated as "no credential" (the node re-enrolls) rather than
 * crashing — re-enrollment is safe (the server rotates the credential on upsert).
 */
export async function loadCredential(
  path: string,
  fs: CredentialFs = nodeFs,
): Promise<NodeCredentialRecord | null> {
  let raw: string;
  try {
    raw = await fs.read(path);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<NodeCredentialRecord>;
    if (
      typeof parsed.credential === "string" &&
      parsed.credential.length > 0 &&
      typeof parsed.nodeId === "string" &&
      typeof parsed.nodeKey === "string"
    ) {
      return {
        credential: parsed.credential,
        nodeId: parsed.nodeId,
        nodeKey: parsed.nodeKey,
        enrolledAt: parsed.enrolledAt ?? new Date(0).toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the credential record (owner-only file), creating the directory if needed. */
export async function saveCredential(
  path: string,
  record: NodeCredentialRecord,
  fs: CredentialFs = nodeFs,
): Promise<void> {
  const dir = dirname(path);
  if (dir && dir !== ".") {
    await fs.mkdirp(dir);
  }
  await fs.write(path, `${JSON.stringify(record, null, 2)}\n`);
}
