import { startCli } from "./cli.tsx";
import { buildHttpApp, websocket } from "./http.ts";
import { logger } from "./logger.ts";
import { type Role, SessionRegistry } from "./session-registry.ts";
import { Upstream } from "./upstream.ts";
import { UpstreamRegistry } from "./upstream-registry.ts";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const GAME_SOCK = process.env.CORE_SOCK ?? "/tmp/dofus-gamed.sock";
const AUTH_SOCK = process.env.AUTH_SOCK ?? "/tmp/dofus-authd.sock";

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
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startCli({ upstreams, sessions, shutdown });
