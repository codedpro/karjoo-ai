import "server-only";

/**
 * رمزنگاریِ اعتبارنامه‌ی سایت کاریابی (server-only).
 *
 * برخلافِ بلابِ نشست، اینجا **رمزِ عبورِ خودِ کاربر** ذخیره می‌شود تا سرور بتواند بدونِ
 * حضورِ مرورگر دوباره وارد شود. این ذاتاً خطرِ بیشتری دارد: نشست منقضی می‌شود و فقط
 * روی یک سایت کار می‌کند، اما رمزِ عبور معمولاً بینِ سرویس‌ها تکرار می‌شود. بنابراین
 * این لایه سخت‌گیرانه‌تر از crypto.ts است:
 *
 *   • کلیدِ هر رکورد با HKDF-SHA256 از کلیدِ اصلی مشتق می‌شود، با saltِ تصادفیِ ۳۲ بایتیِ
 *     مخصوصِ همان رکورد. لو رفتنِ یک کلیدِ مشتق‌شده بقیه را باز نمی‌کند.
 *   • (userId, board) به‌عنوان AAD امضا می‌شود؛ پس یک ردیف را نمی‌توان به کاربرِ دیگر
 *     منتقل کرد — رمزگشایی با AAD ناهم‌خوان شکست می‌خورد.
 *   • plaintext هرگز لاگ نمی‌شود و هیچ‌جا برنمی‌گردد جز به مسیرِ ورودِ همان کاربر.
 *
 * هشدارِ صریح برای نگه‌دارنده: افشای همزمانِ KARJOO_VAULT_KEY و پایگاه‌داده، رمزِ عبورِ
 * سایت کاریابیِ همه‌ی کاربران را افشا می‌کند. مشتق‌سازیِ کلید شعاعِ انفجار را کم می‌کند،
 * حذفش نمی‌کند. چرخشِ کلید و حذفِ اعتبارنامه‌ی بی‌استفاده جدی گرفته شود.
 */
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { requireVaultKey, VaultDecryptionError, CURRENT_KEY_VERSION } from "@/lib/vault/crypto";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 32;

/** رکوردِ رمزشده‌ی اعتبارنامه — دقیقاً همان چیزی که در board_credentials می‌نشیند. */
export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  /** saltِ مخصوصِ همین رکورد برای HKDF (base64). */
  salt: string;
  keyVersion: number;
}

/** هویتی که رکورد به آن گره می‌خورد؛ به‌عنوان AAD امضا می‌شود. */
export interface CredentialScope {
  userId: string;
  board: string;
}

/** AAD — رکورد را به (کاربر، سایت) می‌بندد تا جابه‌جایی بینِ ردیف‌ها ممکن نباشد. */
function aad(scope: CredentialScope): Buffer {
  return Buffer.from(`karjoo:board-credential:v1:${scope.userId}:${scope.board}`, "utf8");
}

/** کلیدِ مخصوصِ این رکورد را از کلیدِ اصلی + salt مشتق می‌کند (HKDF-SHA256). */
function deriveKey(salt: Buffer, scope: CredentialScope): Buffer {
  const master = requireVaultKey();
  const derived = hkdfSync("sha256", master, salt, aad(scope), KEY_BYTES);
  return Buffer.from(derived);
}

/**
 * اعتبارنامه را رمز می‌کند. هر فراخوانی salt و IV تازه می‌سازد.
 * @param plaintext رشته‌ی سریال‌شده‌ی اعتبارنامه (JSON). هرگز لاگ نمی‌شود.
 */
export function encryptCredential(
  plaintext: string,
  scope: CredentialScope,
): EncryptedCredential {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(salt, scope), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(aad(scope));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * اعتبارنامه را رمزگشایی می‌کند. هر ناهم‌خوانی — کلیدِ اشتباه، دستکاریِ ciphertext، یا
 * scopeِ متفاوت (کاربر/سایتِ دیگر) — با VaultDecryptionError رد می‌شود.
 */
export function decryptCredential(
  record: EncryptedCredential,
  scope: CredentialScope,
): string {
  if (record.keyVersion !== CURRENT_KEY_VERSION) {
    throw new VaultDecryptionError(
      `نسخه‌ی کلیدِ اعتبارنامه (${record.keyVersion}) با نسخه‌ی فعلی (${CURRENT_KEY_VERSION}) هم‌خوان نیست.`,
    );
  }
  try {
    const raw = Buffer.from(record.ciphertext, "base64");
    if (raw.length <= 16) throw new Error("ciphertext too short");
    const body = raw.subarray(0, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const salt = Buffer.from(record.salt, "base64");
    if (salt.length !== SALT_BYTES) throw new Error("bad salt");
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveKey(salt, scope),
      Buffer.from(record.iv, "base64"),
      { authTagLength: 16 },
    );
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultDecryptionError();
  }
}

/** اعتبارنامه‌ی یک سایت — تنها شکلی که رمز/ذخیره می‌شود. */
export interface BoardCredential {
  username: string;
  password: string;
}

export function serializeCredential(credential: BoardCredential): string {
  return JSON.stringify({ u: credential.username, p: credential.password });
}

export function parseCredential(plaintext: string): BoardCredential {
  const parsed = JSON.parse(plaintext) as { u?: unknown; p?: unknown };
  if (typeof parsed.u !== "string" || typeof parsed.p !== "string") {
    throw new VaultDecryptionError("شکلِ اعتبارنامه‌ی ذخیره‌شده نامعتبر است.");
  }
  return { username: parsed.u, password: parsed.p };
}

/**
 * نمایشِ ماسک‌شده‌ی نامِ کاربری برای UI — هرگز رمزِ عبور. مثال: `am••••@gmail.com`.
 * محضِ نمایش است؛ هیچ تصمیمی بر پایه‌ی آن گرفته نمی‌شود.
 */
export function maskUsername(username: string): string {
  const at = username.indexOf("@");
  if (at <= 0) {
    const head = username.slice(0, 2);
    return head + "•".repeat(Math.max(2, username.length - 2));
  }
  const local = username.slice(0, at);
  const domain = username.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"•".repeat(Math.max(2, local.length - head.length))}${domain}`;
}
