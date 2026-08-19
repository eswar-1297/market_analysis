#!/usr/bin/env bash
# Runs ON THE SERVER via ssh. Builds the new image under a throwaway tag.
# Never touches the currently running container — if this fails, production
# is completely untouched.
set -euo pipefail

SHA="$1"
DEPLOY_DIR="/opt/market_analysis"
IMAGE="market-analysis"

cd "$DEPLOY_DIR"
docker build -t "${IMAGE}:candidate-${SHA}" .
