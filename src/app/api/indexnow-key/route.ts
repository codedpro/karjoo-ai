import { createIndexNowKeyRoute } from "@itmaster/sdk/next";

/**
 * IndexNow key file for karjooai.itmaster.uk (engine site "karjoo-ai").
 *
 * SDK-first: the key is DERIVED by @itmaster/sdk (matches the engine), so this route
 * serves the exact key the engine submits — no stored secret, no round-trip.
 * `middleware.ts` rewrites `/{32-hex}.txt` here.
 */
export const GET = createIndexNowKeyRoute(process.env.PUBLISH_SITE ?? "karjoo-ai");
