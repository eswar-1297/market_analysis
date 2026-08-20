#!/usr/bin/env bash
# Runs ON THE SERVER via ssh. Builds the new image under a throwaway tag.
# Never touches the currently running container — if this fails, production
# is completely untouched.
set -euo pipefail

SHA="$1"
# Hotjar Site ID, passed through from the HOTJAR_SITE_ID GitHub Actions repository
# variable. Optional: blank means the bundle is built with Hotjar off, which is the
# correct behaviour when the variable is unset. Not a secret -- it ships inside the
# client-side JavaScript either way, so it belongs in a variable, not a secret.
HOTJAR_SITE_ID="${2:-}"
DEPLOY_DIR="/opt/market_analysis"
IMAGE="market-analysis"

cd "$DEPLOY_DIR"
# The build arg must be named VITE_HOTJAR_SITE_ID to match the ARG in the Dockerfile;
# Vite only exposes VITE_-prefixed vars to the client bundle.
docker build \
  --build-arg "VITE_HOTJAR_SITE_ID=${HOTJAR_SITE_ID}" \
  -t "${IMAGE}:candidate-${SHA}" .
