import "server-only";

import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { browserDiscoveryImportSchema } from "@/lib/api/extension-schemas";
import { buildSearchUrl } from "@/lib/apply/boards/jobinja";
import { readApplyFilters, readJobPreferences } from "@/lib/apply/filters";
import { enqueueBrowserDiscoveredListings } from "@/lib/apply/orchestrator";
import type { JobListing } from "@/lib/apply/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const [filters, prefs] = await Promise.all([
      readApplyFilters(userId),
      readJobPreferences(userId),
    ]);
    const hasTargeting = Boolean(
      prefs.categorySlugs?.length ||
        prefs.cities?.length ||
        prefs.jobTypes?.length ||
        prefs.titles?.length ||
        prefs.remoteOnly,
    );
    const jobvision = filters.boardFilters.jobvision;
    const eEstekhdam = filters.boardFilters["e-estekhdam"];
    const irantalent = filters.boardFilters.irantalent;
    return json({
      paused: filters.paused,
      maxAgeDays: filters.maxAgeDays,
      boards: [
        {
          board: "jobinja",
          enabled: filters.boardFilters.jobinja.enabled,
          hasTargeting,
          searchUrl: hasTargeting
            ? buildSearchUrl({ ...prefs, sort: "published_at_desc" }, 1)
            : null,
        },
        {
          board: "jobvision",
          enabled: jobvision.enabled,
          hasTargeting: jobvision.categoryKeys.length > 0 || jobvision.remoteOnly || jobvision.employmentTypeKeys.length > 0,
          categoryKeys: jobvision.categoryKeys,
          employmentTypeKeys: jobvision.employmentTypeKeys,
          remoteOnly: jobvision.remoteOnly,
        },
        {
          board: "e-estekhdam",
          enabled: eEstekhdam.enabled,
          hasTargeting:
            eEstekhdam.categoryKeys.length > 0 ||
            eEstekhdam.cities.length > 0 ||
            eEstekhdam.remoteOnly ||
            eEstekhdam.employmentTypeKeys.length > 0,
          categoryKeys: eEstekhdam.categoryKeys,
          cities: eEstekhdam.cities,
          employmentTypeKeys: eEstekhdam.employmentTypeKeys,
          remoteOnly: eEstekhdam.remoteOnly,
        },
        {
          board: "irantalent",
          enabled: irantalent.enabled,
          hasTargeting:
            irantalent.categoryKeys.length > 0 ||
            irantalent.remoteOnly ||
            irantalent.employmentTypeKeys.length > 0,
          categoryKeys: irantalent.categoryKeys,
          employmentTypeKeys: irantalent.employmentTypeKeys,
          remoteOnly: irantalent.remoteOnly,
        },
      ],
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const body = await parseJsonBody(request, browserDiscoveryImportSchema);
    const listings: JobListing[] = body.listings
      .filter((item) => item.alreadyApplied !== true)
      .map((item) => ({
      id: `${body.board}:${item.externalId}`,
      board: body.board,
      externalId: item.externalId,
      title: item.title,
      company: item.company ?? undefined,
      city: item.city ?? undefined,
      url: item.url,
      description: [
        item.description ?? undefined,
        item.gender ? `جنسیت: ${item.gender}` : undefined,
      ].filter(Boolean).join("\n") || undefined,
      salary: item.salary ?? undefined,
      postedAt: item.postedAt,
    }));
    return json(await enqueueBrowserDiscoveredListings(userId, listings));
  });
}
