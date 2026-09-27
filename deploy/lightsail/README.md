# Karjoo on AWS Lightsail

Production runs on the Lightsail box `3.212.80.123`, which it shares with 1xai and xray-market, since 2026-09-27. It depends on no other machine. Images are built on GitHub, and the database is backed up to Telegram.

## Layout on the box

`~/karjoo` holds the runtime files. The source checkout is `~/src/karjoo-ai`.

| file | what it is |
|---|---|
| `docker-compose.yml` | copy of `deploy/lightsail/docker-compose.yml` |
| `.env` | secrets (0600, never in git): the app's variables plus `POSTGRES_PASSWORD`, `CLOUDFLARE_TUNNEL_TOKEN` and `OPS_TELEGRAM_*` |
| `edge/default.conf` | copy of `deploy/lightsail/edge/default.conf` |
| `deploy/` | copies of `activate.sh`, `ci-deploy.sh` and `backup-telegram.sh`; `ci-deploy.log` is kept here |
| `ops/discovery-cron.sh` | copy of `scripts/discovery-cron.sh` |

```
tunnel karjoo-lightsail ─► edge :3000 (alias "app") ─► web
host cron ─► 127.0.0.1:3030 (edge) ─► /api/internal/top-up, every 10 min
app ─► onexai:8081 ─► 1xai-api:8081   (/v1 gateway and the HMAC-signed /svc wallet API)
```

The `karjoo-lightsail` tunnel belongs to the CodeNest Cloudflare account, which is also where the `1xai.ir` zone lives.

The `onexai` container is the only one attached to 1xai's network. It forwards one port, so the app itself can't reach 1xai's database.

Volumes:

- `db_data`
- `uploads`: resume files, mounted at `/app/uploads`
- `catalogs`: the `.karjoo-runtime/catalogs` disk cache

## Sharing the box with 1xai

1xai owns this box. Every container of this project runs in `sideprojects.slice` (`/etc/systemd/system/sideprojects.slice`), together with the other side projects:

- **CPU:** one core for all side projects together (`CPUQuota=100%`), and a fifth of 1xai's CPU weight when the two compete.
- **Memory:** 3.5 GB for all side projects together (`MemoryMax`, soft limit 3 GB).
- **Out-of-memory:** these containers are killed first (`oom_score_adj` 300–500), so a runaway can't take down 1xai or the box.

Docker and containerd themselves run at a lower CPU weight, so an image pull yields to running containers.

Deploys are deliberately plain: the app restarts, so there are a few seconds of 502s. Zero-downtime blue/green is 1xai's alone.

## Deploys

A push to `main` runs `.github/workflows/deploy-lightsail.yml`. The image is built on GitHub, never on this box. GitHub then SSHes to the box with a key that can only run `deploy/ci-deploy.sh`.

`ci-deploy.sh` is polite:

1. It runs at the lowest priority.
2. It waits for any other side-project deploy, and for 1xai's own deploy lock, then holds that lock while it pulls and restarts, so it never overlaps a 1xai deploy.
3. It tags the running build `:previous`, pulls the new one as `:latest`, and hands over to `activate.sh`.

`activate.sh` runs `npm run db:migrate` from the new image; if that fails, nothing changes. It then recreates `web`, waits for `/api/extension/version`, and runs `refresh-content.mjs`. GitHub builds can't reach ITMaster, so `/blog` and the other ITMaster-fed pages are refreshed after the restart.

If the new build is unhealthy, `activate.sh` recreates the app from `:previous` and alerts on Telegram.

**Roll back:** `ssh lightsail ~/karjoo/deploy/activate.sh --rollback`. This swaps `:latest` and `:previous`. It doesn't undo a schema change.

**Changing compose, edge or cron files:** CI doesn't copy these. Edit the file here and merge it. Then copy it into `~/karjoo` and check it with `docker compose config -q`. Apply it with `docker compose up -d --no-deps <svc>`.

## Backups

These are the cron jobs in the `ubuntu` crontab (see `backup-telegram.sh`):

- **hourly:** the whole database except `raw_listings` rows, sent to Telegram
- **daily:** a full dump in 45 MB parts, also kept for 7 days in `~/backups/karjoo`
- **weekly:** a restore drill

The key is `KARJOO_BACKUP_KEY`. Keep a copy of it off this box.
