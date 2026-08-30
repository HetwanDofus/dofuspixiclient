/**
 * The request body of `POST /admin/accounts`, and the fingerprint that
 * makes its `Idempotency-Key` mean something.
 *
 * Parsing is strict on purpose: an unknown field is a caller that thinks
 * it is asking for something this API does not do, and letting it through
 * would silently provision a different account than the one it wanted.
 */

import { createHash } from "node:crypto";

import { isCanonicalPasswordKey } from "@features/auth/password-key";
import { z } from "zod";

import { ProvisionError } from "./provision-account.errors";

/** 1.29 breed ids. */
export const BREED_ID_MIN = 1;
export const BREED_ID_MAX = 12;

const username = z
  .string()
  .regex(
    /^[A-Za-z0-9._-]{3,32}$/,
    "must be 3-32 characters of letters, digits, dot, dash or underscore"
  );

const pseudo = z
  .string()
  .regex(/^[^\s][^\n\r]{0,30}[^\s]$/, "must be 2-32 printable characters");

const characterName = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z-]{1,19}$/,
    "must be 2-20 letters, starting with a letter, hyphens allowed"
  );

export const provisionAccountRequestSchema = z.strictObject({
  username,
  // Validated by shape only — never quote the value back, in an error or
  // anywhere else.
  passwordKey: z.string(),
  pseudo,
  serverId: z.number().int().positive().optional(),
  character: z.strictObject({
    name: characterName,
    breedId: z.number().int().min(BREED_ID_MIN).max(BREED_ID_MAX),
    sex: z.union([z.literal(0), z.literal(1)]),
  }),
});

export type ProvisionAccountRequest = z.infer<
  typeof provisionAccountRequestSchema
>;

export type ProvisionAccountResult = {
  /** false when an `Idempotency-Key` replay returned an earlier creation. */
  created: boolean;
  account: { id: string; username: string };
  character: { id: string; name: string };
};

/**
 * Parses and normalises, or throws a {@link ProvisionError} whose message
 * names the offending fields and quotes none of their values — `passwordKey`
 * is one of those fields.
 */
export function parseProvisionAccountRequest(
  body: unknown
): ProvisionAccountRequest {
  const parsed = provisionAccountRequestSchema.safeParse(body);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");

    throw new ProvisionError("invalid_request", details);
  }

  if (!isCanonicalPasswordKey(parsed.data.passwordKey)) {
    throw new ProvisionError(
      "invalid_password_key",
      "passwordKey must be canonical base64 decoding to exactly 32 bytes " +
        '(PBKDF2-SHA256, 600000 iterations, salt sha256("dofus:" + ' +
        "lowercase username))"
    );
  }

  return parsed.data;
}

/**
 * A stable digest of the *normalised* request, stored beside the
 * idempotency key so a replay can be told apart from a key reused with a
 * different body. Hashing rather than storing means the derived password
 * key is never persisted in the clear.
 */
export function fingerprintRequest(req: ProvisionAccountRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        req.username,
        req.passwordKey,
        req.pseudo,
        req.serverId ?? null,
        req.character.name,
        req.character.breedId,
        req.character.sex,
      ])
    )
    .digest("hex");
}
