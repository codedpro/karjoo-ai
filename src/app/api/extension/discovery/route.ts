import "server-only";

import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { browserDiscoveryImportSchema } from "@/lib/api/extension-schemas";
import { readApplyFilters, readJobPreferences } from "@/lib/apply/filters";
import { discoveryBoardSpecs, toJobListings } from "@/lib/apply/discovery-specs";
import { enqueueBrowserDiscoveredListings } from "@/lib/apply/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const [filters, prefs] = await Promise.all([
      readApplyFilters(userId),
      readJobPreferences(userId),
    ]);
    // Same targeting the server fleet uses — one definition in discovery-specs.
    return json({
      paused: filters.paused,
      maxAgeDays: filters.maxAgeDays,
      boards: discoveryBoardSpecs(filters, prefs),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const body = await parseJsonBody(request, browserDiscoveryImportSchema);
    return json(
      await enqueueBrowserDiscoveredListings(userId, toJobListings(body.board, body.listings)),
    );
  });
}
