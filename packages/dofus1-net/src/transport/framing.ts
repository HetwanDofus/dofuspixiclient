// Null-terminated framing. AS2's XMLSocket delivers data terminated by
// `\x00`; each chunk on the TCP stream can contain zero, one, or many
// complete frames plus a partial trailer. FrameReader buffers across
// chunks and yields each completed frame.

export const FRAME_TERMINATOR = "\x00";
/**
 * Canonical 1.29 outgoing framing — `Aks.send` appends `\n` BEFORE the
 * XMLSocket layer adds its mandatory `\x00`. We replicate both since
 * we own the transport layer.
 */
export const FRAME_TERMINATOR_OUT = "\n\x00";

export class FrameReader {
  private buf = "";

  /**
   * Push a chunk of received bytes. Returns every complete frame the
   * push completed; partial trailers are buffered until the next push.
   */
  push(chunk: string): string[] {
    this.buf += chunk;

    if (!this.buf.includes(FRAME_TERMINATOR)) {
      return [];
    }

    const parts = this.buf.split(FRAME_TERMINATOR);
    // Last element is the partial tail (or "" if the chunk ended on
    // the terminator). Hold it for the next push.
    this.buf = parts.pop() ?? "";

    return parts.filter((p) => p.length > 0);
  }

  /** Drop buffered partial data. Use on disconnect. */
  reset(): void {
    this.buf = "";
  }
}

/** Append the canonical outbound terminator (`\n\x00`). */
export function encodeFrame(payload: string): string {
  return payload + FRAME_TERMINATOR_OUT;
}
