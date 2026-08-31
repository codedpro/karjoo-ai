import "server-only";

/**
 * انبارِ اعتبارنامه‌ی سایت کاریابی (server-only) — رویِ جدولِ board_credentials.
 *
 * مثلِ انبارِ نشست، همیشه **مقید به همان کاربر** است: هرگز با boardAccountId خام کار
 * نمی‌کند، بلکه (userId, board) می‌گیرد و حساب را تحتِ همان کاربر resolve می‌کند.
 * این لایه plaintext نمی‌بیند مگر در readCredential، که رمزگشایی را با scopeِ همان
 * کاربر انجام می‌دهد — پس ردیفِ کاربرِ دیگر حتی با دسترسیِ مستقیم به DB باز نمی‌شود.
 */
import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { boardAccounts, boardCredentials, type BoardCredentialRow } from "@/db/schema";
import {
  decryptCredential,
  encryptCredential,
  maskUsername,
  parseCredential,
  serializeCredential,
  type BoardCredential,
} from "@/lib/vault/credential-crypto";
import { BoardAccountNotFoundError, findBoardAccountId, type Board, type VaultStoreDb } from "@/lib/vault/store";

/** بعد از این تعداد شکستِ پیاپی، ورودِ خودکار تا مداخله‌ی کاربر قفل می‌شود. */
export const CREDENTIAL_FAILURE_LIMIT = 3;
/** مدتِ قفل پس از رسیدن به سقفِ شکست. */
const LOCKOUT_MS = 6 * 60 * 60 * 1000;

/** وضعیتِ اعتبارنامه برای نمایش — هرگز شاملِ رمز نیست. */
export interface CredentialStatus {
  board: Board;
  usernameHint: string;
  lastLoginAt: string | null;
  lastLoginStatus: string | null;
  failureCount: number;
  lockedUntil: string | null;
  locked: boolean;
}

function statusOf(board: Board, row: BoardCredentialRow): CredentialStatus {
  const lockedUntil = row.lockedUntil;
  return {
    board,
    usernameHint: row.usernameHint,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastLoginStatus: row.lastLoginStatus,
    failureCount: row.failureCount,
    lockedUntil: lockedUntil?.toISOString() ?? null,
    locked: Boolean(lockedUntil && lockedUntil.getTime() > Date.now()),
  };
}

/**
 * اعتبارنامه را رمز و ذخیره می‌کند (یک رکورد به‌ازای هر حساب).
 * ذخیره‌ی تازه شمارنده‌ی شکست و قفل را صفر می‌کند.
 */
export async function upsertCredential(
  userId: string,
  board: Board,
  credential: BoardCredential,
  conn: VaultStoreDb = defaultDb,
): Promise<CredentialStatus> {
  const boardAccountId = await findBoardAccountId(userId, board, conn);
  if (!boardAccountId) throw new BoardAccountNotFoundError(board);

  const encrypted = encryptCredential(serializeCredential(credential), { userId, board });
  const now = new Date();
  const [row] = await conn
    .insert(boardCredentials)
    .values({
      boardAccountId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
      keyVersion: encrypted.keyVersion,
      usernameHint: maskUsername(credential.username),
      failureCount: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: boardCredentials.boardAccountId,
      set: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        salt: encrypted.salt,
        keyVersion: encrypted.keyVersion,
        usernameHint: maskUsername(credential.username),
        failureCount: 0,
        lockedUntil: null,
        updatedAt: now,
      },
    })
    .returning();
  return statusOf(board, row!);
}

/**
 * اعتبارنامه‌ی این (کاربر، سایت) را رمزگشایی و برمی‌گرداند، یا null اگر نباشد/قفل باشد.
 * رمزگشایی با scopeِ همان کاربر انجام می‌شود؛ ردیفِ جابه‌جاشده باز نمی‌شود.
 */
export async function readCredential(
  userId: string,
  board: Board,
  conn: VaultStoreDb = defaultDb,
): Promise<{ credential: BoardCredential; status: CredentialStatus } | null> {
  const [row] = await conn
    .select()
    .from(boardCredentials)
    .innerJoin(boardAccounts, eq(boardCredentials.boardAccountId, boardAccounts.id))
    .where(and(eq(boardAccounts.userId, userId), eq(boardAccounts.board, board)))
    .limit(1);
  if (!row) return null;
  const record = row.board_credentials;
  const status = statusOf(board, record);
  if (status.locked) return null;
  const plaintext = decryptCredential(
    {
      ciphertext: record.ciphertext,
      iv: record.iv,
      salt: record.salt,
      keyVersion: record.keyVersion,
    },
    { userId, board },
  );
  return { credential: parseCredential(plaintext), status };
}

/** وضعیتِ اعتبارنامه‌های این کاربر برای داشبورد — بدونِ رمزگشایی. */
export async function listCredentialStatuses(
  userId: string,
  conn: VaultStoreDb = defaultDb,
): Promise<CredentialStatus[]> {
  const rows = await conn
    .select()
    .from(boardCredentials)
    .innerJoin(boardAccounts, eq(boardCredentials.boardAccountId, boardAccounts.id))
    .where(eq(boardAccounts.userId, userId));
  return rows.map((row) => statusOf(row.board_accounts.board, row.board_credentials));
}

/** نتیجه‌ی یک تلاشِ ورود را ثبت می‌کند؛ شکستِ پیاپی در نهایت قفل می‌آورد. */
export async function recordLoginOutcome(
  userId: string,
  board: Board,
  outcome: { ok: boolean; status: string },
  conn: VaultStoreDb = defaultDb,
): Promise<void> {
  const boardAccountId = await findBoardAccountId(userId, board, conn);
  if (!boardAccountId) return;
  const [existing] = await conn
    .select({ failureCount: boardCredentials.failureCount })
    .from(boardCredentials)
    .where(eq(boardCredentials.boardAccountId, boardAccountId))
    .limit(1);
  if (!existing) return;

  const failureCount = outcome.ok ? 0 : existing.failureCount + 1;
  // A wrong password will never fix itself, so stop retrying and wait for the
  // user instead of hammering the board (and tripping its rate limiter).
  const locked = !outcome.ok && failureCount >= CREDENTIAL_FAILURE_LIMIT;
  await conn
    .update(boardCredentials)
    .set({
      lastLoginAt: new Date(),
      lastLoginStatus: outcome.status,
      failureCount,
      lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
      updatedAt: new Date(),
    })
    .where(eq(boardCredentials.boardAccountId, boardAccountId));
}

/** اعتبارنامه را برای همیشه حذف می‌کند (کاربر «ورودِ خودکار» را خاموش کرد). */
export async function deleteCredential(
  userId: string,
  board: Board,
  conn: VaultStoreDb = defaultDb,
): Promise<boolean> {
  const boardAccountId = await findBoardAccountId(userId, board, conn);
  if (!boardAccountId) return false;
  const deleted = await conn
    .delete(boardCredentials)
    .where(eq(boardCredentials.boardAccountId, boardAccountId))
    .returning({ id: boardCredentials.id });
  return deleted.length > 0;
}
