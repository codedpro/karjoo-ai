#!/usr/bin/env bash
# Deploy entrypoint on AWS Lightsail for GitHub Actions
# (.github/workflows/deploy-lightsail.yml).
#
# Installed as ~/karjoo/deploy/ci-deploy.sh and bound to the CI deploy key as a
# FORCED COMMAND in ~/.ssh/authorized_keys:
#
#   restrict,command="/home/ubuntu/karjoo/deploy/ci-deploy.sh" ssh-ed25519 … karjoo-ci-deploy
#
# so that key can do exactly one thing: run this script. Its only input:
#   SSH_ORIGINAL_COMMAND  "deploy <40-hex commit sha>"
#   stdin line 1          registry user   (github.actor)
#   stdin line 2          registry token  (the workflow's short-lived GITHUB_TOKEN,
#                                          packages:read — dies with the job)
#
# 1xai owns this box, so a side-project deploy is polite:
#   · it runs at the lowest CPU/IO priority (nice/ionice);
#   · it waits for any other side-project deploy AND for 1xai's own deploy lock,
#     and holds 1xai's lock while it pulls and restarts — the two never overlap;
#   · image pulls only fetch changed layers (see the Dockerfile's layer split).
# Pulls ghcr.io/codedpro/karjoo:<sha>, keeps the running build as karjoo:previous, tags the new one
# karjoo:latest and hands over to activate.sh.
set -euo pipefail
[ "${XDEPLOY_NICED:-}" = 1 ] || XDEPLOY_NICED=1 exec nice -n 15 ionice -c 3 "$0" "$@"
REG=ghcr.io/codedpro
RT=/home/ubuntu/karjoo
cd "$RT"
LOG=$RT/deploy/ci-deploy.log

cmd=${SSH_ORIGINAL_COMMAND:-}
if [[ ! $cmd =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    echo "refused: '$cmd'" >&2
    exit 2
fi
SHA=${BASH_REMATCH[1]}
read -r REG_USER
read -r REG_TOKEN
say() { echo "[$(date -u +%H:%M:%S)] $*"; }

exec 8>/tmp/sideprojects-deploy.lock
flock -w 1500 8 || { echo "another side-project deploy held the lock for 25 min — giving up" >&2; exit 75; }
exec 9>/tmp/1xai-ci-deploy.lock
say "waiting for any 1xai deploy to finish"
flock -w 1500 9 || { echo "1xai's deploy lock stayed busy for 25 min — giving up" >&2; exit 75; }

# A private docker config for this pull only.
CFG=$(mktemp -d)
trap 'sudo rm -rf "$CFG"' EXIT
printf '%s' "$REG_TOKEN" | sudo docker --config "$CFG" login ghcr.io -u "$REG_USER" --password-stdin >/dev/null
say "pull $REG/karjoo:${SHA:0:12}"
sudo docker --config "$CFG" pull -q "$REG/karjoo:$SHA" >/dev/null
sudo docker tag karjoo:latest karjoo:previous 2>/dev/null || true
sudo docker tag "$REG/karjoo:$SHA" karjoo:latest

if bash "$RT/deploy/activate.sh"; then
    echo "$(date -u +%FT%TZ) OK $SHA" >> "$LOG"
else
    echo "$(date -u +%FT%TZ) FAILED $SHA (previous version kept/restored)" >> "$LOG"
    exit 1
fi

# Disk: keep the 2 newest pulled builds per image (the running one and
# :previous), drop the rest.
for img in karjoo; do
    sudo docker images "$REG/$img" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
        | sort -r | tail -n +3 | cut -f2 | xargs -r sudo docker rmi >/dev/null 2>&1 || true
done
sudo docker image prune -f >/dev/null 2>&1 || true
say "deployed ${SHA:0:12}"
