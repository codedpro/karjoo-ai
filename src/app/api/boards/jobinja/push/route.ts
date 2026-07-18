import "server-only";

/**
 * POST /api/boards/jobinja/push  (افزونه، Bearer)
 *
 * مسیرِ *اصلیِ* همگام‌سازیِ تحلیل/پروفایل: افزونه صفحه‌ی جابینجا را same-origin می‌خواند و
 * داده‌ی *پارس‌شده* (نه کوکی/توکن) را اینجا push می‌کند. §10: هیچ اعتبارنامه‌ای پذیرفته نمی‌شود.
 */
import { z } from "zod";

import { json, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import {
  normalizeApplicationStatus,
  upsertApplications,
  upsertProfileSnapshot,
  type ParsedProfile,
} from "@/lib/apply/boards/jobinja-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** کلیدهای شبیهِ اعتبارنامه که هرگز نباید در payloadِ پروفایل باشند (§10). */
const CREDENTIAL_KEYS = /(cookie|token|password|jsessid|remember|secret|session|auth|bearer)/i;

const pushSchema = z
  .object({
    applications: z
      .array(
        z.object({
          externalId: z.string().min(1).max(64),
          title: z.string().max(300).nullish(),
          company: z.string().max(200).nullish(),
          url: z.string().max(500).nullish(),
          statusRaw: z.string().max(120).nullish(),
          statusCategory: z.enum(["pending", "review", "interview", "rejected", "other"]).nullish(),
        }),
      )
      .max(2000)
      .optional(),
    profile: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const body = pushSchema.parse(await request.json());

    let applications = 0;
    if (body.applications?.length) {
      const apps = body.applications.map((a) => ({
        externalId: a.externalId,
        title: a.title ?? null,
        company: a.company ?? null,
        url: a.url ?? null,
        statusRaw: a.statusRaw ?? null,
        statusCategory: a.statusCategory ?? normalizeApplicationStatus(a.statusRaw),
      }));
      applications = await upsertApplications(userId, "jobinja", apps);
    }

    let profile = false;
    if (body.profile && Object.keys(body.profile).length > 0) {
      // دفاع در عمق: هر کلیدِ شبیهِ اعتبارنامه را دور بریز.
      const clean: ParsedProfile = {};
      for (const [k, v] of Object.entries(body.profile)) {
        if (CREDENTIAL_KEYS.test(k)) continue;
        clean[k] = v as unknown;
      }
      if (Object.keys(clean).length > 0) {
        await upsertProfileSnapshot(userId, "jobinja", clean);
        profile = true;
      }
    }

    return json({ ok: true, applications, profile }, 202);
  });
}
