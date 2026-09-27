# Karjoo on AWS Lightsail

Production runs on the Lightsail box `3.212.80.123`, which it shares with 1xai and xray-market, since 2026-09-27. It depends on no other machine. Images are built on GitHub, and the database is backed up to Telegram.

## Layout on the box

`~/karjoo` holds the runtime files. The source checkout is `~/src/karjoo-ai`.

| file | what it is |
|---|---|
| `docker-compose.yml` | copy of `deploy/lightsail/docker-compose.yml` |
| `.env` | secrets (0600, never in git): the app's variables plus `POSTGRES_PASSWORD`, `CLOUDFLARE_TUNNEL_TOKEN` and `OPS_TELEGRAM_*` |
| `edge/default.conf` | copy of `deploy/lightsail/edge/default.conf` |
| `edge/upstream.inc` | names the live slot; written by `activate.sh` |
| `deploy/` | copies of `activate.sh`, `ci-deploy.sh` and `backup-telegram.sh`; `ci-deploy.log` is kept here |
| `ops/discovery-cron.sh` | copy of `scripts/discovery-cron.sh` |

```
tunnel karjoo-lightsail ─► edge :3000 (alias "app") ─► app_blue | app_green
host cron ─► 127.0.0.1:3030 (edge) ─► /api/internal/top-up, every 10 min
app ─► onexai:8081 ─► 1xai-api:8081   (/v1 gateway and the HMAC-signed /svc wallet API)
```

The `karjoo-lightsail` tunnel belongs to the CodeNest Cloudflare account, which is also where the `1xai.ir` zone lives.

The `onexai` container is the only one attached to 1xai's network. It forwards one port, so the app itself can't reach 1xai's database.

Volumes:

- `db_data`
- `uploads`: resume files, mounted at `/app/uploads`
- `catalogs`: the `.karjoo-runtime/catalogs` disk cache

## Deploys

A push to `main` runs `.github/workflows/deploy-lightsail.yml`. Docs and `deploy/` changes are skipped. The workflow does this:

1. GitHub builds the `Dockerfile` into `ghcr.io/codedpro/karjoo:<sha>`. The build includes the browser-extension zip, created from `extension/`.
2. The deploy job SSHes to the box with a key whose only permitted command is `deploy/ci-deploy.sh`.
3. `activate.sh` then:
   1. runs `npm run db:migrate` from the new image
   2. starts the new image in the idle slot
   3. waits until `/api/extension/version` answers
   4. switches the edge to the new slot
   5. checks `https://karjoo.1xai.ir` and switches back if the check fails
   6. drains the old slot and stops it

Any failure is reported on Telegram.

**Rolling back:** run `ssh lightsail ~/karjoo/deploy/activate.sh --rollback`. This does not undo migrations.

**Changing compose or edge files:** edit the file here and merge it. Then copy it into `~/karjoo` and check it with `docker compose config -q`. Apply only the service you changed, with `docker compose up -d --no-deps <svc>`. Never run a bare `up -d`: it would start both slots.

**Remote fleet workers** (`scripts/deploy-worker.sh`) run on Iranian nodes and reach the control plane at `https://karjoo.1xai.ir`. They are not deployed from this box.

## Backups

These are the cron jobs in the `ubuntu` crontab (see `backup-telegram.sh`):

- **hourly:** the whole database except `raw_listings` rows, sent to Telegram
- **daily:** a full dump in 45 MB parts, also kept for 7 days in `~/backups/karjoo`
- **weekly:** a restore drill

The key is `KARJOO_BACKUP_KEY`. Keep a copy of it off this box.
