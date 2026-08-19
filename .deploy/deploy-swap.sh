#!/usr/bin/env bash
# Runs ON THE SERVER via ssh. Only called after deploy-build.sh has already
# succeeded. Tags the currently running image as ":previous" (so Layer 1
# rollback can find it), then swaps the new image in.
set -euo pipefail

SHA="$1"
DEPLOY_DIR="/opt/market_analysis"
IMAGE="market-analysis"

cd "$DEPLOY_DIR"

if docker image inspect "${IMAGE}:latest" >/dev/null 2>&1; then
  docker tag "${IMAGE}:latest" "${IMAGE}:previous"
else
  echo "No existing ${IMAGE}:latest image found — this looks like the first deploy, so there is no :previous to preserve."
fi

docker tag "${IMAGE}:candidate-${SHA}" "${IMAGE}:latest"

docker stop "${IMAGE}" >/dev/null 2>&1 || true
docker rm "${IMAGE}" >/dev/null 2>&1 || true

docker run -d \
  --name "${IMAGE}" \
  --restart unless-stopped \
  --env-file "${DEPLOY_DIR}/.env" \
  -p 127.0.0.1:1009:4000 \
  "${IMAGE}:latest"
