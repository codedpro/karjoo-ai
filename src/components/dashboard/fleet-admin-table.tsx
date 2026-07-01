"use client";

/**
 * جدولِ ادمینِ ناوگان (client component) — Track C.
 *
 * فهرستِ نودها را با سلامت/نسخه/آخرین دیده‌شدن/کاربرانِ تخصیص‌یافته نشان می‌دهد و برای هر نود
 * کنترل‌های تخصیص/حذفِ تخصیص و صدورِ فرمانِ به‌روزرسانی/ری‌استارت دارد. همه‌ی تغییرها از طریقِ
 * server actionها (fleet-admin-actions) انجام می‌شوند که سمتِ سرور با نگهبانِ ادمین محافظت‌اند —
 * این کامپوننت *هیچ رازی نمی‌بیند* و فقط شناسه‌ها را به اکشن می‌دهد.
 *
 * نگاشت/فرمت‌ها از fleet-labels (خالص) می‌آیند؛ اعداد با toFaDigits فارسی می‌شوند. زبانِ بصری
 * روی پرایمیتیوهای مشترک (Card/Badge/Button/EmptyState) و آیکن‌های SVG (بدونِ ایموجی) سوار است.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card, EmptyState, cn, toFaDigits } from "./ui";
import {
  IconClose,
  IconPlus,
  IconPower,
  IconRefresh,
  IconServer,
  IconStatusDot,
} from "./icons";
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
      <EmptyState
        icon={<IconServer className="h-7 w-7 text-brand" />}
        title="هنوز سروری ثبت‌نام نشده"
        body="سرورهای اپلای با توکنِ ثبت‌نام enroll می‌شوند و سپس این‌جا با سلامت و کاربرانِ تخصیص‌یافته‌شان دیده می‌شوند."
      />
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          role="status"
          className={cn(
            "text-pretty rounded-xl px-4 py-3 text-sm",
            notice.ok
              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
          )}
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
    <Card padded>
      {/* ───── سرسطرِ نود: سلامت + کلید + region ───── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="ltr-nums font-mono text-sm font-bold"
              dir="ltr"
              title={node.nodeKey}
            >
              {shortNodeKey(node.nodeKey)}
            </span>
            <Badge tone={health.tone}>
              <IconStatusDot
                className={cn(
                  "h-3 w-3",
                  health.tone === "green"
                    ? "text-emerald-500"
                    : health.tone === "amber"
                      ? "text-amber-500"
                      : health.tone === "rose"
                        ? "text-rose-500"
                        : "text-muted",
                )}
              />
              {health.label}
            </Badge>
            {stale ? <Badge tone="rose">قطعِ ارتباط</Badge> : null}
            {!node.enrolled ? <Badge tone="amber">ثبت‌نام‌نشده</Badge> : null}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            <span className="text-pretty">{node.region ?? "منطقه‌ی نامشخص"}</span>
            {node.ipAddress ? (
              <span className="ltr-nums" dir="ltr">
                {" · "}
                {node.ipAddress}
              </span>
            ) : null}
          </p>
        </div>

        {/* صدورِ فرمان */}
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => run(() => issueCommandAction(node.id, "update"))}
          >
            <IconRefresh className="h-4 w-4" />
            به‌روزرسانی
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => issueCommandAction(node.id, "restart"))}
          >
            <IconPower className="h-4 w-4" />
            ری‌استارت
          </Button>
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
        <p className="text-xs font-semibold text-muted">
          کاربرانِ تخصیص‌یافته (
          <span className="ltr-nums">{toFaDigits(node.assignedUsers.length)}</span>)
        </p>
        {node.assignedUsers.length === 0 ? (
          <p className="mt-2 text-xs text-muted">
            هیچ کاربری به این سرور تخصیص نیافته است.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {node.assignedUsers.map((u) => (
              <li
                key={u.userId}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div
                    className="truncate text-sm font-medium"
                    dir="ltr"
                    title={u.email ?? u.name ?? undefined}
                  >
                    {u.email ?? u.name ?? "بدونِ ایمیل"}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {u.name ?? u.fullName ?? "بدونِ نام"}
                    {" · پلن: "}
                    {u.plan}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => unassignNodeAction(node.id, u.userId))}
                  className="shrink-0"
                >
                  <IconClose className="h-3.5 w-3.5" />
                  حذفِ تخصیص
                </Button>
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
            className="ltr-nums focus-ring min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2 text-xs outline-none transition-colors focus:border-brand"
            aria-label="شناسه‌ی کاربر برای تخصیص"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending || assignUserId.length === 0}
            onClick={() => {
              run(() => assignNodeAction(node.id, assignUserId));
              setAssignUserId("");
            }}
            className="shrink-0"
          >
            <IconPlus className="h-3.5 w-3.5" />
            تخصیص
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 px-3 py-2">
      <p className="text-pretty text-[11px] leading-4 text-muted">{label}</p>
      <p
        className={cn("mt-0.5 truncate text-sm font-bold", mono && "ltr-nums font-mono")}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
