# syntax=docker/dockerfile:1

FROM oven/bun:1.3.13 AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/collector-cli/package.json apps/collector-cli/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/admin-ui/package.json packages/admin-ui/package.json
COPY packages/collector-core/package.json packages/collector-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/server-core/package.json packages/server-core/package.json
COPY packages/server-runtime/package.json packages/server-runtime/package.json
COPY packages/storage/package.json packages/storage/package.json

RUN bun install --frozen-lockfile --filter @nexume/server

COPY . .

RUN bun --filter @nexume/server build

FROM oven/bun:1.3.13 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NEXUME_DATA_DIR=/data

COPY package.json bun.lock ./
COPY apps/collector-cli/package.json apps/collector-cli/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/admin-ui/package.json packages/admin-ui/package.json
COPY packages/collector-core/package.json packages/collector-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/server-core/package.json packages/server-core/package.json
COPY packages/server-runtime/package.json packages/server-runtime/package.json
COPY packages/storage/package.json packages/storage/package.json

RUN bun install --frozen-lockfile --production --filter @nexume/server

COPY --from=build --chown=bun:bun /app/apps/server/src apps/server/src
COPY --from=build --chown=bun:bun /app/apps/server/dist apps/server/dist
COPY --from=build --chown=bun:bun /app/packages packages

RUN mkdir -p /data && chown bun:bun /data

USER bun
WORKDIR /app/apps/server

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const port = Bun.env.PORT ?? '3000'; fetch(`http://127.0.0.1:${port}/api/health`).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "start"]
