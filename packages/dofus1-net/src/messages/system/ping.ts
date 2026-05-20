// "ping" — outbound ping (Aks.as:393).
// "qping" — outbound quick-ping (Aks.as:397).
//
// These are special: they're full opcode strings ("ping" / "qping")
// rather than 2-char heads, so they're built as raw outbound senders
// via Client.sendRaw. We expose helpers to keep the wire literal in
// one place.

export const PING_FRAME = "ping";
export const QUICK_PING_FRAME = "qping";
