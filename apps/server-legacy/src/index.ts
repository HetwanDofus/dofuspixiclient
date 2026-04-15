import { Elysia } from "elysia";

import { getMapInstanceCount, getOnlineCount } from "./game/game-manager.ts";
import { startTickLoop } from "./tick.ts";
import { getSessionCount } from "./ws/client-session.ts";
import { gameWs } from "./ws/game-ws.ts";

const PORT = Number(process.env.PORT ?? 8080);

new Elysia()
  .get("/health", () => ({
    status: "ok",
    online: getOnlineCount(),
    sessions: getSessionCount(),
    maps: getMapInstanceCount(),
    uptime: process.uptime(),
  }))
  .use(gameWs)
  .listen(PORT);

// Start the 20Hz game tick loop
startTickLoop();

console.log(
  `[Server] Dofus game server running on ws://localhost:${PORT}/game`
);
console.log(`[Server] Health check at http://localhost:${PORT}/health`);
