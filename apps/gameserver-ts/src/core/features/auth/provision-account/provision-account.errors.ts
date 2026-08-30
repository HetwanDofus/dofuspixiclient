/**
 * Every refusal `POST /admin/accounts` can hand back, with the HTTP status
 * it maps to. The `code` is the stable half of the contract — callers
 * branch on it — and `message` is prose for a human reading a log. Neither
 * ever carries the admin token or the password key.
 */
export type ProvisionErrorCode =
  | "invalid_request"
  | "invalid_password_key"
  | "unknown_server"
  | "no_server_available"
  | "server_required"
  | "username_taken"
  | "pseudo_taken"
  | "character_name_taken"
  | "idempotency_key_reuse"
  | "spawn_map_missing"
  | "provisioning_incomplete";

const STATUS: Record<ProvisionErrorCode, number> = {
  invalid_request: 422,
  invalid_password_key: 422,
  unknown_server: 422,
  no_server_available: 422,
  server_required: 422,
  username_taken: 409,
  pseudo_taken: 409,
  character_name_taken: 409,
  idempotency_key_reuse: 409,
  spawn_map_missing: 500,
  provisioning_incomplete: 500,
};

export class ProvisionError extends Error {
  readonly status: number;

  constructor(
    readonly code: ProvisionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProvisionError";
    this.status = STATUS[code];
  }
}

export function isProvisionError(err: unknown): err is ProvisionError {
  return err instanceof ProvisionError;
}
