import { BOARD_LABELS } from "@/components/dashboard/labels";
import type { ProviderProfileView } from "@/components/dashboard/provider-profile-data";
import { Badge, Card, toFaDigits } from "@/components/dashboard/ui";
import { IconBuilding, IconMapPin, IconPlug, IconTarget, IconUser } from "@/components/dashboard/icons";

const STATUS = {
  connected: { label: "متصل", tone: "green" as const },
  needs_reauth: { label: "نیازمند ورود", tone: "amber" as const },
  disconnected: { label: "متصل نیست", tone: "muted" as const },
};

function faDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProviderProfilesGrid({ providers }: { providers: ProviderProfileView[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {providers.map((provider) => {
        const state = STATUS[provider.status];
        const snapshot = provider.snapshot;
        return (
          <Card key={provider.board} padded className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                  <IconPlug className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold">{BOARD_LABELS[provider.board]}</h3>
                  <p className="truncate text-xs text-muted">
                    {provider.accountLabel ?? "حساب بدون نام نمایشی"}
                  </p>
                </div>
              </div>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>

            <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
              <div>
                <dt className="inline">آخرین اتصال: </dt>
                <dd className="inline text-foreground">{faDate(provider.lastConnectedAt) ?? "ثبت نشده"}</dd>
              </div>
              <div>
                <dt className="inline">آخرین همگام‌سازی: </dt>
                <dd className="inline text-foreground">{faDate(snapshot?.fetchedAt ?? null) ?? "انجام نشده"}</dd>
              </div>
            </dl>

            {snapshot ? (
              <div className="mt-5 border-t border-border pt-4">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <IconUser className="h-4 w-4 text-brand" />
                  <span className="truncate">{snapshot.fullName ?? "پروفایل واردشده"}</span>
                </div>
                {snapshot.headline ? <p className="mt-1 truncate text-sm text-muted">{snapshot.headline}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {snapshot.city ? (
                    <Badge tone="muted"><IconMapPin className="h-3 w-3" />{snapshot.city}</Badge>
                  ) : null}
                  {snapshot.yearsExperience !== null ? (
                    <Badge tone="muted">{toFaDigits(snapshot.yearsExperience)} سال سابقه</Badge>
                  ) : null}
                  {snapshot.experienceCount > 0 ? (
                    <Badge tone="muted"><IconBuilding className="h-3 w-3" />{toFaDigits(snapshot.experienceCount)} سابقه</Badge>
                  ) : null}
                </div>
                {snapshot.skills.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {snapshot.skills.map((skill) => <Badge key={skill} tone="brand">{skill}</Badge>)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 border-t border-border pt-4 text-sm text-muted">
                پروفایل این سایت هنوز از افزونه همگام نشده است.
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone={provider.targeting.enabled ? "green" : "muted"}>
                  <IconTarget className="h-3 w-3" />
                  {provider.targeting.enabled ? "هدف‌گیری روشن" : "هدف‌گیری خاموش"}
                </Badge>
                <Badge tone="muted">{toFaDigits(provider.targeting.categoryCount)} دسته</Badge>
                {provider.targeting.remoteOnly ? <Badge tone="accent">دورکاری</Badge> : null}
              </div>
              <a
                href={snapshot?.publicUrl ?? provider.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="focus-ring rounded-full text-xs font-semibold text-brand hover:underline"
              >
                باز کردن پروفایل
              </a>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
