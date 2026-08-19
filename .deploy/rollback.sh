#!/usr/bin/env bash
# Runs ON THE SERVER via ssh. Layer 1 (seconds) automatic recovery: restores
# the ":previous" image immediately. Never touches git — this is pure Docker.
set -euo pipefail

DEPLOY_DIR="/opt/market_analysis"
IMAGE="market-analysis"

if ! docker image inspect "${IMAGE}:previous" >/dev/null 2>&1; then
  echo "No ${IMAGE}:previous image exists — cannot roll back automatically (likely the very first deploy). Manual intervention required." >&2
  exit 1
fi

docker stop "${IMAGE}" >/dev/null 2>&1 || true
docker rm "${IMAGE}" >/dev/null 2>&1 || true

docker tag "${IMAGE}:previous" "${IMAGE}:latest"

docker run -d \
  --name "${IMAGE}" \
  --restart unless-stopped \
  --env-file "${DEPLOY_DIR}/.env" \
  -p 127.0.0.1:1009:4000 \
  "${IMAGE}:latest"
