import "server-only";

/**
 * /api/fleet/discovery — کشفِ ۲۴/۷ آگهی روی نودِ ناوگان.
 *
 *   GET  → کاربرانی از *همین نود* که الان نوبتِ کشفشان است، با مشخصاتِ جست‌وجوی هر
 *          سایت. نوبت اتمیک برداشته می‌شود، پس یک کاربر دوبار به دو نود داده نمی‌شود.
 *   POST → نتیجه‌ی کشف:
 *          { scope: "user",    userId, board, listings }  → صفِ همان کاربر
 *          { scope: "catalog",         board, listings }  → فقط کاتالوگِ عمومی
 *
 * نود همیشه از اعتبارنامه‌اش شناخته می‌شود (requireNodeCredential)، هرگز از بدنه؛ و
 * userIdِ بدنه باید به همان نود تخصیص یافته باشد — ingestFleetDiscovery این را
 * بررسی می‌کند. این مسیر هیچ نشستی را برنمی‌گرداند: کشف ناشناس است.
 */
import { z } from "zod";

import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireNodeCredential } from "@/lib/api/fleet-auth";
import { browserDiscoveredListingSchema } from "@/lib/api/extension-schemas";
import {
  claimFleetDiscovery,
  ingestFleetCatalog,
  ingestFleetDiscovery,
} from "@/lib/fleet/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const board = z.enum(["jobinja", "jobvision", "e-estekhdam", "irantalent", "karboom"]);
const listings = z.array(browserDiscoveredListingSchema).max(100);

const ingestBodySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("user"), userId: z.string().uuid(), board, listings }).strict(),
  z.object({ scope: z.literal("catalog"), board, listings }).strict(),
]);

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const node = await requireNodeCredential(request);
    const users = await claimFleetDiscovery(node.id);
    return json({ users });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const node = await requireNodeCredential(request);
    const body = await parseJsonBody(request, ingestBodySchema);
    if (body.scope === "user") {
      return json(await ingestFleetDiscovery(node.id, body.userId, body.board, body.listings));
    }
    return json(await ingestFleetCatalog(body.board, body.listings));
  });
}
