import "server-only";

/**
 * رمزنگاریِ بلابِ نشست برای خزانه (server-only) — قاعده‌ی ۴ (CONTEXT/§۱۰، track C).
 *
 * این لایه نشستِ *خودِ کاربر* را برای اپلایِ خودکارِ *همان کاربر* (replay در نودِ کارگرِ
 * Max/Max+) با AES-256-GCM رمزنگاری می‌کند. هرگز اعتبارنامه‌ی خام/متنِ ساده ذخیره نمی‌شود؛
 * فقط ciphertext + iv + keyVersion (که در جدولِ session_blobs می‌نشینند).
 *
 * قواعدِ سختِ ایمنی:
 *   • کلید (KARJOO_VAULT_KEY) فقط روی کنترل‌پلین است و فقط اینجا (server-only) خوانده می‌شود.
 *     اگر تنظیم/معتبر نباشد → VaultNotConfiguredError (fail-closed): هیچ‌چیز رمز/ذخیره نمی‌شود.
 *   • GCM یک authentication tag تولید می‌کند؛ هر دستکاریِ ciphertext/iv/tag در رمزگشایی
 *     با خطا رد می‌شود (یکپارچگی تضمین‌شده). tag به انتهای ciphertext چسبانده می‌شود.
 *   • هر بلاب IV (nonce) تصادفیِ ۱۲ بایتیِ مستقل دارد (هرگز IV ثابت/تکراری برای GCM).
 *   • هیچ‌جا plaintext لاگ نمی‌شود.
 */
import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { vaultKeyRaw } from "@/lib/env";

/** الگوریتمِ رمزنگاری — AES-256-GCM (کلیدِ ۳۲ بایت، IV ۱۲ بایت، tag ۱۶ بایت). */
const ALGORITHM = "aes-256-gcm" as const;
/** طولِ کلیدِ AES-256 به بایت. */
const KEY_BYTES = 32;
/** طولِ IV/nonce برای GCM به بایت (توصیه‌ی استاندارد ۹۶ بیت). */
const IV_BYTES = 12;
/** طولِ authentication tagِ GCM به بایت. */
const TAG_BYTES = 16;

/**
 * نسخه‌ی کلیدِ فعلی. اگر کلیدِ خزانه چرخانده شود، این را بالا ببرید و رمزگشاییِ
 * نسخه‌های قدیمی را با نگاشتِ keyVersion→key مدیریت کنید. فعلاً تک‌کلیدی (۱).
 */
export const CURRENT_KEY_VERSION = 1 as const;

/** نتیجه‌ی رمزنگاری — همان شکلی که در session_blobs ذخیره می‌شود. */
export interface EncryptedBlob {
  /** متنِ رمزشده + authentication tag، به‌صورتِ base64 (ciphertext||tag). */
  ciphertext: string;
  /** IV/nonce تصادفیِ این بلاب، به‌صورتِ base64. */
  iv: string;
  /** نسخه‌ی کلیدی که با آن رمز شد (برای چرخشِ کلید در آینده). */
  keyVersion: number;
}

/**
 * خطای typed: کلیدِ خزانه تنظیم/معتبر نیست. هر مسیرِ refresh/replay با گرفتنِ این خطا
 * باید پاسخِ روشنِ «خزانه پیکربندی نشده» بدهد و *هیچ‌چیز* ذخیره نکند (fail-closed).
 */
export class VaultNotConfiguredError extends Error {
  readonly code = "vault_not_configured" as const;
  constructor(message?: string) {
    super(
      message ??
        "خزانه‌ی نشست پیکربندی نشده است: KARJOO_VAULT_KEY تنظیم/معتبر نیست. " +
          "یک کلیدِ ۳۲ بایتی (base64 یا hex) ست کنید تا رمزنگاریِ نشست فعال شود.",
    );
    this.name = "VaultNotConfiguredError";
  }
}

/**
 * خطای typed: رمزگشایی شکست خورد (کلیدِ اشتباه، نسخه‌ی ناهم‌خوان، یا دستکاریِ
 * ciphertext/iv/tag — auth-tag verify نشد). هرگز جزئیاتِ حساس را افشا نمی‌کند.
 */
export class VaultDecryptionError extends Error {
  readonly code = "vault_decryption_failed" as const;
  constructor(message?: string) {
    super(message ?? "رمزگشاییِ بلابِ نشست شکست خورد (کلیدِ نادرست یا داده‌ی دستکاری‌شده).");
    this.name = "VaultDecryptionError";
  }
}

/**
 * کلیدِ خام (KARJOO_VAULT_KEY) را به یک بافرِ دقیقاً ۳۲ بایتی decode می‌کند.
 *
 * base64 (با/بدون padding) و hex هر دو پذیرفته می‌شوند: اگر رشته فقط hex و طولش ۶۴ بود،
 * به‌عنوان hex خوانده می‌شود؛ وگرنه base64. اگر کلید کم/نباشد یا پس از decode دقیقاً
 * ۳۲ بایت نشود → VaultNotConfiguredError (fail-closed). هرگز کلید را لاگ نمی‌کند.
 */
function resolveKey(): Buffer {
  const raw = vaultKeyRaw();
  if (!raw) throw new VaultNotConfiguredError();

  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    // hex خالصِ ۶۴ کاراکتری ⇒ ۳۲ بایت.
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new VaultNotConfiguredError(
      `KARJOO_VAULT_KEY باید پس از decode دقیقاً ${KEY_BYTES} بایت باشد ` +
        `(base64 یا hex)، اما ${key.length} بایت decode شد.`,
    );
  }
  return key;
}

/**
 * آیا کلیدِ خزانه تنظیم و معتبر (۳۲ بایت) است؟ هرگز throw نمی‌کند — برای پاسخِ سریعِ
 * «پیکربندی‌نشده» در مسیرِ refresh پیش از تلاش برای رمزنگاری.
 */
export function isVaultReady(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * کلیدِ خزانه را الزام می‌کند (برای گاردِ صریح در مسیرِ refresh). اگر تنظیم/معتبر نباشد
 * VaultNotConfiguredError می‌دهد. کلیدِ بازگشتی را *لاگ/ذخیره نکنید*.
 */
export function requireVaultKey(): Buffer {
  return resolveKey();
}

/**
 * یک plaintext (نشستِ سریال‌شده‌ی کاربر) را با AES-256-GCM رمزنگاری می‌کند.
 *
 * هر فراخوانی یک IV تصادفیِ مستقل می‌سازد. خروجی {ciphertext, iv, keyVersion} مستقیماً
 * در session_blobs می‌نشیند. اگر کلید پیکربندی نشده باشد VaultNotConfiguredError می‌دهد
 * (و هیچ‌چیز رمز نمی‌شود).
 *
 * @param plaintext رشته‌ی نشستِ خامِ کاربر (JSONِ کوکی‌ها/توکن‌ها). هرگز لاگ نمی‌شود.
 */
export function encryptSession(plaintext: string): EncryptedBlob {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // ۱۶ بایت
  // tag را به ciphertext می‌چسبانیم تا یک ستونِ ذخیره کافی باشد (ciphertext||tag).
  const combined = Buffer.concat([enc, tag]);
  return {
    ciphertext: combined.toString("base64"),
    iv: iv.toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * یک EncryptedBlob را رمزگشایی و plaintextِ اصلی را برمی‌گرداند.
 *
 * authentication tag (۱۶ بایتِ انتهاییِ ciphertext) راستی‌آزمایی می‌شود؛ هر دستکاری در
 * ciphertext/iv/tag یا کلیدِ نادرست → VaultDecryptionError. اگر کلید پیکربندی نشده باشد
 * VaultNotConfiguredError. خروجی را *لاگ نکنید*.
 */
export function decryptSession(blob: EncryptedBlob): string {
  const key = resolveKey();

  // نسخه‌ی کلید باید با نسخه‌ی فعلی هم‌خوان باشد (تک‌کلیدی فعلاً). مغایرت → خطای رمزگشایی.
  if (blob.keyVersion !== CURRENT_KEY_VERSION) {
    throw new VaultDecryptionError(
      `نسخه‌ی کلیدِ بلاب (${blob.keyVersion}) با نسخه‌ی فعلی (${CURRENT_KEY_VERSION}) هم‌خوان نیست.`,
    );
  }

  let iv: Buffer;
  let combined: Buffer;
  try {
    iv = Buffer.from(blob.iv, "base64");
    combined = Buffer.from(blob.ciphertext, "base64");
  } catch {
    throw new VaultDecryptionError();
  }

  // ساختارِ کمینه: حداقل باید tag را در خود داشته باشد و IV درست‌اندازه باشد.
  if (iv.length !== IV_BYTES || combined.length < TAG_BYTES) {
    throw new VaultDecryptionError();
  }

  const enc = combined.subarray(0, combined.length - TAG_BYTES);
  const tag = combined.subarray(combined.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    // final() در صورتِ شکستِ auth-tag throw می‌کند — به خطای typed نگاشت می‌کنیم.
    throw new VaultDecryptionError();
  }
}

/**
 * مقایسه‌ی زمان‌ثابتِ دو رشته‌ی base64 (کمکی برای تستِ tamper/round-trip بدونِ نشتِ
 * زمان‌بندی). برای مقایسه‌ی fingerprintِ نشست در آینده مفید است.
 */
export function constantTimeEqualB64(a: string, b: string): boolean {
  const ba = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
