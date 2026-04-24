#!/bin/sh
# PID 1: оболочка; /usr/bin/xray — дочерний процесс. Тогда «xray-restart» может
# перезагрузить конфиг с диска без docker restart контейнера.
# Без set -e: wait даёт неноль при SIGTERM дочернего xray.
XRAY_BIN="${XRAY_BIN:-/usr/bin/xray}"
CONFIG="${XRAY_CONFIG:-/etc/xray/config.json}"
PIDFILE="${XRAY_CHILD_PIDFILE:-/var/run/xray-child.pid}"

child=""
_cleanup() {
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null
    wait "$child" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
  exit 0
}
trap _cleanup TERM INT

while true; do
  $XRAY_BIN -config "$CONFIG" &
  child=$!
  echo "$child" > "$PIDFILE" 2>/dev/null
  wait $child || true
  child=""
  rm -f "$PIDFILE" 2>/dev/null
  sleep 0.1
done
