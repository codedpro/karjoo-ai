"use client";

/**
 * جدولِ ادمینِ ناوگان (client component) — Track C.
 *
 * فهرستِ نودها را با سلامت/نسخه/آخرین دیده‌شدن/کاربرانِ تخصیص‌یافته نشان می‌دهد و برای هر نود
 * کنترل‌های تخصیص/حذفِ تخصیص و صدورِ فرمانِ به‌روزرسانی/ری‌استارت دارد. همه‌ی تغییرها از طریقِ
 * server actionها (fleet-admin-actions) انجام می‌شوند که سمتِ سرور با نگهبانِ ادمین محافظت‌اند —
 * این کامپوننت *هیچ رازی نمی‌بیند* و فقط شناسه‌ها را به اکشن می‌دهد.
 *
 * نگاشت/فرمت‌ها از fleet-labels (خالص) می‌آیند؛ اعداد با toFaDigits فارسی می‌شوند.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, Card, toFaDigits } from "./ui";
import {
  agentVersionLabel,
  isNodeStale,
  nodeHealthLabel,
  relativeTimeFa,
  shortNodeKey,
} from "./fleet-labels";
import {
  assignNodeAction,
  issueCommandAction,
  unassignNodeAction,
  type FleetActionResult,
} from "./fleet-admin-actions";
import type { FleetNodeRow } from "./fleet-admin-data";

export function FleetAdminTable({ nodes }: { nodes: FleetNodeRow[] }) {
  const [notice, setNotice] = useState<FleetActionResult | null>(null);

  if (nodes.length === 0) {
    return (
      <Card className="p-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-3xl">
          🖥️
        </div>
        <h3 className="mt-4 text-lg font-bold">هنوز نودی ثبت‌نام نشده</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-muted">
          نودهای کارگر با توکنِ ثبت‌نام enroll می‌شوند و سپس اینجا با سلامت و کاربرانِ
          تخصیص‌یافته‌شان دیده می‌شوند.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            notice.ok
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {nodes.map((node) => (
        <FleetNodeCard key={node.id} node={node} onResult={setNotice} />
      ))}
    </div>
  );
}

function FleetNodeCard({
  node,
  onResult,
}: {
  node: FleetNodeRow;
  onResult: (r: FleetActionResult) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assignUserId, setAssignUserId] = useState("");

  const health = nodeHealthLabel(node.health);
  const stale = isNodeStale(node.lastSeenAt);

  function run(fn: () => Promise<FleetActionResult>) {
    startTransition(async () => {
      const result = await fn();
      onResult(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card className="p-5">
      {/* ───── سرسطرِ نود: سلامت + کلید + region ───── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold" title={node.nodeKey}>
              {shortNodeKey(node.nodeKey)}
            </span>
            <Badge tone={health.tone}>
              <span aria-hidden>{health.icon}</span> {health.label}
            </Badge>
            {stale ? <Badge tone="rose">heartbeat قطع</Badge> : null}
            {!node.enrolled ? <Badge tone="amber">ثبت‌نام‌نشده</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            {node.region ?? "منطقه‌ی نامشخص"}
            {node.ipAddress ? <span className="ltr-nums"> · {node.ipAddress}</span> : null}
          </p>
        </div>

        {/* صدورِ فرمان */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => issueCommandAction(node.id, "update"))}
            className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-60"
          >
            🔄 به‌روزرسانی
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => issueCommandAction(node.id, "restart"))}
            className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-foreground/5 disabled:opacity-60"
          >
            ⏻ ری‌استارت
          </button>
        </div>
      </div>

      {/* ───── متادیتای دید: نسخه + ظرفیت + آخرین دیده‌شدن ───── */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="نسخه‌ی عامل" value={agentVersionLabel(node.agentVersion)} mono />
        <Stat label="ظرفیت" value={toFaDigits(node.capacity)} />
        <Stat label="آخرین heartbeat" value={toFaDigits(relativeTimeFa(node.lastHeartbeat))} />
        <Stat label="آخرین دیده‌شدن" value={toFaDigits(relativeTimeFa(node.lastSeenAt))} />
      </div>

      {/* ───── کاربرانِ تخصیص‌یافته ───── */}
      <div className="mt-4 border-t border-border/70 pt-4">
        <p className="text-xs font-medium text-muted">
          کاربرانِ تخصیص‌یافته ({toFaDigits(node.assignedUsers.length)})
        </p>
        {node.assignedUsers.length === 0 ? (
          <p className="mt-2 text-xs text-muted">هیچ کاربری به این نود تخصیص نیافته است.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {node.assignedUsers.map((u) => (
              <li
                key={u.userId}
                className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="ltr-nums text-sm font-medium">{toFaDigits(u.phone)}</div>
                  <div className="text-xs text-muted">
                    {u.fullName ?? "بدونِ نام"} · پلن: {u.plan}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => unassignNodeAction(node.id, u.userId))}
                  className="shrink-0 rounded-full border border-rose-500/40 px-3 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-60 dark:text-rose-400"
                >
                  حذفِ تخصیص
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* فرمِ تخصیصِ کاربرِ جدید */}
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            inputMode="text"
            dir="ltr"
            value={assignUserId}
            onChange={(e) => setAssignUserId(e.target.value.trim())}
            placeholder="شناسه‌ی کاربر (UUID)"
            className="ltr-nums min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none focus:border-brand"
            aria-label="شناسه‌ی کاربر برای تخصیص"
          />
          <button
            type="button"
            disabled={pending || assignUserId.length === 0}
            onClick={() => {
              run(() => assignNodeAction(node.id, assignUserId));
              setAssignUserId("");
            }}
            className="shrink-0 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            تخصیص
          </button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
