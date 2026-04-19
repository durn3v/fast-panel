#!/usr/bin/env bash
# Генерация docker-compose.xray-ports.gen.yml: на сервере — через Docker (без Node на хосте),
# локально при наличии только Node — fallback на node.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GEN_NODE_IMAGE="${GEN_NODE_IMAGE:-node:22-bookworm-slim}"

if docker info >/dev/null 2>&1; then
  exec docker run --rm \
    -v "$ROOT:/work" \
    -w /work \
    -e XRAY_CONFIG_PATH \
    "$GEN_NODE_IMAGE" \
    node scripts/gen-xray-ports-compose.mjs
fi

if command -v node >/dev/null 2>&1; then
  exec node scripts/gen-xray-ports-compose.mjs
fi

echo "run-gen-xray-ports: нужен запущенный Docker (docker info) или Node.js на PATH" >&2
exit 1
