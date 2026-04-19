#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/YOU/super-vpn-panel.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/super-vpn-panel}"
BRANCH="${BRANCH:-main}"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root: curl ... | sudo bash" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq git ca-certificates curl openssl
fi

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH" || true
  git -C "$INSTALL_DIR" checkout "$BRANCH" || true
  git -C "$INSTALL_DIR" pull --ff-only || true
fi

cd "$INSTALL_DIR"

if command -v systemctl >/dev/null 2>&1; then
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
fi

ENV_CREATED=0
if [[ ! -f .env ]]; then
  ENV_CREATED=1
  API_KEY="$(openssl rand -hex 32)"
  PG_PASS="$(openssl rand -hex 24)"
  cat >.env <<EOF
API_KEY=${API_KEY}
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=postgres://vpn:${PG_PASS}@postgres:5432/vpn
XRAY_API_HOST=xray
XRAY_API_PORT=10085
XRAY_PROTO_ROOT=/app/xray-core
PORT=3000
TRAFFIC_SYNC_INTERVAL_MS=60000
EOF
fi

mkdir -p config/xray
if [[ ! -f config/xray/config.json ]]; then
  cp config/xray/config.example.json config/xray/config.json
fi

if [[ "$ENV_CREATED" -eq 1 ]]; then
  echo ""
  echo "=========================================="
  echo "SAVE THESE SECRETS (shown once):"
  echo "=========================================="
  grep -E '^API_KEY=|^POSTGRES_PASSWORD=' .env || true
  echo "=========================================="
  echo "DATABASE_URL is already set in .env for Docker Compose."
  echo "=========================================="
else
  echo ""
  echo ".env already exists — secrets were not regenerated."
fi

chmod +x scripts/vpn-panel 2>/dev/null || true

# Сгенерировать compose с портами из config (чтобы первый ручной docker compose не без портов)
if command -v node >/dev/null 2>&1; then
  (cd "$INSTALL_DIR" && node scripts/gen-xray-ports-compose.mjs) || true
fi

PRIMARY_IP=""
if command -v hostname >/dev/null 2>&1; then
  PRIMARY_IP="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Дальнейшие шаги (каталог установки: $INSTALL_DIR)"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "  1) Настройте Xray: inbounds, Reality, порты слушания."
echo "     Файл:"
echo "        $INSTALL_DIR/config/xray/config.json"
echo "     Порты из inbounds[] попадут в Docker при следующем запуске vpn-panel"
echo "     (файл $INSTALL_DIR/docker-compose.xray-ports.gen.yml)."
echo ""
echo "  2) При необходимости отредактируйте окружение панели:"
echo "        $INSTALL_DIR/.env"
echo ""
echo "  3) Запустите контейнеры:"
echo "        $INSTALL_DIR/scripts/vpn-panel start"
echo ""
echo "  4) Проверка здоровья панели (после start, порт 3000 в compose):"
echo "        curl -sS http://127.0.0.1:3000/health"
if [[ -n "$PRIMARY_IP" ]]; then
  echo "     С другой машины в вашей сети (если порт 3000 доступен):"
  echo "        curl -sS http://${PRIMARY_IP}:3000/health"
fi
echo "     OpenAPI без ключа:"
echo "        curl -sS http://127.0.0.1:3000/openapi.yaml | head"
echo ""
echo "  5) Запросы к API — заголовок X-API-Key из строки API_KEY в:"
echo "        $INSTALL_DIR/.env"
echo ""
echo "  Опционально — команда vpn-panel в PATH:"
echo "        ln -sf $INSTALL_DIR/scripts/vpn-panel /usr/local/bin/vpn-panel"
echo "        vpn-panel start"
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "  Внимание: для «$INSTALL_DIR/scripts/vpn-panel» на хосте нужен Node.js (>=20),"
  echo "  он вызывает генерацию портов. Установите node и повторите:"
  echo "        $INSTALL_DIR/scripts/vpn-panel start"
  echo ""
fi
echo "════════════════════════════════════════════════════════════════"
