import { timingSafeEqual } from "node:crypto";

import { fromBinary } from "@bufbuild/protobuf";
import { ClientMessageSchema } from "@dofus/proto/client_messages_pb";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";

import type { AccountProvisioner } from "./admin-accounts.ts";
import type { UpstreamRegistry } from "./upstream-registry.ts";
import { registerAdminAccountsRoute } from "./admin-accounts.ts";
import {
  newSession,
  type Role,
  type SessionRegistry,
} from "./session-registry.ts";

export { websocket };

type Auth = { accountId: string; characterId: string };

type Env = {
  Variables: { auth: Auth; role: Role };
};

type Deps = {
  sessions: SessionRegistry;
  upstreams: UpstreamRegistry;
  authToken: (raw: string, role: Role) => Auth | null;
  /**
   * Present only when the gateway was started with a database to provision
   * into. Without it `POST /admin/accounts` is not registered at all —
   * a 404 rather than a route that 500s on every call.
   */
  provisioner?: AccountProvisioner;
};

const ROLES: readonly Role[] = ["auth", "game"];

function isRole(raw: string): raw is Role {
  return (ROLES as readonly string[]).includes(raw);
}

export function buildHttpApp(deps: Deps) {
  const app = new Hono<Env>();

  app.get("/health", (c) =>
    c.json({
      sessions: deps.sessions.size(),
      upstreams: deps.upstreams.status(),
    })
  );

  const adminToken = process.env.GATEWAY_ADMIN_TOKEN;
  if (adminToken) {
    app.use("/admin/*", async (c, next) => {
      // Constant-time: a plain !== leaks the shared secret one character at
      // a time to anyone who can measure the reply.
      if (!secretEquals(c.req.header("x-admin-token"), adminToken)) {
        return c.text("forbidden", 403);
      }

      await next();
    });

    app.post("/admin/handoff", async (c) => {
      const { role, standbyPath } = await c.req.json<{
        role: Role;
        standbyPath: string;
      }>();

      if (!isRole(role)) {
        return c.json({ ok: false, error: `invalid role: ${role}` }, 400);
      }

      const t0 = Date.now();

      try {
        await deps.upstreams.get(role).handoffTo(standbyPath);

        return c.json({ ok: true, durationMs: Date.now() - t0 });
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
      }
    });

    if (deps.provisioner) {
      registerAdminAccountsRoute(app, deps.provisioner);
    }
  }

  app.use("/ws/:role", async (c, next) => {
    const roleParam = c.req.param("role");
    if (!isRole(roleParam)) {
      return c.text(`unknown role: ${roleParam}`, 404);
    }

    const token = c.req.query("token");

    if (!token) {
      return c.text("missing token", 401);
    }

    const auth = deps.authToken(token, roleParam);

    if (!auth) {
      return c.text("unauthorized", 401);
    }

    c.set("role", roleParam);
    c.set("auth", auth);

    await next();
  });

  // Unauthenticated WebSocket route — client connects here first, then
  // authenticates in-band via protobuf. Used by the Dofus client which
  // connects to /game or /auth directly.
  app.get(
    "/:role",
    upgradeWebSocket((c) => {
      const roleParam = c.req.param("role") ?? "";
      if (!isRole(roleParam)) {
        return {};
      }
      const role = roleParam;
      const upstream = deps.upstreams.get(role);
      const session = newSession({
        sessionId: crypto.randomUUID(),
        role,
        accountId: "",
        characterId: "",
        remoteAddr: c.req.header("x-forwarded-for") ?? "unknown",
        sink: { sendBinary: () => undefined, close: () => undefined },
      });

      return {
        onOpen: (_ev, ws) => {
          session.sink = {
            sendBinary: (bytes) => {
              ws.send(bytes);
            },
            close: (code, reason) => {
              ws.close(code, reason);
            },
          };
          deps.sessions.add(session);
          upstream.sessionOpen(
            session.sessionId,
            session.accountId,
            session.characterId,
            session.remoteAddr
          );
        },
        onMessage: (ev) => {
          const bytes = toBytes(ev.data);
          try {
            const message = fromBinary(ClientMessageSchema, bytes);
            upstream.forwardClient({
              sessionId: session.sessionId,
              message,
            });
          } catch {
            // Malformed message — ignore
          }
        },
        onClose: () => {
          deps.sessions.remove(session.sessionId);
          upstream.sessionClose(session.sessionId, "client_close");
        },
      };
    })
  );

  // Pre-authenticated WebSocket route (with token query param)
  app.get(
    "/ws/:role",
    upgradeWebSocket((c) => {
      const auth = c.get("auth");
      const role = c.get("role");
      const upstream = deps.upstreams.get(role);
      const session = newSession({
        sessionId: crypto.randomUUID(),
        role,
        accountId: auth.accountId,
        characterId: auth.characterId,
        remoteAddr: c.req.header("x-forwarded-for") ?? "unknown",
        sink: { sendBinary: () => undefined, close: () => undefined },
      });

      return {
        onOpen: (_ev, ws) => {
          session.sink = {
            sendBinary: (bytes) => {
              ws.send(bytes);
            },
            close: (code, reason) => {
              ws.close(code, reason);
            },
          };
          deps.sessions.add(session);
          upstream.sessionOpen(
            session.sessionId,
            session.accountId,
            session.characterId,
            session.remoteAddr
          );
        },
        onMessage: (ev) => {
          const bytes = toBytes(ev.data);

          for (const message of session.reader.push(bytes)) {
            upstream.forwardClient({
              sessionId: session.sessionId,
              message,
            });
          }
        },
        onClose: () => {
          deps.sessions.remove(session.sessionId);
          upstream.sessionClose(session.sessionId, "client_close");
        },
      };
    })
  );

  return app;
}

/**
 * Length-safe, then constant-time. `timingSafeEqual` throws on a length
 * mismatch, and the length of the configured token is not a secret worth
 * protecting — the token itself is.
 */
function secretEquals(given: string | undefined, expected: string): boolean {
  if (given === undefined) {
    return false;
  }

  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function toBytes(
  data: ArrayBuffer | Blob | SharedArrayBuffer | string
): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }

  if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) {
    return new Uint8Array(data);
  }

  throw new Error("unsupported WS payload type (Blob)");
}
