#!/usr/bin/env bash
# Установка панели: только Ubuntu 24.04+ / 25.x (server).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/durn3v/fast-panel.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/fast-panel}"
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

# Домен для TLS-сертификата (можно передать через env: PANEL_DOMAIN=panel.example.com)
PANEL_DOMAIN="${PANEL_DOMAIN:-}"
PANEL_PORT="${PANEL_PORT:-12983}"

if [[ -z "$PANEL_DOMAIN" && -t 0 ]]; then
  echo ""
  read -rp "Домен для HTTPS-сертификата панели (оставьте пустым, чтобы пропустить TLS): " PANEL_DOMAIN
fi

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

# Пакет docker.io из Ubuntu часто без подкоманды «docker compose» — нужен v2-плагин или docker-compose.
if ! docker compose version >/dev/null 2>&1; then
  echo "==> Ставим Docker Compose v2 (apt), чтобы работала команда «docker compose»"
  apt-get install -y -qq docker-compose-v2 2>/dev/null \
    || apt-get install -y -qq docker-compose-plugin 2>/dev/null \
    || true
fi
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "Не удалось поставить Docker Compose автоматически. Выполните:" >&2
  echo "  apt-get install -y docker-compose-v2" >&2
  echo "или поставьте Docker заново: curl -fsSL https://get.docker.com | sh" >&2
fi

# --- TLS: certbot standalone (порт 80, не трогает 443) ---
TLS_CERT_VALUE=""
TLS_KEY_VALUE=""

if [[ -n "$PANEL_DOMAIN" ]]; then
  echo "==> Ставим certbot для TLS-сертификата"
  apt-get install -y -qq certbot

  CERT_DIR="/etc/letsencrypt/live/${PANEL_DOMAIN}"

  if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
    echo "==> Сертификат для ${PANEL_DOMAIN} уже существует — пропускаем выпуск"
  else
    echo "==> Выпускаем сертификат для ${PANEL_DOMAIN} (certbot standalone, порт 80)"
    certbot certonly \
      --standalone \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      -d "$PANEL_DOMAIN"
  fi

  TLS_CERT_VALUE="${CERT_DIR}/fullchain.pem"
  TLS_KEY_VALUE="${CERT_DIR}/privkey.pem"

  # Deploy hook: перезапускаем контейнер panel после обновления сертификата
  HOOK_FILE="/etc/letsencrypt/renewal-hooks/deploy/restart-vpn-panel.sh"
  cat >"$HOOK_FILE" <<HOOK
#!/bin/bash
# Автоматически перезапускает контейнер panel после обновления сертификата
cd "${INSTALL_DIR}" && docker compose restart panel 2>/dev/null || true
HOOK
  chmod +x "$HOOK_FILE"
  echo "==> Deploy hook создан: $HOOK_FILE"
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
PORT=${PANEL_PORT}
TLS_CERT=${TLS_CERT_VALUE}
TLS_KEY=${TLS_KEY_VALUE}
TRAFFIC_SYNC_INTERVAL_MS=60000
EOF
else
  # .env уже существует — обновляем только TLS_CERT/TLS_KEY/PORT если они пустые
  if [[ -n "$TLS_CERT_VALUE" ]]; then
    grep -q '^TLS_CERT=' .env \
      && sed -i "s|^TLS_CERT=.*|TLS_CERT=${TLS_CERT_VALUE}|" .env \
      || echo "TLS_CERT=${TLS_CERT_VALUE}" >> .env
    grep -q '^TLS_KEY=' .env \
      && sed -i "s|^TLS_KEY=.*|TLS_KEY=${TLS_KEY_VALUE}|" .env \
      || echo "TLS_KEY=${TLS_KEY_VALUE}" >> .env
  fi
  grep -q '^PORT=' .env \
    || echo "PORT=${PANEL_PORT}" >> .env
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

echo "==> Создаём симлинк /usr/local/bin/vpn-panel"
ln -sf "$INSTALL_DIR/scripts/vpn-panel" /usr/local/bin/vpn-panel

echo "==> Генерация docker-compose.xray-ports.gen.yml из config/xray/config.json"
(cd "$INSTALL_DIR" && bash scripts/run-gen-xray-ports.sh) || true

PRIMARY_IP=""
PRIMARY_IP="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"

PROTO="http"
[[ -n "$TLS_CERT_VALUE" ]] && PROTO="https"

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
echo "        vpn-panel start"
echo ""
echo "  4) Проверка здоровья панели (после start, порт ${PANEL_PORT}):"
echo "        curl -sk ${PROTO}://127.0.0.1:${PANEL_PORT}/health"
if [[ -n "$PANEL_DOMAIN" ]]; then
  echo "     Снаружи (HTTPS):"
  echo "        curl -s https://${PANEL_DOMAIN}:${PANEL_PORT}/health"
elif [[ -n "$PRIMARY_IP" ]]; then
  echo "     С другой машины:"
  echo "        curl -s http://${PRIMARY_IP}:${PANEL_PORT}/health"
fi
echo "     OpenAPI без ключа:"
echo "        curl -sk ${PROTO}://127.0.0.1:${PANEL_PORT}/openapi.yaml | head"
echo ""
echo "  5) Запросы к API — заголовок X-API-Key из строки API_KEY в:"
echo "        $INSTALL_DIR/.env"
if [[ -n "$TLS_CERT_VALUE" ]]; then
  echo ""
  echo "  TLS: сертификат Let's Encrypt для ${PANEL_DOMAIN}"
  echo "       Авто-обновление: certbot.timer (systemd) + deploy hook перезапустит контейнер"
fi
echo ""
echo "════════════════════════════════════════════════════════════════"
