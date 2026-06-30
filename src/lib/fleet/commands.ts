import "server-only";

/**
 * کانالِ فرمانِ سرور به نودِ کارگر (server-only) — قاعده‌ی ۴ (به‌روزرسانیِ خودکارِ
 * فرمان‌محور). سرور یک فرمانِ 'update'/'restart' صادر می‌کند؛ نود pollش می‌کند، اجرا و
 * ack می‌دهد. روی فرمانِ 'update'، payload می‌تواند مسیرِ اسکریپتِ به‌روزرسانی
 * (fleetUpdateScript) را حمل کند تا نود همان را اجرا کند (pull+restart) — سرور خودش
 * چیزی اجرا نمی‌کند، فقط فرمان می‌دهد.
 *
 * چرخه‌ی عمرِ وضعیت: pending → (نود poll/ack) acked → (نود تمام کرد) done | failed.
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند (db/now/updateScript) تا بدونِ DB/شبکه‌ی زنده تست شوند.
 */
import { and, asc, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  workerCommands,
  type WorkerCommand,
  type WorkerCommandRow,
} from "@/db/schema";
import { fleetUpdateScript } from "@/lib/env";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد. */
export type FleetCommandsDb = Pick<typeof defaultDb, "insert" | "select" | "update">;

/** ساعتِ قابلِ تزریق — پیش‌فرض `Date.now`. */
export type Clock = () => number;

/** ورودیِ صدورِ یک فرمان. */
export interface IssueCommandInput {
  /** جزئیاتِ اختیاریِ فرمان (مثلاً { targetVersion }) — هرگز راز/نشست. */
  payload?: Record<string, unknown>;
}

/** وابستگی‌های قابلِ تزریقِ issueCommand. */
export interface IssueCommandDeps {
  db?: FleetCommandsDb;
  /** override مسیرِ اسکریپتِ به‌روزرسانی (پیش‌فرض fleetUpdateScript()). فقط تست. */
  updateScript?: string;
}

/**
 * یک فرمان برای یک نود صادر می‌کند (status='pending').
 *
 * برای فرمانِ 'update'، اگر فراخواننده مسیرِ اسکریپت را در payload نگذاشته باشد، به‌صورتِ
 * advisory مسیرِ پیش‌فرضِ fleetUpdateScript() را در payload.updateScript می‌گذارد تا نود
 * بداند چه چیزی را اجرا کند (سرور خودش اجرا نمی‌کند).
 */
export async function issueCommand(
  nodeId: string,
  command: WorkerCommand,
  input: IssueCommandInput = {},
  deps: IssueCommandDeps = {},
): Promise<WorkerCommandRow> {
  const db = deps.db ?? defaultDb;
  const basePayload = input.payload ?? {};
  const payload: Record<string, unknown> =
    command === "update" && basePayload.updateScript === undefined
      ? { ...basePayload, updateScript: deps.updateScript ?? fleetUpdateScript() }
      : basePayload;

  const [row] = await db
    .insert(workerCommands)
    .values({
      nodeId,
      command,
      payload,
      status: "pending",
    })
    .returning();
  return row;
}

/**
 * فرمان‌های pendingِ یک نود را برمی‌گرداند (به‌ترتیبِ زمانِ صدور — قدیمی‌تر اول).
 *
 * این فقط *می‌خواند* (وضعیت را تغییر نمی‌دهد) — نود پس از شروعِ اجرا با ackCommand آن را
 * به acked می‌برد. nodeId همیشه از اعتبارنامه‌ی احرازشده می‌آید (نه بدنه — قاعده‌ی امنیت).
 */
export async function pollCommands(
  nodeId: string,
  conn: FleetCommandsDb = defaultDb,
): Promise<WorkerCommandRow[]> {
  return conn
    .select()
    .from(workerCommands)
    .where(
      and(
        eq(workerCommands.nodeId, nodeId),
        eq(workerCommands.status, "pending"),
      ),
    )
    .orderBy(asc(workerCommands.issuedAt));
}

/** وضعیتِ مجازِ ackِ یک فرمان توسطِ نود. */
export type AckStatus = "acked" | "done" | "failed";

/** وابستگی‌های قابلِ تزریقِ ackCommand. */
export interface AckCommandDeps {
  db?: FleetCommandsDb;
  now?: Clock;
}

/**
 * یک فرمان را با وضعیتِ گزارش‌شده‌ی نود به‌روزرسانی می‌کند:
 *   • 'acked'  → ackedAt = now (نود اجرا را شروع کرد).
 *   • 'done'/'failed' → completedAt = now + result (نود اجرا را تمام کرد).
 *
 * ردیفِ به‌روزشده را برمی‌گرداند، یا null اگر فرمانی با این id نباشد (فراخواننده ۴۰۴ کند).
 * هرگز نتیجه را به فرمانِ نودِ دیگر نمی‌نویسد چون id یکتاست؛ ولی برای دفاعِ بیشتر مسیرِ
 * route باید مالکیتِ فرمان توسطِ نودِ احرازشده را هم بسنجد.
 */
export async function ackCommand(
  commandId: string,
  status: AckStatus,
  result?: Record<string, unknown>,
  deps: AckCommandDeps = {},
): Promise<WorkerCommandRow | null> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? Date.now;
  const ts = new Date(now());

  const terminal = status === "done" || status === "failed";

  const [row] = await db
    .update(workerCommands)
    .set({
      status,
      ...(status === "acked" ? { ackedAt: ts } : {}),
      ...(terminal ? { completedAt: ts } : {}),
      ...(result !== undefined ? { result } : {}),
    })
    .where(eq(workerCommands.id, commandId))
    .returning();

  return row ?? null;
}
