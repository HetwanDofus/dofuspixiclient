/**
 * `POST /admin/accounts` — provisioning an account and its first character
 * for an authorised control plane (QA-126).
 *
 * The route is a translator and nothing more: headers and JSON in, HTTP
 * status out. Every rule about what a valid account is lives in
 * `AccountProvisioningService`, which the seed script also uses, so there
 * is one implementation of them and no shell process behind this API.
 *
 * It sits on the gateway because that is the only port a control plane can
 * reach, and it is registered only when `GATEWAY_ADMIN_TOKEN` is set — see
 * `buildHttpApp`, which also owns the `x-admin-token` check.
 */
import type {
  ProvisionAccountRequest,
  ProvisionAccountResult,
} from "@features/auth/provision-account/provision-account.contract";
import type { Hono, Env as HonoEnv } from "hono";
import { parseProvisionAccountRequest } from "@features/auth/provision-account/provision-account.contract";
import { isProvisionError } from "@features/auth/provision-account/provision-account.errors";

import { logger } from "./logger.ts";
import { FixedWindowLimiter } from "./rate-limiter.ts";

export type AccountProvisioner = {
  provision(
    idempotencyKey: string,
    request: ProvisionAccountRequest
  ): Promise<ProvisionAccountResult>;
};

/**
 * A provisioning body is a few hundred bytes. Anything larger is a mistake
 * or an attempt to make the gateway buffer on someone else's behalf.
 */
const MAX_BODY_BYTES = 8 * 1024;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export function registerAdminAccountsRoute<E extends HonoEnv>(
  app: Hono<E>,
  provisioner: AccountProvisioner,
  limiter = new FixedWindowLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
): void {
  app.post("/admin/accounts", async (c) => {
    const req = c.req.raw;
    const log = logger.child({
      mod: "admin-accounts",
      requestId: crypto.randomUUID(),
    });

    if (!limiter.take(callerKey(req))) {
      log.warn("rate limited");

      return fail(429, "rate_limited", "too many provisioning requests");
    }

    const idempotencyKey = req.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "missing_idempotency_key",
        "the Idempotency-Key header is required"
      );
    }

    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return fail(
        400,
        "invalid_idempotency_key",
        "the Idempotency-Key header must be at most " +
          `${MAX_IDEMPOTENCY_KEY_LENGTH} characters`
      );
    }

    let body: unknown;

    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err instanceof PayloadTooLarge) {
        return fail(
          413,
          "payload_too_large",
          `the request body must be at most ${MAX_BODY_BYTES} bytes`
        );
      }

      return fail(400, "invalid_json", "the request body is not valid JSON");
    }

    try {
      // Parsed here rather than inside the transaction so a malformed body
      // never opens one, and so the refusal is the same object the service
      // would have raised.
      const request = parseProvisionAccountRequest(body);
      const result = await provisioner.provision(idempotencyKey, request);

      log.info(
        {
          created: result.created,
          account: result.account.id,
          character: result.character.id,
        },
        "provisioned account"
      );

      return Response.json(
        { account: result.account, character: result.character },
        { status: result.created ? 201 : 200 }
      );
    } catch (err) {
      if (isProvisionError(err)) {
        log.warn({ code: err.code }, "provisioning refused");

        return fail(err.status, err.code, err.message);
      }

      // Never echo an unexpected error: it may quote the SQL statement it
      // failed on, and the password key travels through some of those.
      log.error({ err: (err as Error).message }, "provisioning failed");

      return fail(500, "internal_error", "provisioning failed");
    }
  });
}

class PayloadTooLarge extends Error {}

async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);

  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new PayloadTooLarge();
  }

  const raw = await req.text();

  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw new PayloadTooLarge();
  }

  return JSON.parse(raw) as unknown;
}

function callerKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return forwarded || "unknown";
}

function fail(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}
