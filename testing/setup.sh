#!/usr/bin/env bash
# Build the node, pack it, and start (or restart) a local n8n with it installed.
#
#   ./testing/setup.sh            start with the current source
#   ./testing/setup.sh --fresh    also wipe n8n data (owner account, credentials, workflows)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTING="$ROOT/testing"
COMPOSE=(docker compose -f "$TESTING/docker-compose.yml")

cd "$ROOT"
echo "==> Building"
npm run build >/dev/null

echo "==> Packing"
mkdir -p "$TESTING/pkg"
rm -f "$TESTING"/pkg/*.tgz
TGZ=$(npm pack --pack-destination "$TESTING/pkg" 2>/dev/null | tail -1)
mv "$TESTING/pkg/$TGZ" "$TESTING/pkg/package.tgz"
echo "    $TESTING/pkg/package.tgz"

if [ "${1:-}" = "--fresh" ]; then
  echo "==> Removing previous n8n data"
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
fi

echo "==> Starting n8n"
"${COMPOSE[@]}" up -d --force-recreate

echo "==> Waiting for http://localhost:5678/healthz"
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:5678/healthz >/dev/null 2>&1; then
    echo "    n8n is up: http://localhost:5678"
    exit 0
  fi
  sleep 2
done
echo "n8n did not become healthy in time; check: ${COMPOSE[*]} logs" >&2
exit 1
