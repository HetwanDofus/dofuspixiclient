import { AccountProvisioningService } from "@features/auth/provision-account/provision-account.service";
import { createDatabase, type Database } from "@shared/db/database";

import type { AccountProvisioner } from "./admin-accounts.ts";
import { startCli } from "./cli.tsx";
import { buildHttpApp, websocket } from "./http.ts";
import { logger } from "./logger.ts";
import { type Role, SessionRegistry } from "./session-registry.ts";
import { Upstream } from "./upstream.ts";
import { UpstreamRegistry } from "./upstream-registry.ts";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const GAME_SOCK = process.env.CORE_SOCK ?? "/tmp/dofus-gamed.sock";
const AUTH_SOCK = process.env.AUTH_SOCK ?? "/tmp/dofus-authd.sock";

/**
 * Where a provisioned character wakes up: map 7411, the Astrub zaap
 * (`waypoints` id 49) — the map the dev Féca stands on, so a bot appears
 * where somebody is already playing and next to the one transport every
 * other test needs.
 *
 * Shared with `scripts/dev-seed.ts` on purpose: both answer "where does a
 * brand new character wake up", and two different answers would be a bug
 * nobody notices until a bot spawns somewhere the seed never puts anyone.
 */
const SPAWN_MAP_ID = Number(process.env.SPAWN_MAP_ID ?? 7411);

/**
 * The gateway is otherwise stateless and deliberately dumb — it owns the
 * sockets and forwards frames. `POST /admin/accounts` is the one thing it
 * does on its own, and only when an operator has armed it with an admin
 * token; the connection is opened for that route alone.
 *
 * `GATEWAY_ADMIN_TOKEN` without `DATABASE_URL` is a half-configured
 * deployment: the operator asked for the admin API and would get a 404 on
 * it. Fail at boot rather than at 3am.
 */
function buildProvisioner(): {
  db: Database | null;
  provisioner: AccountProvisioner | undefined;
} {
  if (!process.env.GATEWAY_ADMIN_TOKEN) {
    return { db: null, provisioner: undefined };
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "GATEWAY_ADMIN_TOKEN is set but DATABASE_URL is not — the admin " +
        "account provisioning API cannot reach the database"
    );
  }

  const db = createDatabase(connectionString);

  return {
    db,
    provisioner: new AccountProvisioningService(db, {
      spawnMapId: SPAWN_MAP_ID,
    }),
  };
}

const { db: adminDb, provisioner } = buildProvisioner();

const sessions = new SessionRegistry();
const upstreams = new UpstreamRegistry();

for (const [role, path] of [
  ["auth", AUTH_SOCK],
  ["game", GAME_SOCK],
] as const) {
  const up = new Upstream(role, sessions);
  up.setActive(up.connect(path));
  upstreams.register(up);
}

const app = buildHttpApp({
  sessions,
  upstreams,
  ...(provisioner ? { provisioner } : {}),
  authToken: (
    raw: string,
    _role: Role
  ): { accountId: string; characterId: string } | null => {
    if (!raw.startsWith("dev_")) {
      return null;
    }

    const [, accountId = "anon", characterId = "anon"] = raw.split(":");

    return { accountId, characterId };
  },
});

const server = Bun.serve({
  port: GATEWAY_PORT,
  fetch: app.fetch,
  websocket,
});

logger.info(
  { port: GATEWAY_PORT, game: GAME_SOCK, auth: AUTH_SOCK },
  "gateway up"
);

const shutdown = async () => {
  logger.info("shutting down");
  server.stop(true);
  await adminDb?.destroy();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startCli({ upstreams, sessions, shutdown });
