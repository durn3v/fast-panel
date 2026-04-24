# --- Fetch Xray protos (for gRPC codegen at runtime) ---
FROM alpine/git AS xray-src
WORKDIR /src
RUN git clone --depth 1 https://github.com/XTLS/Xray-core.git .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src
COPY docs ./docs
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ARG DOCKER_VER=27.4.1
ARG COMPOSE_VER=2.32.4
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl \
  && arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) d="x86_64";; \
    arm64) d="aarch64";; \
    *) echo "unsupported arch: $arch" >&2; exit 1;; \
  esac; \
  curl -fsSL "https://download.docker.com/linux/static/stable/${d}/docker-${DOCKER_VER}.tgz" | tar -xz; \
  mv docker/docker /usr/local/bin/docker; \
  rm -rf docker; \
  chmod +x /usr/local/bin/docker; \
  mkdir -p /root/.docker/cli-plugins; \
  curl -fsSL "https://github.com/docker/compose/releases/download/v${COMPOSE_VER}/docker-compose-linux-${d}" \
    -o /root/.docker/cli-plugins/docker-compose; \
  chmod +x /root/.docker/cli-plugins/docker-compose; \
  rm -rf /var/lib/apt/lists/*
COPY --from=xray-src /src /app/xray-core
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY docs ./docs
ENV NODE_ENV=production
ENV XRAY_PROTO_ROOT=/app/xray-core
EXPOSE 3000
CMD ["node", "dist/index.js"]
