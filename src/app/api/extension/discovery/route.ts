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
    return json({
      board: "jobinja",
      paused: filters.paused,
      hasTargeting,
      searchUrl: hasTargeting
        ? buildSearchUrl({ ...prefs, sort: "published_at_desc" }, 1)
        : null,
      maxAgeDays: 45,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const body = await parseJsonBody(request, browserDiscoveryImportSchema);
    const listings: JobListing[] = body.listings.map((item) => ({
      id: `jobinja:${item.externalId}`,
      board: "jobinja",
      externalId: item.externalId,
      title: item.title,
      company: item.company ?? undefined,
      city: item.city ?? undefined,
      url: item.url,
      description: item.description ?? undefined,
      salary: item.salary ?? undefined,
      postedAt: item.postedAt,
      applyType: "structured",
    }));
    return json(await enqueueBrowserDiscoveredListings(userId, listings));
  });
}
