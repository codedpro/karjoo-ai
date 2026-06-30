import "server-only";

/**
 * چرخه‌ی عمرِ نودِ کارگر: ثبت‌نام + صدورِ اعتبارنامه + heartbeat (server-only).
 * WF worker-fleet، قاعده‌ی ۱.
 *
 * جریان (همه روی کنترل‌پلین):
 *   ۱) نود با یک ENROLLMENT TOKENِ یک‌بارمصرف (از env: KARJOO_FLEET_ENROLLMENT_TOKEN)
 *      ثبت‌نام می‌کند → سرور توکن را *طول‌ثابت* در برابرِ env راستی‌آزمایی می‌کند.
 *      اگر env تنظیم نشده باشد، ثبت‌نام «بسته» است (FleetEnrollmentClosedError → ۵۰۳).
 *   ۲) سرور یک ردیفِ worker_nodes را create/update می‌کند و یک CREDENTIALِ تصادفیِ
 *      هر-نودی صادر می‌کند؛ *فقط hashِ* اعتبارنامه (HMAC با pepperِ سرور) ذخیره می‌شود.
 *      اعتبارنامه‌ی خام فقط *یک‌بار* (در پاسخِ ثبت‌نام) برگردانده می‌شود.
 *   ۳) نود هر فراخوانی را با همان اعتبارنامه احراز می‌کند (verifyNodeCredential: hash
 *      compare طول‌ثابت). heartbeat با health + agentVersion + ipAddress می‌زند.
 *
 * قواعدِ سختِ ایمنی:
 *   • نه توکنِ ثبت‌نام و نه اعتبارنامه‌ی خام هرگز ذخیره/لاگ نمی‌شوند — فقط hashِ آن‌ها.
 *   • مقایسه‌ها طول‌ثابت‌اند (timing-safe) — هم برای توکنِ ثبت‌نام و هم اعتبارنامه.
 *   • fail-closed: نبودِ env ⇒ ثبت‌نام بسته؛ توکنِ نادرست ⇒ FleetEnrollmentTokenError.
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند (db/now/randomBytes/pepper/enrollmentToken) تا بدونِ
 * DB/شبکه/راز واقعی تست شوند.
 */
import { randomBytes as defaultRandomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { workerNodes, type WorkerNode } from "@/db/schema";
import { hashWithPepper, safeEqualHex } from "@/lib/auth/core";
import { fleetEnrollmentTokenRaw, requireAuthPepper } from "@/lib/env";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد. */
export type FleetEnrollDb = Pick<typeof defaultDb, "insert" | "select" | "update">;

/** تولیدکننده‌ی بایتِ تصادفی — پیش‌فرض `node:crypto`. قابلِ override در تست. */
export type RandomBytesFn = (size: number) => Buffer;

/** ساعتِ قابلِ تزریق — پیش‌فرض `Date.now`. */
export type Clock = () => number;

/** تعدادِ بایتِ اعتبارنامه‌ی خامِ نود (۲۵۶ بیت entropy، مثلِ توکنِ نشست). */
const CREDENTIAL_BYTES = 32;

/* ───────────────────────────────  خطاها  ───────────────────────────────── */

/**
 * خطای typed: ثبت‌نامِ ناوگان «بسته» است (KARJOO_FLEET_ENROLLMENT_TOKEN تنظیم نشده).
 * مسیرِ ثبت‌نام باید این را به پاسخِ ۵۰۳ نگاشت کند (سرویس فعلاً ثبت‌نام نمی‌پذیرد).
 */
export class FleetEnrollmentClosedError extends Error {
  readonly code = "fleet_enrollment_closed" as const;
  constructor() {
    super(
      "ثبت‌نامِ ناوگانِ کارگر بسته است: KARJOO_FLEET_ENROLLMENT_TOKEN تنظیم نشده. " +
        "این راز را در محیطِ کنترل‌پلین ست کنید تا نودها بتوانند ثبت‌نام کنند.",
    );
    this.name = "FleetEnrollmentClosedError";
  }
}

/**
 * خطای typed: توکنِ ثبت‌نامِ ارائه‌شده نادرست است. مسیرِ ثبت‌نام باید این را به ۴۰۱/۴۰۳
 * نگاشت کند. پیامِ عمومی نگه داشته می‌شود تا چیزی درباره‌ی توکنِ درست نشت ندهد.
 */
export class FleetEnrollmentTokenError extends Error {
  readonly code = "fleet_enrollment_token_invalid" as const;
  constructor() {
    super("توکنِ ثبت‌نامِ ناوگان نامعتبر است.");
    this.name = "FleetEnrollmentTokenError";
  }
}

/* ─────────────────────────────  ثبت‌نام  ────────────────────────────────── */

/** ورودیِ ثبت‌نامِ یک نود. */
export interface EnrollNodeInput {
  /** شناسه‌ی پایدارِ نود (از پیکربندیِ خودِ نود) — مبنای upsert. */
  nodeKey: string;
  /** IPِ گزارش‌شده‌ی نود (سرور با اعتبارنامه + IP/region نود را می‌شناسد). */
  ipAddress?: string | null;
  /** کلاسِ IP/منطقه — مثلاً «IR-residential». */
  region?: string | null;
  /** نسخه‌ی عاملِ نود (برای دیدِ وضعیتِ ناوگان). */
  agentVersion?: string | null;
}

/** وابستگی‌های قابلِ تزریقِ ثبت‌نام. */
export interface EnrollDeps {
  db?: FleetEnrollDb;
  now?: Clock;
  randomBytesImpl?: RandomBytesFn;
  /** override رازِ pepper (پیش‌فرض از env). فقط تست. */
  pepper?: string;
  /** override توکنِ ثبت‌نامِ env (پیش‌فرض fleetEnrollmentTokenRaw()). فقط تست. */
  enrollmentTokenEnv?: string | null;
}

/** نتیجه‌ی ثبت‌نام: اعتبارنامه‌ی خام (فقط یک‌بار) + ردیفِ نودِ ذخیره‌شده. */
export interface EnrollResult {
  /** اعتبارنامه‌ی خامِ مات — فقط همین‌جا و یک‌بار؛ هرگز در DB نیست. */
  credential: string;
  /** ردیفِ نود (شاملِ credentialHash، نه خودِ اعتبارنامه). */
  node: WorkerNode;
}

/**
 * توکنِ ثبت‌نام را در برابرِ رازِ env به‌صورتِ طول‌ثابت می‌سنجد. اگر env تنظیم نشده
 * باشد FleetEnrollmentClosedError؛ اگر نخواند FleetEnrollmentTokenError.
 *
 * نکته‌ی طول‌ثابت: به‌جای مقایسه‌ی مستقیمِ رشته‌ها، هر دو سمت را با pepper HMAC می‌کنیم و
 * هشِ hex را با safeEqualHex (timingSafeEqual) می‌سنجیم — هم برابریِ طول را تضمین می‌کند
 * (هشِ hex همیشه هم‌طول است) و هم کانالِ زمان‌سنجی نشت نمی‌دهد.
 */
function assertEnrollmentToken(
  presented: string,
  pepper: string,
  envToken: string | null,
): void {
  if (!envToken) throw new FleetEnrollmentClosedError();
  const a = hashWithPepper(presented, pepper);
  const b = hashWithPepper(envToken, pepper);
  if (!safeEqualHex(a, b)) throw new FleetEnrollmentTokenError();
}

/**
 * یک نود را ثبت‌نام می‌کند: توکن را راستی‌آزمایی، ردیفِ worker_nodes را upsert (روی
 * nodeKey)، یک اعتبارنامه‌ی تصادفی صادر و فقط hashش را ذخیره می‌کند، و اعتبارنامه‌ی خام
 * را *یک‌بار* برمی‌گرداند.
 *
 * upsert روی nodeKey: ثبت‌نامِ دوباره‌ی همان نود (مثلاً پس از rebuild) اعتبارنامه‌ی تازه
 * صادر می‌کند و قبلی را باطل (rotate) — تا یک نود همیشه دقیقاً یک اعتبارنامه‌ی فعال داشته
 * باشد. health به 'online' و lastSeenAt به now ست می‌شود.
 *
 * @throws FleetEnrollmentClosedError اگر رازِ env تنظیم نشده باشد (۵۰۳).
 * @throws FleetEnrollmentTokenError اگر توکن نادرست باشد (۴۰۱/۴۰۳).
 */
export async function enrollNode(
  enrollmentToken: string,
  input: EnrollNodeInput,
  deps: EnrollDeps = {},
): Promise<EnrollResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? Date.now;
  const rand = deps.randomBytesImpl ?? defaultRandomBytes;
  const pepper = deps.pepper ?? requireAuthPepper();
  const envToken =
    deps.enrollmentTokenEnv !== undefined
      ? deps.enrollmentTokenEnv
      : fleetEnrollmentTokenRaw();

  // ۱) راستی‌آزماییِ توکنِ ثبت‌نام (طول‌ثابت، fail-closed).
  assertEnrollmentToken(enrollmentToken, pepper, envToken);

  // ۲) اعتبارنامه‌ی خامِ مات و url-safe (نه JWT) — فقط hashش ذخیره می‌شود.
  const credential = rand(CREDENTIAL_BYTES).toString("base64url");
  const credentialHash = hashWithPepper(credential, pepper);
  // هشِ توکنِ ثبت‌نام (برای ممیزی/گردش) — هرگز توکنِ خام.
  const enrollmentTokenHash = hashWithPepper(enrollmentToken, pepper);
  const ts = new Date(now());

  // ۳) upsert روی nodeKey — ردیفِ موجود اعتبارنامه‌اش rotate می‌شود.
  const [node] = await db
    .insert(workerNodes)
    .values({
      nodeKey: input.nodeKey,
      region: input.region ?? null,
      ipAddress: input.ipAddress ?? null,
      agentVersion: input.agentVersion ?? null,
      credentialHash,
      enrollmentTokenHash,
      health: "online",
      lastSeenAt: ts,
      lastHeartbeat: ts,
    })
    .onConflictDoUpdate({
      target: workerNodes.nodeKey,
      set: {
        region: input.region ?? null,
        ipAddress: input.ipAddress ?? null,
        agentVersion: input.agentVersion ?? null,
        credentialHash,
        enrollmentTokenHash,
        health: "online",
        lastSeenAt: ts,
        lastHeartbeat: ts,
      },
    })
    .returning();

  return { credential, node };
}

/* ───────────────────────  راستی‌آزماییِ اعتبارنامه  ─────────────────────── */

/**
 * یک اعتبارنامه‌ی خامِ نود را راستی‌آزمایی می‌کند و ردیفِ نود را برمی‌گرداند، یا `null`.
 *
 * اعتبارنامه‌ی خام را با pepper HMAC می‌کند و ردیفِ نود را با همان credentialHash می‌یابد.
 * چون lookup روی هشِ یکتاست (و خودِ هش با مقایسه‌ی برابریِ DB یافت می‌شود که برای hashِ
 * پرانتروپی side-channel معنادار ندارد)، این کافی است. اگر هیچ نودی نخورد، null
 * (فراخواننده fail-closed / ۴۰۱ کند).
 *
 * مرزِ ایمنی: فقط ردیف‌هایی که credentialHash دارند (نودِ ثبت‌نام‌شده) مجازند؛ شرطِ
 * isNotNull از خوردنِ تصادفیِ ردیف‌های ثبت‌نام‌نشده جلوگیری می‌کند.
 */
export async function verifyNodeCredential(
  rawCredential: string,
  deps: { db?: FleetEnrollDb; pepper?: string } = {},
): Promise<WorkerNode | null> {
  if (!rawCredential) return null;
  const db = deps.db ?? defaultDb;
  const pepper = deps.pepper ?? requireAuthPepper();
  const credentialHash = hashWithPepper(rawCredential, pepper);

  const [node] = await db
    .select()
    .from(workerNodes)
    .where(
      and(
        eq(workerNodes.credentialHash, credentialHash),
        isNotNull(workerNodes.credentialHash),
      ),
    )
    .limit(1);

  return node ?? null;
}

/* ───────────────────────────────  heartbeat  ───────────────────────────── */

/** ورودیِ heartbeat — وضعیتِ گزارش‌شده‌ی نود. */
export interface HeartbeatInput {
  health?: WorkerNode["health"];
  agentVersion?: string | null;
  ipAddress?: string | null;
}

/**
 * heartbeatِ یک نود را ثبت می‌کند: health/agentVersion/ipAddress (در صورتِ ارائه) را
 * به‌روزرسانی و lastHeartbeat/lastSeenAt را به now ست می‌کند. ردیفِ به‌روزشده را
 * برمی‌گرداند (یا null اگر نودی با این id نباشد).
 *
 * فیلدهای undefined دست‌نخورده می‌مانند (نود می‌تواند فقط health بفرستد). nodeId همیشه از
 * اعتبارنامه‌ی احرازشده می‌آید — هرگز از بدنه‌ی یک فراخوانیِ نامعتبر (قاعده‌ی امنیت).
 */
export async function recordHeartbeat(
  nodeId: string,
  input: HeartbeatInput = {},
  deps: { db?: FleetEnrollDb; now?: Clock } = {},
): Promise<WorkerNode | null> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? Date.now;
  const ts = new Date(now());

  const [node] = await db
    .update(workerNodes)
    .set({
      ...(input.health !== undefined ? { health: input.health } : {}),
      ...(input.agentVersion !== undefined ? { agentVersion: input.agentVersion } : {}),
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      lastHeartbeat: ts,
      lastSeenAt: ts,
    })
    .where(eq(workerNodes.id, nodeId))
    .returning();

  return node ?? null;
}
