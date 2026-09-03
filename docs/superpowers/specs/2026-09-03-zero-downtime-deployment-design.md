# Zero-Downtime Karjoo Deployment

## Goal

Karjoo deployments must not return `502`, blank pages, or unstyled pages. A failed release must leave the currently healthy release serving traffic, and the previous release must remain available for immediate rollback.

## Incident

The current deployment builds into the live `.next` directory and then restarts the only process listening on port `3030`. This creates two independent failure windows:

1. `docker compose restart web` leaves Cloudflare without an origin until Next starts again, producing `502`.
2. A build replaces hashed files in `.next/static` while Cloudflare may still serve cached HTML from the previous release. That HTML then requests deleted CSS and JavaScript chunks and renders blank or unstyled.

The September 3 incident exhibited both behaviors. The process itself did not crash and was not OOM-killed.

## Approaches Considered

### Single process plus cache purge

Build, restart, and purge Cloudflare. This fixes stale HTML after a successful deploy but retains the restart outage and mutates the files used by the live process.

### Disable HTML caching only

This reduces stale-shell risk but does not protect against process restart, failed startup, or in-place build mutation.

### Health-gated blue-green slots

Keep a stable proxy on `3030`, run immutable blue and green Next slots behind it, and switch only after the inactive slot passes health and asset checks. Retain the old slot for rollback and purge Cloudflare only after switching. This is the selected approach.

## Topology

- `karjoo-proxy` is a small Nginx container using host networking and permanently owns port `3030`.
- `karjoo-web-blue` listens on `3031` and reads `.next-blue`.
- `karjoo-web-green` listens on `3032` and reads `.next-green`.
- The Cloudflare tunnel remains unchanged and continues targeting the host on port `3030`.
- A runtime state directory, ignored by Git, contains the active slot and the generated Nginx upstream file.

Both app slots use the existing repository, dependencies, environment, database, and persistent resume storage. Only their compiled Next output directories differ. `next.config.ts` reads `KARJOO_NEXT_DIST_DIR`, defaulting to `.next` for ordinary local development and tests.

## Deployment Flow

1. Acquire an exclusive deployment lock.
2. Read the active slot and choose the inactive slot.
3. Build into the inactive slot's distinct Next output directory. The active slot's files are never modified.
4. Start or recreate only the inactive app container.
5. Poll its local `/api/extension/version` endpoint with a strict timeout.
6. Fetch representative HTML from the inactive slot and verify every referenced local CSS and JavaScript asset returns `200` from that same slot.
7. Atomically replace the generated Nginx upstream file, gracefully reload Nginx, and atomically record the new active slot. The upstream file itself remains the recovery source of truth if the deploy process is interrupted.
8. Verify the public root, login page, dashboard redirect, and extension-version endpoint.
9. Purge Cloudflare using the existing scoped API credentials.
10. Fetch public HTML again and verify its referenced CSS and JavaScript assets return `200`.
11. Keep the former slot running as the hot rollback target.

Any failure before step 7 leaves traffic untouched. Any failure after switching immediately restores the previous upstream and active-slot state, gracefully reloads Nginx, and exits unsuccessfully.

## Cloudflare Cache Safety

The deploy command always purges Cloudflare after a successful origin switch. This is mandatory because the current zone cache rules can cache HTML despite application `private, no-cache` headers.

The old slot stays available after the switch, and its build directory is not deleted. Therefore, requests for old hashed chunks remain valid during browser and edge-cache transition. A later deployment may replace only the inactive slot after it is no longer serving traffic.

## Process Recovery

Both app slots and the proxy use `restart: always`. Nginx has the active slot as primary and the previous slot as a backup upstream, so an unexpected active-process connection failure falls through to the previous healthy release. Container health checks expose unhealthy slots to Docker and deployment diagnostics.

The proxy configuration uses short connection timeouts and conservative response timeouts. It forwards the original host, protocol, IP, and WebSocket upgrade headers required by Next.js.

## Initial Migration

The current single app owns port `3030`, which the new stable proxy must take over. Migration proceeds by building and starting blue on `3031`, validating it, then stopping the old app and immediately starting the already-configured proxy on `3030`. This is a one-time controlled handoff; future releases do not stop the proxy.

After the handoff, public and asset checks run immediately. If proxy startup fails, the migration restarts the old single app on `3030`.

## Commands And Ownership

- `scripts/deploy-web.sh` is the only supported production deployment command.
- Direct `docker compose restart web` is removed from documentation and is no longer part of deployment.
- `scripts/verify-web-release.sh` performs local and public route/asset checks and can run independently.
- The deployment script never prints secrets or Cloudflare credentials.

## Tests

- Validate the compose configuration and Nginx syntax.
- Build into an inactive dist directory while the active public site is continuously polled.
- Verify the inactive health endpoint and every emitted HTML asset.
- Switch blue to green and green to blue while a high-frequency public probe records status codes; require zero non-2xx/3xx responses.
- Simulate an unhealthy inactive slot and prove traffic remains on the active slot.
- Stop the active app and verify Nginx falls back to the previous slot.
- Confirm Cloudflare returns fresh HTML and all referenced assets return `200`.
- Confirm both app slots and the proxy recover after container restart.

## Success Criteria

- Ordinary deployments produce zero failed public probes.
- No deployment mutates the active slot's build directory.
- Cloudflare never serves HTML whose local CSS or JavaScript assets return `404` after deployment.
- Failed builds and unhealthy inactive releases never receive traffic.
- The previous release can be restored with one atomic proxy reload.
