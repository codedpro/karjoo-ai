import "server-only";

/**
 * POST /api/session/refresh
 *
 * خزانه‌ی نشست (Track C — قاعده‌ی ۴، §۱۰ Max/Max+). کاربر بسته‌ی نشستِ *خودش* را برای
 * یک سایت (کوکی‌ها + localStorage + sessionStorage که افزونه از مرورگرِ خودش ضبط کرده)
 * می‌فرستد؛ این اندپوینت آن را با AES-256-GCM **رمز** می‌کند و در session_blobs (مقید به
 * همان کاربر) upsert می‌کند، با lastRefreshed=now و یک expiresAt محافظه‌کارانه.
 *
 * تمایزِ بحرانی با connect/import: آن‌ها هر مادهٔ سری را رد می‌کنند؛ اینجا *عمداً* همان
 * اعتبارنامه‌ی خودِ کاربر را می‌پذیریم — چون فقط به خزانه‌ی *رمزشده‌ی همان کاربر* می‌رود و
 * فقط برای replayِ اپلایِ خودکارِ همان کاربر (نودِ Max/Max+). هیچ‌گاه cross-user؛ هیچ‌گاه
 * plaintext در DB؛ هیچ‌گاه لاگِ نشست.
 *
 * قاعده‌ی fail-closed: اگر KARJOO_VAULT_KEY تنظیم/معتبر نباشد → ۵۰۳ «vault not configured»
 * و *هیچ‌چیز* ذخیره نمی‌شود (نه خام، نه رمزشده).
 *
 * احراز: نشستِ افزونه (Bearer) — نشست از مرورگرِ خودِ کاربر می‌آید.
 *
 * بدنه (JSON): { board, session: { cookies?, localStorage?, sessionStorage?, userAgent? }, expiresAt? }
 */
import {
  errorJson,
  json,
  parseJsonBody,
  withErrorHandling,
} from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import {
  resolveSessionShape,
  serializeSessionBundle,
  sessionRefreshBodySchema,
} from "@/lib/api/session-schemas";
import {
  encryptSession,
  isVaultReady,
  VaultNotConfiguredError,
} from "@/lib/vault/crypto";
import { BoardAccountNotFoundError, upsertSessionBlob } from "@/lib/vault/store";

// به DB و رمزنگاریِ Node دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** پنجره‌ی پیش‌فرضِ اعتبارِ نشست اگر کلاینت expiresAt نداده باشد (۷ روز — محافظه‌کارانه). */
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه (نشست از مرورگرِ خودِ کاربر می‌آید).
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) گاردِ fail-closed: پیش از خواندن/رمزِ هر چیز، مطمئن شو خزانه پیکربندی شده.
    //    اگر کلید نباشد، *هیچ‌چیز* (حتی بدنه) را پردازش/ذخیره نمی‌کنیم.
    if (!isVaultReady()) {
      return errorJson("vault not configured", 503);
    }

    // ۳) اعتبارسنجیِ بدنه. `.strict()` فیلدِ ناشناخته را رد می‌کند؛ نشستِ خالی هم رد می‌شود.
    const body = await parseJsonBody(request, sessionRefreshBodySchema);

    // ۴) سریال‌سازی + رمزنگاری. plaintext فقط در همین تابع زندگی می‌کند و لاگ نمی‌شود؛
    //    فقط خروجیِ رمزشده (ciphertext/iv/keyVersion) به store می‌رود.
    let encrypted;
    try {
      const plaintext = serializeSessionBundle(body.session);
      encrypted = encryptSession(plaintext);
    } catch (err) {
      // اگر دقیقاً بینِ isVaultReady و اینجا کلید نامعتبر شد، باز هم fail-closed.
      if (err instanceof VaultNotConfiguredError) {
        return errorJson("vault not configured", 503);
      }
      throw err;
    }

    const sessionShape = resolveSessionShape(body.board, body.session);
    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : new Date(Date.now() + DEFAULT_SESSION_TTL_MS);

    // ۵) upsert در خزانه — مقید به همان کاربر (store حساب را تحتِ userId resolve می‌کند).
    //    اگر کاربر این سایت را connect نکرده باشد ⇒ ۴۰۹ (ابتدا باید board را connect کند).
    let blob;
    try {
      blob = await upsertSessionBlob({
        userId,
        board: body.board,
        encrypted,
        sessionShape,
        expiresAt,
      });
    } catch (err) {
      if (err instanceof BoardAccountNotFoundError) {
        return errorJson("board not connected", 409);
      }
      throw err;
    }

    // ۶) پاسخ — فقط متادیتا (هرگز ciphertext/iv/secret در بدنه).
    return json(
      {
        board: body.board,
        sessionShape,
        lastRefreshed: blob.lastRefreshed,
        expiresAt: blob.expiresAt,
      },
      200,
    );
  });
}
