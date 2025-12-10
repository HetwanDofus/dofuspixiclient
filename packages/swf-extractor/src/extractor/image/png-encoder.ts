import { deflateSync } from 'node:zlib';

/**
 * Compute CRC32 of a buffer.
 * Matches PHP's crc32() behavior (unsigned 32-bit).
 */
function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;

  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]!) & 0xff;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc = (crc >>> 8) ^ c;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Uint8Array): Buffer {
  const length = data.length;
  const chunk = Buffer.alloc(8 + length + 4);

  // Length
  chunk.writeUInt32BE(length, 0);
  // Type
  chunk.write(type, 4, 4, 'ascii');
  // Data
  Buffer.from(data).copy(chunk, 8);

  // CRC over type + data
  const crc = crc32(chunk.subarray(4, 8 + length));
  chunk.writeUInt32BE(crc >>> 0, 8 + length);

  return chunk;
}

/**
 * Encode raw RGBA data into a PNG buffer.
 *
 * - width / height in pixels
 * - rgba: Buffer or Uint8Array of length width * height * 4
 *
 * Uses zlib.deflateSync and a very small PNG encoder to avoid pulling in
 * heavy dependencies on the hot path (e.g. image color transforms).
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: 13 bytes
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method (no interlace)
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Image data: one filter byte (0 = None) per row, then RGBA bytes.
  const rowStride = width * 4;
  const raw = Buffer.alloc(height * (rowStride + 1));
  let src = 0;
  let dst = 0;

  for (let y = 0; y < height; y++) {
    raw[dst++] = 0; // filter type: None
    for (let x = 0; x < rowStride; x++) {
      raw[dst++] = rgba[src++]!;
    }
  }

  const compressed = deflateSync(raw);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
