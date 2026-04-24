#!/usr/bin/env bash
# Выпуск Let's Encrypt (certbot standalone) и запись TLS_CERT/TLS_KEY в .env корня репо.
# Только root. Порт 80 должен быть свободен.
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "issue-tls-cert.sh: запустите от root (или: vpn-panel issue-tls <домен>)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

_resolve_root() {
  local src="${BASH_SOURCE[0]:-$0}"
  local dir link
  while [[ -h "$src" ]]; do
    dir="$(cd -P "$(dirname "$src")" && pwd)"
    link="$(readlink "$src")" || break
    [[ "$link" != /* ]] && link="$dir/$link"
    src="$link"
  done
  cd -P "$(dirname "$src")/.." && pwd
}
ROOT="$(_resolve_root)"
unset -f _resolve_root

PANEL_DOMAIN="${1:-${PANEL_DOMAIN:-}}"
if [[ -z "$PANEL_DOMAIN" ]]; then
  echo "Usage: issue-tls-cert.sh <fqdn>" >&2
  echo "  Пример: issue-tls-cert.sh panel.example.com" >&2
  exit 1
fi

ENV_FILE="${ROOT}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "issue-tls-cert.sh: нет $ENV_FILE — сначала создайте .env (например scripts/install.sh)." >&2
  exit 1
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "==> Ставим certbot"
  apt-get update -qq
  apt-get install -y -qq certbot
fi

CERT_DIR="/etc/letsencrypt/live/${PANEL_DOMAIN}"
TLS_CERT_VALUE="${CERT_DIR}/fullchain.pem"
TLS_KEY_VALUE="${CERT_DIR}/privkey.pem"

if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
  echo "==> Сертификат для ${PANEL_DOMAIN} уже есть — пропускаем certbot"
else
  echo "==> Выпускаем сертификат для ${PANEL_DOMAIN} (certbot standalone, порт 80)"
  certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    -d "$PANEL_DOMAIN"
fi

if [[ ! -f "$TLS_CERT_VALUE" || ! -f "$TLS_KEY_VALUE" ]]; then
  echo "issue-tls-cert.sh: после certbot не найдены $TLS_CERT_VALUE или $TLS_KEY_VALUE" >&2
  exit 1
fi

HOOK_FILE="/etc/letsencrypt/renewal-hooks/deploy/restart-vpn-panel.sh"
cat >"$HOOK_FILE" <<HOOK
#!/bin/bash
# Автоматически перезапускает контейнер panel после обновления сертификата
cd "${ROOT}" && docker compose restart panel 2>/dev/null || true
HOOK
chmod +x "$HOOK_FILE"
echo "==> Deploy hook: $HOOK_FILE"

grep -q '^TLS_CERT=' "$ENV_FILE" \
  && sed -i "s|^TLS_CERT=.*|TLS_CERT=${TLS_CERT_VALUE}|" "$ENV_FILE" \
  || echo "TLS_CERT=${TLS_CERT_VALUE}" >>"$ENV_FILE"
grep -q '^TLS_KEY=' "$ENV_FILE" \
  && sed -i "s|^TLS_KEY=.*|TLS_KEY=${TLS_KEY_VALUE}|" "$ENV_FILE" \
  || echo "TLS_KEY=${TLS_KEY_VALUE}" >>"$ENV_FILE"

echo ""
echo "==> Обновлён $ENV_FILE"
echo "    TLS_CERT=$TLS_CERT_VALUE"
echo "    TLS_KEY=$TLS_KEY_VALUE"
echo ""
echo "Перезапустите панель, чтобы подтянуть сертификат:"
echo "    vpn-panel restart"
