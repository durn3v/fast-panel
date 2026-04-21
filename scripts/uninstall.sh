#!/usr/bin/env bash
# Полное удаление панели с сервера: контейнеры, том PostgreSQL, каталог установки.
#
# Запуск с сервера (рекомендуется — скрипт не лежит в удаляемом дереве после первой строки):
#   curl -fsSL https://raw.githubusercontent.com/durn3v/fast-panel/main/scripts/uninstall.sh | sudo bash
#
# Если репозиторий ещё на диске:
#   sudo bash /opt/fast-panel/scripts/uninstall.sh
#
# Без вопроса: sudo FORCE=1 bash …/uninstall.sh
# Другой каталог: sudo INSTALL_DIR=/opt/other bash …/uninstall.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

INSTALL_DIR="${INSTALL_DIR:-/opt/fast-panel}"
FORCE="${FORCE:-}"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Запустите от root: sudo bash $0" >&2
  exit 1
fi

run_compose() {
  if [[ -n "${DOCKER_COMPOSE_BIN:-}" ]]; then
    "${DOCKER_COMPOSE_BIN}" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    echo "Не найдены docker-compose / docker compose — остановите стек вручную из $INSTALL_DIR" >&2
    return 1
  fi
}

echo "Будет удалено:"
echo "  - Compose в $INSTALL_DIR: контейнеры и тома (-v), в т.ч. данные PostgreSQL"
echo "  - Каталог $INSTALL_DIR целиком (.env, config/xray, …)"
echo "  - Симлинк /usr/local/bin/vpn-panel (если указывает на этот проект)"
echo ""

if [[ "$FORCE" != "1" ]]; then
  read -r -p "Продолжить? Введите yes: " ans </dev/tty
  if [[ "${ans:-}" != "yes" ]]; then
    echo "Отмена."
    exit 1
  fi
fi

if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  echo "==> docker compose down -v (сначала с --rmi local, при ошибке — без)…"
  (
    cd "$INSTALL_DIR"
    export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.xray-ports.gen.yml}"
    run_compose down -v --remove-orphans --rmi local 2>/dev/null || run_compose down -v --remove-orphans || true
  )
elif [[ -d "$INSTALL_DIR" ]]; then
  echo "==> Нет $INSTALL_DIR/docker-compose.yml — пропускаю compose down"
fi

if [[ -L /usr/local/bin/vpn-panel ]]; then
  target="$(readlink -f /usr/local/bin/vpn-panel 2>/dev/null || readlink /usr/local/bin/vpn-panel || true)"
  if [[ "$target" == "$INSTALL_DIR"/* ]] || [[ "$target" == *"/fast-panel/scripts/vpn-panel" ]] || [[ "$target" == *"/super-vpn-panel/scripts/vpn-panel" ]]; then
    echo "==> Удаляю /usr/local/bin/vpn-panel"
    rm -f /usr/local/bin/vpn-panel
  fi
fi

if [[ -d "$INSTALL_DIR" ]]; then
  echo "==> rm -rf $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
fi

echo ""
echo "Готово. Чистая установка:"
echo "  curl -fsSL https://raw.githubusercontent.com/durn3v/fast-panel/main/scripts/install.sh | sudo bash"
echo ""
echo "Образы postgres/xray с Docker Hub не удалялись (только локально собранный panel при успешном --rmi local). При необходимости: docker image prune -f"
