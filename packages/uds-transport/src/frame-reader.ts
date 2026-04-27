import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fromBinary, type Message } from "@bufbuild/protobuf";

export class FrameReader<M extends Message> {
  private buf: Uint8Array = new Uint8Array(0);

  constructor(private readonly schema: GenMessage<M>) {}

  push(chunk: Uint8Array): M[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const out: M[] = [];
    while (this.buf.length >= 4) {
      const len = new DataView(
        this.buf.buffer,
        this.buf.byteOffset,
        4
      ).getUint32(0, false);
      if (this.buf.length < 4 + len) {
        break;
      }
      out.push(fromBinary(this.schema, this.buf.subarray(4, 4 + len)));
      this.buf = this.buf.subarray(4 + len);
    }
    return out;
  }
}
