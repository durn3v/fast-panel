# Super VPN Panel (Mini VPN API)

REST API для учёта пользователей **VLESS** на [Xray](https://github.com/XTLS/Xray-core): синхронизация UUID в Xray через gRPC (`AddUser` / `RemoveUser`), трафик, PostgreSQL, Docker Compose.

Инбаунды **не создаются через API** — они описываются в `config/xray/config.json` вручную. Панель после рестарта только **добавляет пользователей** в уже загруженный Xray.

## Quick install (prepare only)

Скрипт **`scripts/install.sh`** рассчитан **только на Ubuntu 24.x / 25.x** (сервер): ставит через `apt` зависимости и при необходимости **Docker** (`get.docker.com`), затем клонирует репозиторий и готовит `.env` / `config.json`.

```bash
curl -fsSL https://raw.githubusercontent.com/YOU/super-vpn-panel/main/scripts/install.sh | sudo bash
```

Дальше: правьте `config/xray/config.json` и `.env`, затем:

```bash
sudo /opt/super-vpn-panel/scripts/vpn-panel start
```

## Порты Xray на хосте

Порты для `docker compose` берутся **автоматически** из `inbounds[].port` в **`config/xray/config.json`** (тот же формат, что у Xray: число, строка `"443,8443"`, диапазон `"1000-1010"`). Секция **`api`** не публикуется наружу — только клиентские inbounds. Протокол **`tun`** и Unix-socket в **`listen`** пропускаются.

Скрипт `scripts/gen-xray-ports-compose.mjs` вызывается обёрткой **`scripts/run-gen-xray-ports.sh`**: на сервере **`vpn-panel`** и **`npm run gen:xray-ports`** запускают его в ephemeral-контейнере **`node:22-bookworm-slim`** (нужен только Docker, не Node на хосте). Локально, без Docker, используется **`node`** на PATH. Результат — **`docker-compose.xray-ports.gen.yml`**. Если файла конфига нет или в inbounds нет TCP-портов, в compose подставляется **443** с предупреждением в лог.

Образ для генерации можно переопределить: **`GEN_NODE_IMAGE`** (переменная окружения).

Необязательно в `.env`: **`XRAY_CONFIG_PATH`** — путь к JSON от корня репо (по умолчанию `config/xray/config.json`).

Compose поднимается с двумя файлами (так делает `vpn-panel`):

- `docker-compose.yml`
- `docker-compose.xray-ports.gen.yml`

Если запускаете `docker compose` сами, задайте:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.xray-ports.gen.yml
```

или укажите `-f` для обоих файлов.

## CLI

| Command | Description |
|--------|-------------|
| `scripts/vpn-panel start` | генерирует порты из `.env`, затем `docker compose up -d` |
| `scripts/vpn-panel stop` | `docker compose down` |
| `scripts/vpn-panel restart` | `docker compose restart` |
| `scripts/vpn-panel update` | `git pull` и пересборка |

## API

- Auth: заголовок `X-API-Key` (как `API_KEY` в `.env`).
- Спека: [docs/openapi.yaml](docs/openapi.yaml) — также `GET /openapi.yaml` и `GET /openapi.json` (без ключа).
- **`GET /users` / `GET /users/:id`** отдают `uuid` (VLESS id) и `inboundTag` — по ним и вашему `config.json` собирайте `vless://` на своей стороне.
- **`GET /inbounds`** — теги inbounds из **запущенного** Xray (gRPC `ListInbounds`), не из БД.

### Про protobuf и «inboundBuilder»

Раньше в репозитории был модуль, который собирал protobuf для **`AddInbound`** по API. При модели «всё в `config.json`» он **не нужен**: inbound Xray читает из файла при старте.

Критично остаётся только путь **`alterInbound` + `AddUserOperation`** (то, что делает `grpcAddUser` в `src/services/xrayClient.ts`). Если версия Xray изменит поля в protobuf и в логах появятся ошибки вида *unknown field* / *failed to parse*, править нужно **этот** код (и при необходимости `.proto` из вашего тега `xray-core`), а не несуществующий уже `inboundBuilder`.

## Development

```bash
npm install
npm run fetch-protos   # клон ./xray-core для gRPC protos
cp .env.example .env   # DATABASE_URL, API_KEY, XRAY_PROTO_ROOT=./xray-core
npm run dev
```

## Environment

См. [.env.example](.env.example). В Docker `docker-compose.yml` подставляет `POSTGRES_PASSWORD` и `API_KEY` из `.env`.
