"use client";

/**
 * آپلودِ رزومه در راهنمای شروع — همان `UploadsPanel`ِ صفحه‌ی پروفایل، با این تفاوت که پس از
 * استخراجِ موفق، صفحه را تازه می‌کند تا گام «انجام شد» شود و خلاصه‌ی پروفایل دیده شود.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { UploadsPanel } from "@/components/dashboard/resume/uploads-panel";
import type { ClientResumeFile } from "@/components/dashboard/resume/profile-types";
import { Callout } from "@/components/dashboard/ui";
import type { CostEstimate } from "@/lib/billing/ui";

export function StartResumeUpload({
  files,
  parseCostEstimate,
  balanceToman,
}: {
  files: ClientResumeFile[];
  parseCostEstimate: CostEstimate | null;
  balanceToman: number;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {notice ? (
        <Callout tone="success" title="انجام شد">
          {notice}
        </Callout>
      ) : null}
      <UploadsPanel
        files={files}
        parseCostEstimate={parseCostEstimate}
        balanceToman={balanceToman}
        onParsed={() => {
          setNotice("اطلاعاتِ رزومه‌ات خوانده شد. می‌توانی به گامِ بعد بروی.");
          router.refresh();
        }}
        onNotice={setNotice}
      />
    </div>
  );
}
