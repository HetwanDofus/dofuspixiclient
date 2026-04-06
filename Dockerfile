# Multi-stage build: server + client static assets
FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock turbo.json ./
COPY apps/server/package.json apps/server/
COPY apps/electrobun/package.json apps/electrobun/
COPY packages/grid/package.json packages/grid/
COPY packages/protocol/package.json packages/protocol/
RUN bun install --frozen-lockfile

# Copy source
COPY apps/ apps/
COPY packages/ packages/

# Build
RUN bun run build

# ── Production server ──
FROM oven/bun:1.3-slim
WORKDIR /app

COPY --from=base /app/node_modules node_modules
COPY --from=base /app/apps/server apps/server
COPY --from=base /app/packages packages

ENV PG_HOST=postgres
ENV PG_PORT=5432
ENV PG_DATABASE=dofus
ENV PG_USER=dofus
ENV PG_PASSWORD=dofus

EXPOSE 8080
CMD ["bun", "run", "apps/server/src/index.ts"]
