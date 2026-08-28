# Server image for the two-process gameserver (gateway + core).
#
# One image, three roles selected by the compose command:
#   src/core/main.ts    with MODE=auth  → authd  (binds AUTH_SOCK)
#   src/core/main.ts    with MODE=game  → gamed  (binds CORE_SOCK)
#   src/gateway/main.ts                 → gateway (binds :8080, dials both)
#
# gateway ↔ core talk over Unix domain sockets, so the three containers share
# a `/sockets` volume (see docker-compose.yml).
FROM oven/bun:1.3
WORKDIR /app

# Manifests first so the install layer caches independently of source edits.
COPY package.json bun.lock ./
COPY apps/gameserver-ts/package.json apps/gameserver-ts/
COPY apps/electrobun/package.json apps/electrobun/
COPY packages/dofasset-format/package.json packages/dofasset-format/
COPY packages/dofus-lang/package.json packages/dofus-lang/
COPY packages/dofus1-registry/package.json packages/dofus1-registry/
COPY packages/grid/package.json packages/grid/
COPY packages/proto/package.json packages/proto/
COPY packages/protocol/package.json packages/protocol/
COPY packages/spell-runtime/package.json packages/spell-runtime/
COPY packages/uds-transport/package.json packages/uds-transport/
COPY tools/asset-pipeline/package.json tools/asset-pipeline/
COPY tools/combat-exporter/package.json tools/combat-exporter/
COPY tools/combat-exporter/test-player/package.json tools/combat-exporter/test-player/
# Single stage on purpose: workspaces that pin a different major than the
# hoisted one (zod 4 here) resolve through per-workspace `node_modules`, and
# cherry-picking those out of a builder stage silently downgrades them.
RUN bun install --frozen-lockfile

COPY apps/gameserver-ts apps/gameserver-ts
COPY packages packages
COPY scripts/sync-package-version.ts scripts/sync-package-version.ts
RUN bun run contracts:build
# `@dofus/dofus-lang` reads bundles off disk; the server preloads `spells`.
COPY apps/electrobun/public/assets/langs apps/electrobun/public/assets/langs
# Auth advertises the exact navigation artifact public clients download.
COPY apps/electrobun/public/assets/data/navigation-manifest.json apps/electrobun/public/assets/data/navigation-manifest.json
COPY apps/electrobun/public/assets/data/navigation-manifest.schema.json apps/electrobun/public/assets/data/navigation-manifest.schema.json

ENV NODE_ENV=production
ENV LANGS_DIR=/app/apps/electrobun/public/assets/langs
ENV NAVIGATION_MANIFEST_PATH=/app/apps/electrobun/public/assets/data/navigation-manifest.json
ENV CORE_SOCK=/sockets/gamed.sock
ENV AUTH_SOCK=/sockets/authd.sock
ENV GATEWAY_PORT=8080

WORKDIR /app/apps/gameserver-ts
EXPOSE 8080
CMD ["bun", "run", "src/gateway/main.ts"]
