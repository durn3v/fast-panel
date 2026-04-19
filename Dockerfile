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
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
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
