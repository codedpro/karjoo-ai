/**
 * Enrollment bootstrap — ensure this node has a credential.
 *
 * On first run there is no persisted credential, so the node enrolls with the
 * one-time KARJOO_FLEET_ENROLLMENT_TOKEN, receives the credential ONCE, and
 * persists it (0600). On every subsequent run the persisted credential is loaded
 * and the token is not needed.
 *
 * Security:
 *   • The credential is never logged — only `nodeKey`/`nodeId` are.
 *   • If there is no credential AND no token, this is fatal (we cannot authenticate).
 *   • The server rotates the credential on re-enroll, so re-enrolling after a lost
 *     credential file is safe.
 */
import type { KarjooFleetApi } from "./api-client.js";
import type { WorkerConfig } from "./config.js";
import { loadCredential, saveCredential, type CredentialFs, nodeFs } from "./credential-store.js";
import { Logger, logger as defaultLogger } from "./logger.js";
import type { NodeCredentialRecord } from "./types.js";

/** Raised when the node cannot obtain a credential (no persisted one and no token). */
export class EnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrollmentError";
  }
}

export interface EnsureCredentialDeps {
  fs?: CredentialFs;
  logger?: Logger;
  nowIso?: () => string;
}

/**
 * Ensure the node has a usable credential: load the persisted one, or enroll once
 * and persist it. Sets the credential on the api client and returns the record.
 */
export async function ensureCredential(
  api: KarjooFleetApi,
  cfg: WorkerConfig,
  deps: EnsureCredentialDeps = {},
): Promise<NodeCredentialRecord> {
  const fs = deps.fs ?? nodeFs;
  const log = deps.logger ?? defaultLogger;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  // 1) Reuse a persisted credential when present and matching this node key.
  const existing = await loadCredential(cfg.credentialPath, fs);
  if (existing && existing.nodeKey === cfg.nodeKey) {
    api.setCredential(existing.credential);
    log.info("loaded persisted node credential", {
      nodeKey: existing.nodeKey,
      nodeId: existing.nodeId,
      enrolledAt: existing.enrolledAt,
    });
    return existing;
  }
  if (existing && existing.nodeKey !== cfg.nodeKey) {
    log.warn("persisted credential is for a different node key; re-enrolling", {
      persistedKey: existing.nodeKey,
      configuredKey: cfg.nodeKey,
    });
  }

  // 2) No usable credential → must enroll, which requires the one-time token.
  if (!cfg.enrollmentToken) {
    throw new EnrollmentError(
      "No persisted credential and KARJOO_FLEET_ENROLLMENT_TOKEN is unset — cannot enroll.",
    );
  }

  log.info("enrolling node", { nodeKey: cfg.nodeKey, region: cfg.region });
  const { credential, nodeId } = await api.enroll({
    enrollmentToken: cfg.enrollmentToken,
    nodeKey: cfg.nodeKey,
    region: cfg.region,
    agentVersion: cfg.agentVersion,
  });

  const record: NodeCredentialRecord = {
    credential,
    nodeId,
    nodeKey: cfg.nodeKey,
    enrolledAt: nowIso(),
  };
  await saveCredential(cfg.credentialPath, record, fs);
  api.setCredential(credential);
  log.info("node enrolled; credential persisted", { nodeKey: cfg.nodeKey, nodeId });
  return record;
}
