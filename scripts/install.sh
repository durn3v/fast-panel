#!/usr/bin/env bash
# Установка панели: только Ubuntu 24.04+ / 25.x (server).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/YOU/super-vpn-panel.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/super-vpn-panel}"
BRANCH="${BRANCH:-main}"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Запустите от root: curl ... | sudo bash" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Не найден /etc/os-release — скрипт рассчитан на Ubuntu." >&2
  exit 1
fi
# shellcheck source=/dev/null
source /etc/os-release

if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "Этот установщик поддерживает только Ubuntu. Сейчас: ID=${ID:-?}" >&2
  exit 1
fi

UBUNTU_MAJOR="${VERSION_ID%%.*}"
if [[ "$UBUNTU_MAJOR" != "24" && "$UBUNTU_MAJOR" != "25" ]]; then
  echo "Этот установщик поддерживает только Ubuntu 24.x и 25.x. Сейчас: VERSION_ID=${VERSION_ID:-?}" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Ubuntu ${VERSION_ID} — ставим пакеты (git, curl, openssl, …)"
apt-get update -qq
apt-get install -y -qq \
  git \
  ca-certificates \
  curl \
  openssl \
  gnupg

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker не найден — ставим Docker Engine + Compose (официальный скрипт)"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Включаем сервис docker"
systemctl enable --now docker

# На свежей установке сокет может подняться с задержкой
for _ in 1 2 3 4 5; do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
if ! docker info >/dev/null 2>&1; then
  echo "Docker установлен, но «docker info» не проходит. Проверьте: systemctl status docker" >&2
  exit 1
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

chmod +x scripts/vpn-panel scripts/run-gen-xray-ports.sh 2>/dev/null || true

echo "==> Генерация docker-compose.xray-ports.gen.yml из config/xray/config.json"
(cd "$INSTALL_DIR" && bash scripts/run-gen-xray-ports.sh) || true

PRIMARY_IP=""
PRIMARY_IP="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Дальнейшие шаги (каталог установки: $INSTALL_DIR)"
echo "  ОС: Ubuntu ${VERSION_ID}"
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
echo "════════════════════════════════════════════════════════════════"
