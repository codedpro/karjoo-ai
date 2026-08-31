import "server-only";

/**
 * GET    /api/board-accounts/credentials — وضعیتِ ورودِ خودکارِ این کاربر (بدونِ رمز).
 * POST   /api/board-accounts/credentials — ذخیره‌ی اعتبارنامه + یک ورودِ آزمایشی.
 * DELETE /api/board-accounts/credentials — حذفِ اعتبارنامه.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * اینجا تنها نقطه‌ای است که رمزِ عبورِ سایت کاریابی وارد سیستم می‌شود. قواعدِ سخت:
 *   • فقط نشستِ وبِ خودِ کاربر (نه افزونه، نه bearerِ ماشین) اجازه دارد.
 *   • رمز هرگز در پاسخ، لاگ یا ممیزی برنمی‌گردد — فقط نامِ کاربریِ ماسک‌شده.
 *   • پیش از ذخیره، یک ورودِ واقعی انجام می‌شود؛ اگر سایت رد کند چیزی ذخیره نمی‌شود.
 *     پس اعتبارنامه‌ی غلط هرگز روی دیسک نمی‌نشیند.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";

import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { isBoardConnectable } from "@/lib/apply/registry";
import {
  auditCredentialEvent,
  boardsWithCredentialLogin,
  loginAndStoreSession,
} from "@/lib/apply/login/session-provider";
import {
  deleteCredential,
  listCredentialStatuses,
  upsertCredential,
} from "@/lib/vault/credential-store";
import { isVaultReady } from "@/lib/vault/crypto";
import { BoardAccountNotFoundError, type Board } from "@/lib/vault/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const credentialBodySchema = z.object({
  board: z.enum(["jobinja", "irantalent"]),
  username: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(400),
}).strict();

const deleteBodySchema = z.object({
  board: z.enum(["jobinja", "irantalent"]),
}).strict();

/** پیامِ فارسیِ هر دلیلِ شکستِ ورود — برای نمایشِ مستقیم به کاربر. */
const FAILURE_MESSAGES: Record<string, string> = {
  invalid_credentials: "ایمیل یا رمز عبور درست نیست. دوباره بررسی کنید.",
  security_challenge: "سایت یک بررسی امنیتی خواسته است. یک‌بار از مرورگر خودتان وارد شوید و بعد دوباره تلاش کنید.",
  rate_limited: "سایت فعلاً تعداد تلاش‌ها را محدود کرده است. کمی بعد دوباره امتحان کنید.",
  account_action_required: "حساب شما در آن سایت نیاز به تکمیل دارد (مثلاً تأیید ایمیل یا ساخت رزومه).",
  session_unavailable: "ورود انجام شد اما نشست قابل استفاده‌ای به دست نیامد.",
  unavailable: "در این لحظه ارتباط با سایت برقرار نشد. کمی بعد دوباره امتحان کنید.",
  provider_changed: "صفحهٔ ورود آن سایت تغییر کرده است. تیم کارجو باید آن را به‌روزرسانی کند.",
  unsupported_board: "ورود خودکار برای این سایت پشتیبانی نمی‌شود.",
};

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    return json({
      vaultReady: isVaultReady(),
      supportedBoards: boardsWithCredentialLogin(),
      credentials: await listCredentialStatuses(user.id),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    if (!isVaultReady()) {
      return errorJson("خزانهٔ رمزنگاری پیکربندی نشده است؛ ورود خودکار غیرفعال است.", 503);
    }

    const body = await parseJsonBody(request, credentialBodySchema);
    const board = body.board as Board;
    if (!isBoardConnectable(board)) {
      return errorJson("این سایت هنوز پشتیبانی نمی‌شود.", 409);
    }

    const credential = { username: body.username, password: body.password };

    // اول ورود، بعد ذخیره: اعتبارنامه‌ی رد‌شده هرگز ذخیره نمی‌شود.
    let attempt;
    try {
      attempt = await loginAndStoreSession(user.id, board, credential);
    } catch (error) {
      if (error instanceof BoardAccountNotFoundError) {
        return errorJson("ابتدا این سایت را در افزونه متصل کنید.", 409);
      }
      throw error;
    }
    if (!attempt.ok) {
      return errorJson(
        FAILURE_MESSAGES[attempt.reason ?? "unavailable"] ?? FAILURE_MESSAGES.unavailable!,
        422,
      );
    }

    const status = await upsertCredential(user.id, board, credential);
    await auditCredentialEvent(user.id, board, "credential_stored", {
      usernameHint: status.usernameHint,
    });

    return json({
      ok: true,
      credential: status,
      ...(attempt.accountLabel ? { accountLabel: attempt.accountLabel } : {}),
    });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    const body = await parseJsonBody(request, deleteBodySchema);
    const board = body.board as Board;
    const removed = await deleteCredential(user.id, board);
    if (removed) {
      await auditCredentialEvent(user.id, board, "credential_removed", { by: "user" });
    }
    return json({ ok: true, removed });
  });
}
