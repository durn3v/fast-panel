# Super VPN Panel (Mini VPN API)

REST API для учёта пользователей **VLESS** на [Xray](https://github.com/XTLS/Xray-core): синхронизация UUID в Xray через gRPC (`AddUser` / `RemoveUser`), трафик, PostgreSQL, Docker Compose.

Инбаунды **не создаются через API** — они описываются в `config/xray/config.json` вручную. Панель после рестарта только **добавляет пользователей** в уже загруженный Xray.

## Quick install (prepare only)

Репозиторий: [github.com/durn3v/fast-panel](https://github.com/durn3v/fast-panel).

Скрипт **`scripts/install.sh`** рассчитан **только на Ubuntu 24.x / 25.x** (сервер): ставит через `apt` зависимости и при необходимости **Docker** (`get.docker.com`), затем клонирует репозиторий и готовит `.env` / `config.json`. Каталог по умолчанию: **`/opt/fast-panel`** (переопределение: переменная **`INSTALL_DIR`**).

```bash
curl -fsSL https://raw.githubusercontent.com/durn3v/fast-panel/main/scripts/install.sh | sudo bash
```

При запуске скрипт спросит домен для HTTPS-сертификата. Если домен указан — автоматически выпускается сертификат Let's Encrypt через **certbot standalone** (порт 80, порт 443 не трогается) и прописывается в `.env`. Панель поднимается на порту **12983** с нативным HTTPS в Fastify.

Передать домен без интерактивного запроса:

```bash
curl -fsSL .../install.sh | sudo env PANEL_DOMAIN=panel.example.com bash
```

Дальше: правьте `config/xray/config.json` и `.env`, затем:

```bash
sudo /opt/fast-panel/scripts/vpn-panel start
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
| `scripts/vpn-panel start` | генерирует `docker-compose.xray-ports.gen.yml` из `config/xray/config.json`, затем `docker compose up -d` |
| `scripts/vpn-panel stop` | `docker compose down` |
| `scripts/vpn-panel restart` | `docker compose restart` |
| `scripts/vpn-panel reload-xray` | перезапускает только Xray, затем панель (для применения изменений в `config.json`) |
| `scripts/vpn-panel update` | `git fetch` + `git reset --hard origin/<ветка>` и пересборка |

`vpn-panel` сначала ищет **`docker-compose`**, затем **`docker compose`**; в начале скрипта задаётся полный **`PATH`**, чтобы находился бинарник из `/usr/local/bin`. Свой путь: **`DOCKER_COMPOSE_BIN`**.

## Обновление на сервере

Из каталога установки (по умолчанию **`/opt/fast-panel`**) под пользователем с правами на **`git`** в этом репозитории (обычно **root**, как при `install.sh`):

```bash
sudo /opt/fast-panel/scripts/vpn-panel update
```

Скрипт делает **`git fetch`** и **`git reset --hard origin/<ветка>`** (ветка = текущая из `git`, либо переменная **`BRANCH`**, иначе **`main`**) — каталог кода совпадает с GitHub, локальные отличия в **отслеживаемых** файлах не мешают (как с правками **`scripts/vpn-panel`** после `chmod` или ручного редактирования). **Не затрагиваются** неотслеживаемые файлы: **`.env`**, **`config/xray/config.json`** и т.п.

Дальше — генерация **`docker-compose.xray-ports.gen.yml`** и **`docker compose up -d --build`** (или **`docker-compose`**). Миграции БД панель применяет при старте контейнера **panel**.

Если нужна не **`main`**, а другая ветка на remote:

```bash
sudo env BRANCH=имя_ветки /opt/fast-panel/scripts/vpn-panel update
```

Свои долгоживущие правки в коде репозитория на сервере **`update` перезапишет** — храните их в форках/ветках на GitHub или вне каталога **`/opt/fast-panel`**.

Если **`Permission denied`** при запуске **`/opt/fast-panel/scripts/vpn-panel`**, один раз выполните **`chmod +x`** на скрипты или вызывайте через **`bash`**: `bash /opt/fast-panel/scripts/vpn-panel update`. В репозитории скрипты помечены как исполняемые в Git (**`100755`**); после **`update`** скрипт сам выставляет **`+x`**.

### Полное удаление с сервера

Скрипт **[scripts/uninstall.sh](scripts/uninstall.sh)** останавливает стек (**`down -v`** — удаляются тома, в том числе БД), удаляет **`/opt/fast-panel`** (или **`INSTALL_DIR`**) и при необходимости симлинк **`vpn-panel`**.

```bash
curl -fsSL https://raw.githubusercontent.com/durn3v/fast-panel/main/scripts/uninstall.sh | sudo bash
```

Без подтверждения: **`curl ... | sudo env FORCE=1 bash`**. Другой каталог: **`INSTALL_DIR=/путь curl ... | sudo bash`**.

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

## TLS / HTTPS

Панель поддерживает нативный HTTPS без nginx/stunnel — Fastify читает сертификат при старте.

| Переменная | Описание |
|---|---|
| `TLS_CERT` | Путь к `fullchain.pem` (например `/etc/letsencrypt/live/domain/fullchain.pem`) |
| `TLS_KEY` | Путь к `privkey.pem` |
| `PORT` | Порт панели, по умолчанию **12983**; 443 остаётся свободным для Xray |

Если `TLS_CERT` / `TLS_KEY` не заданы — панель работает по HTTP (удобно для локальной разработки).

`install.sh` выпускает сертификат через **certbot standalone** (HTTP-01 challenge на порту 80) и создаёт deploy hook `/etc/letsencrypt/renewal-hooks/deploy/restart-vpn-panel.sh`, который перезапускает контейнер `panel` после авто-обновления сертификата.

## Environment

См. [.env.example](.env.example). В Docker `docker-compose.yml` подставляет `POSTGRES_PASSWORD`, `API_KEY`, `TLS_CERT`, `TLS_KEY` и `PORT` из `.env`.
