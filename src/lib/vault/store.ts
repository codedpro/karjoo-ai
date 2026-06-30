import "server-only";

/**
 * انبارِ خزانه‌ی نشست (server-only) — می‌نویسد/می‌خواند رویِ جدولِ session_blobs، همیشه
 * **مقید به همان کاربر** (قاعده‌ی ۴): هر بلاب از طریقِ board_accounts (که userId دارد) به
 * کاربر بسته می‌شود؛ این لایه هرگز با boardAccountId خام کار نمی‌کند، بلکه (userId, board)
 * می‌گیرد و خودش حساب را تحتِ همان کاربر resolve می‌کند تا cross-user ممکن نباشد.
 *
 * قواعدِ سختِ ایمنی:
 *   • فقط دادهٔ از پیش‌رمزشده (EncryptedBlob از crypto.ts) ذخیره می‌شود — این لایه هرگز
 *     plaintext نمی‌بیند و هرگز چیزی لاگ نمی‌کند.
 *   • read فقط بلابِ متعلق به همان کاربر را برمی‌گرداند (join به board_accounts.userId).
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند (db) تا بدونِ DB/شبکه‌ی زنده تست شوند.
 */
import { and, desc, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  boardAccounts,
  sessionBlobs,
  type JobListingRow,
  type SessionBlob,
} from "@/db/schema";
import type { EncryptedBlob } from "@/lib/vault/crypto";

/** هندلِ DB که این لایه نیاز دارد — همان کلاینتِ Drizzle. */
export type VaultStoreDb = typeof defaultDb;

/** سایتِ کاریابی — هم‌راستا با jobBoardEnum. */
export type Board = JobListingRow["board"];

/** شکلِ نشست — کوکی یا توکن (هم‌راستا با sessionShapeEnum). */
export type SessionShape = SessionBlob["sessionShape"];

/** خطای typed: حسابِ این (کاربر، سایت) وجود ندارد/به این کاربر تعلق ندارد. */
export class BoardAccountNotFoundError extends Error {
  readonly code = "board_account_not_found" as const;
  constructor(board: string) {
    super(`حسابِ متصل برای سایتِ «${board}» برای این کاربر یافت نشد.`);
    this.name = "BoardAccountNotFoundError";
  }
}

/**
 * شناسه‌ی board_account متعلق به این کاربر برای یک سایت را برمی‌گرداند (یا null).
 * مرزِ ایمنی: شرطِ userId همیشه در WHERE است؛ هرگز حسابِ کاربرِ دیگر برنمی‌گردد.
 */
export async function findBoardAccountId(
  userId: string,
  board: Board,
  conn: VaultStoreDb = defaultDb,
): Promise<string | null> {
  const [row] = await conn
    .select({ id: boardAccounts.id })
    .from(boardAccounts)
    .where(and(eq(boardAccounts.userId, userId), eq(boardAccounts.board, board)))
    .limit(1);
  return row?.id ?? null;
}

/** ورودیِ ذخیره‌ی یک بلابِ رمزشده در خزانه. */
export interface UpsertSessionBlobInput {
  userId: string;
  board: Board;
  /** بلابِ از پیش‌رمزشده (از encryptSession). این لایه plaintext نمی‌بیند. */
  encrypted: EncryptedBlob;
  sessionShape: SessionShape;
  /** زمانِ انقضای تخمینیِ نشست (برای needs_reauth/refresh) — اختیاری. */
  expiresAt?: Date | null;
}

/**
 * یک بلابِ نشستِ رمزشده را برای (کاربر، سایت) ذخیره می‌کند.
 *
 * مرزِ ایمنی: ابتدا حسابِ board را *تحتِ همان userId* resolve می‌کند؛ اگر کاربر آن سایت را
 * متصل نکرده باشد BoardAccountNotFoundError می‌دهد (نمی‌توان به‌جای کاربرِ دیگر نوشت).
 *
 * رفتارِ upsert: چون session_blobs کلیدِ یکتای بومی به‌ازای boardAccount ندارد، این
 * تابع «جایگزینِ آخرین بلاب» را به‌صورتِ صریح انجام می‌دهد: بلاب‌های قبلیِ این حساب را
 * حذف و یک ردیفِ تازه با lastRefreshed=now درج می‌کند (خزانه فقط جدیدترین نشست را نگه
 * می‌دارد؛ نشستِ کهنه فناپذیر است). همه در یک تراکنش تا اتمیک بماند.
 */
export async function upsertSessionBlob(
  input: UpsertSessionBlobInput,
  conn: VaultStoreDb = defaultDb,
): Promise<SessionBlob> {
  const boardAccountId = await findBoardAccountId(input.userId, input.board, conn);
  if (!boardAccountId) throw new BoardAccountNotFoundError(input.board);

  return conn.transaction(async (tx) => {
    // فقط جدیدترین نشست را نگه می‌داریم؛ نشست‌های کهنه‌ی همین حساب حذف می‌شوند.
    await tx.delete(sessionBlobs).where(eq(sessionBlobs.boardAccountId, boardAccountId));

    const [row] = await tx
      .insert(sessionBlobs)
      .values({
        boardAccountId,
        ciphertext: input.encrypted.ciphertext,
        iv: input.encrypted.iv,
        keyVersion: input.encrypted.keyVersion,
        sessionShape: input.sessionShape,
        lastRefreshed: new Date(),
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    return row;
  });
}

/**
 * جدیدترین بلابِ نشستِ رمزشده‌ی این (کاربر، سایت) را برمی‌گرداند، یا null اگر نباشد.
 *
 * مرزِ ایمنی: join به board_accounts با شرطِ userId — فقط بلابِ متعلق به همان کاربر؛
 * هرگز نشستِ کاربرِ دیگر. رمزگشایی *اینجا انجام نمی‌شود* (مصرف‌کننده با decryptSession،
 * در همان مرزِ server-only، رمزگشایی می‌کند) تا plaintext کمترین سطحِ پخش را داشته باشد.
 */
export async function readSessionBlob(
  userId: string,
  board: Board,
  conn: VaultStoreDb = defaultDb,
): Promise<SessionBlob | null> {
  const [row] = await conn
    .select({
      id: sessionBlobs.id,
      boardAccountId: sessionBlobs.boardAccountId,
      ciphertext: sessionBlobs.ciphertext,
      iv: sessionBlobs.iv,
      keyVersion: sessionBlobs.keyVersion,
      sessionShape: sessionBlobs.sessionShape,
      lastRefreshed: sessionBlobs.lastRefreshed,
      expiresAt: sessionBlobs.expiresAt,
      createdAt: sessionBlobs.createdAt,
    })
    .from(sessionBlobs)
    .innerJoin(boardAccounts, eq(sessionBlobs.boardAccountId, boardAccounts.id))
    .where(and(eq(boardAccounts.userId, userId), eq(boardAccounts.board, board)))
    .orderBy(desc(sessionBlobs.lastRefreshed))
    .limit(1);
  return row ?? null;
}
