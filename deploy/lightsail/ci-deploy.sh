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
# Pulls ghcr.io/codedpro/karjoo:<sha>, tags it karjoo:latest and hands over to
# activate.sh (migrations, then zero-downtime blue/green, Telegram alert on
# failure). One deploy at a time (flock).
set -euo pipefail
REG=ghcr.io/codedpro
RT=/home/ubuntu/karjoo
cd "$RT"
LOG=$RT/deploy/ci-deploy.log

exec 9>/tmp/karjoo-ci-deploy.lock
flock -w 900 9 || { echo "another deploy held the lock for 15 min — giving up" >&2; exit 75; }

cmd=${SSH_ORIGINAL_COMMAND:-}
if [[ ! $cmd =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    echo "refused: '$cmd'" >&2
    exit 2
fi
SHA=${BASH_REMATCH[1]}
read -r REG_USER
read -r REG_TOKEN
say() { echo "[$(date -u +%H:%M:%S)] $*"; }

# A private docker config for this pull only, so a concurrent deploy of another
# project never logs us out mid-pull.
CFG=$(mktemp -d)
trap 'sudo rm -rf "$CFG"' EXIT
printf '%s' "$REG_TOKEN" | sudo docker --config "$CFG" login ghcr.io -u "$REG_USER" --password-stdin >/dev/null
say "pull $REG/karjoo:${SHA:0:12}"
sudo docker --config "$CFG" pull -q "$REG/karjoo:$SHA" >/dev/null
sudo docker tag "$REG/karjoo:$SHA" karjoo:latest

if bash "$RT/deploy/activate.sh"; then
    echo "$(date -u +%FT%TZ) OK $SHA" >> "$LOG"
else
    echo "$(date -u +%FT%TZ) FAILED $SHA (previous version still live)" >> "$LOG"
    exit 1
fi

# Disk: keep the 3 newest pulled builds (the live one and the one in the idle
# slot are among them), drop the rest.
sudo docker images "$REG/karjoo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
    | sort -r | tail -n +4 | cut -f2 | xargs -r sudo docker rmi >/dev/null 2>&1 || true
sudo docker image prune -f >/dev/null 2>&1 || true
say "deployed ${SHA:0:12}"
