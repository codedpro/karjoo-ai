import "server-only";

/**
 * از اعتبارنامه‌ی ذخیره‌شده تا نشستِ آماده‌ی مصرف.
 *
 * این تنها جایی است که رمزِ عبور رمزگشایی می‌شود، و خروجی‌اش هرگز رمز نیست: ورود انجام
 * می‌شود، نشستِ حاصل در خزانه‌ی نشست (session_blobs) می‌نشیند و همان مسیرِ موجودِ ناوگان
 * (loadSession → decrypt → replay) بدونِ تغییر کار می‌کند.
 *
 * هر لمسِ اعتبارنامه یک ردیفِ ممیزی می‌نویسد؛ رمز و نشست هرگز در ممیزی نمی‌نشینند.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { auditEvents, boardAccounts } from "@/db/schema";
import { irantalentLoginDriver } from "@/lib/apply/login/irantalent-login";
import { jobinjaLoginDriver } from "@/lib/apply/login/jobinja-login";
import { karboomLoginDriver } from "@/lib/apply/login/karboom-login";
import type { BoardLoginDriver, LoginResult } from "@/lib/apply/login/types";
import { readCredential, recordLoginOutcome } from "@/lib/vault/credential-store";
import { encryptSession } from "@/lib/vault/crypto";
import { findBoardAccountId, upsertSessionBlob, type Board, type VaultStoreDb } from "@/lib/vault/store";

/**
 * سایت‌هایی که ورودِ خودکارِ سمتِ سرور دارند — یعنی سرور می‌تواند بدونِ مرورگرِ کاربر
 * نشست بسازد و نشستِ هفت‌روزه‌ی افزونه را تمدید کند.
 *
 * چرا جاب‌ویژن و ای‌استخدام این‌جا نیستند (بررسی‌شده روی سایتِ زنده، ۲۰۲۶-۰۹-۲۰):
 *   • **ای‌استخدام** — ورودش کدِ یکبارمصرفِ پیامکی است و صفحه‌اش
 *     `robot_preventing_method: "mosparo"` اعلام می‌کند. نه رمزی هست که replay شود،
 *     نه می‌توان ضدِربات را دور زد (§۱۰). حتی با رمز هم بدونِ صندوقِ پیامکِ کاربر
 *     نمی‌شود وارد شد.
 *   • **جاب‌ویژن** — روی یک identity serverِ OIDC سوار است (id_token/refresh_token،
 *     `BuildSysLoginUrl`). فرمی برای POST کردنِ رمز وجود ندارد.
 * برای این دو، نشست فقط از افزونه می‌آید. این محدودیتِ خودِ آن سایت‌هاست، نه کارِ
 * نکرده‌ی ما.
 */
const DRIVERS: Partial<Record<Board, BoardLoginDriver>> = {
  jobinja: jobinjaLoginDriver,
  irantalent: irantalentLoginDriver,
  karboom: karboomLoginDriver,
};

export function loginDriverFor(board: Board): BoardLoginDriver | null {
  return DRIVERS[board] ?? null;
}

export function boardsWithCredentialLogin(): Board[] {
  return Object.keys(DRIVERS) as Board[];
}

/** ممیزی — فقط نتیجه، هرگز اعتبارنامه/نشست. */
export async function auditCredentialEvent(
  userId: string,
  board: Board,
  eventType: "credential_stored" | "credential_removed" | "credential_login",
  metadata: Record<string, unknown>,
  conn: VaultStoreDb = defaultDb,
): Promise<void> {
  const boardAccountId = await findBoardAccountId(userId, board, conn);
  await conn.insert(auditEvents).values({
    userId,
    boardAccountId,
    eventType,
    metadata: { board, ...metadata },
  });
}

export interface LoginAndStoreResult {
  ok: boolean;
  reason?: string;
  accountLabel?: string;
  expiresAt?: Date | null;
}

/**
 * با اعتبارنامه‌ی دادهٔ کاربر وارد می‌شود و نشستِ حاصل را در خزانه می‌گذارد.
 * اعتبارنامه اینجا ذخیره **نمی‌شود** — این کار مسیرِ enroll است.
 */
export async function loginAndStoreSession(
  userId: string,
  board: Board,
  credential: { username: string; password: string },
  opts: { db?: VaultStoreDb; fetchImpl?: typeof fetch } = {},
): Promise<LoginAndStoreResult> {
  const conn = opts.db ?? defaultDb;
  const driver = loginDriverFor(board);
  if (!driver) return { ok: false, reason: "unsupported_board" };

  const result: LoginResult = await driver.login(credential, opts.fetchImpl ?? fetch);
  await recordLoginOutcome(userId, board, {
    ok: result.ok,
    status: result.ok ? "ok" : result.reason,
  }, conn);
  await auditCredentialEvent(userId, board, "credential_login", {
    result: result.ok ? "ok" : result.reason,
  }, conn);

  if (!result.ok) return { ok: false, reason: result.reason };

  await upsertSessionBlob({
    userId,
    board,
    encrypted: encryptSession(result.session),
    sessionShape: result.sessionShape,
    expiresAt: result.expiresAt,
  }, conn);

  // نشستِ تازه ⇒ مکثِ «نشست رد شد» دیگر معنا ندارد؛ صف همین حالا آزاد شود.
  // fail-soft: برداشته‌نشدنِ مکث نباید ورودِ موفق را شکست بدهد (بدترین حالت: صف
  // تا پایانِ مکث صبر می‌کند).
  try {
    const { clearBoardCooldown } = await import("@/lib/apply/board-cooldown");
    await clearBoardCooldown(userId, board, conn as never);
  } catch {
    /* ignore */
  }

  // نشستِ تازه ⇒ حساب دوباره قابلِ استفاده است.
  await conn
    .update(boardAccounts)
    .set({
      status: "connected",
      ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
      lastConnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(boardAccounts.id, (await findBoardAccountId(userId, board, conn))!));

  return {
    ok: true,
    ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
    expiresAt: result.expiresAt,
  };
}

/**
 * نشستِ این کاربر را با اعتبارنامه‌ی *ذخیره‌شده* تازه می‌کند.
 *
 * مسیرِ ناوگان وقتی نشست نیست/منقضی شده این را صدا می‌زند. اگر اعتبارنامه‌ای نباشد یا
 * قفل باشد، بی‌سروصدا false برمی‌گرداند تا کار به مسیرِ افزونه بیفتد.
 */
export async function refreshSessionFromStoredCredential(
  userId: string,
  board: Board,
  opts: { db?: VaultStoreDb; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const conn = opts.db ?? defaultDb;
  if (!loginDriverFor(board)) return false;
  const stored = await readCredential(userId, board, conn);
  if (!stored) return false;
  const result = await loginAndStoreSession(userId, board, stored.credential, opts);
  return result.ok;
}
