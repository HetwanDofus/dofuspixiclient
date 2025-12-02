import { inflate, inflateSync } from 'node:zlib';
import { promisify } from 'node:util';
import {
  Errors,
  type ErrorFlags,
  ParserOutOfBoundException,
  ParserInvalidDataException,
  ParserExtraDataException,
} from '@/error/errors.ts';

const inflateAsync = promisify(inflate);

/**
 * Low-level SWF primitives parser.
 * This class is mutable and stateful.
 */
export class SwfReader {
  /** Binary data of the SWF file */
  public readonly data: Uint8Array;

  /** DataView for reading multi-byte values */
  private readonly view: DataView;

  /** The end offset of the binary data (exclusive) */
  public readonly end: number;

  /** Flags for error reporting */
  public readonly errors: ErrorFlags;

  /** Current byte offset in the binary data */
  private _offset: number = 0;

  /** Current bit offset when reading bits (0-7) */
  private bitOffset: number = 0;

  /** Current byte value for bit operations (-1 when not loaded) */
  private currentByte: number = -1;

  constructor(data: Uint8Array | ArrayBuffer | Buffer, end?: number, errors: ErrorFlags = Errors.ALL) {
    if (data instanceof ArrayBuffer) {
      this.data = new Uint8Array(data);
    } else if (Buffer.isBuffer(data)) {
      this.data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.data = data;
    }
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.end = end ?? this.data.length;
    this.errors = errors;
  }

  get offset(): number {
    return this._offset;
  }

  set offset(value: number) {
    this._offset = value;
    this.currentByte = -1;
  }

  /**
   * Uncompress remaining data using ZLib compression.
   * Returns a new reader with uncompressed data.
   */
  async uncompress(maxLen?: number): Promise<SwfReader> {
    const compressedData = this.data.slice(this._offset, this.end);
    
    try {
      const uncompressed = await inflateAsync(compressedData);
      const headerData = this.data.slice(0, this._offset);
      const fullData = new Uint8Array(headerData.length + uncompressed.length);
      fullData.set(headerData, 0);
      fullData.set(new Uint8Array(uncompressed), headerData.length);

      if (maxLen !== undefined && fullData.length > maxLen) {
        if (this.errors & Errors.EXTRA_DATA) {
          throw new ParserExtraDataException(
            `Uncompressed data exceeds maximum length of ${maxLen} bytes (actual ${fullData.length} bytes)`,
            this._offset,
            fullData.length - maxLen,
          );
        }
        const truncated = fullData.slice(0, maxLen);
        const reader = new SwfReader(truncated, maxLen, this.errors);
        reader._offset = this._offset;
        return reader;
      }

      const reader = new SwfReader(fullData, fullData.length, this.errors);
      reader._offset = this._offset;
      return reader;
    } catch (e) {
      if (e instanceof ParserExtraDataException) throw e;
      if (this.errors & Errors.INVALID_DATA) {
        throw ParserInvalidDataException.createInvalidCompressedData(this._offset);
      }
      const reader = new SwfReader(this.data.slice(0, this._offset), this._offset, this.errors);
      reader._offset = this._offset;
      return reader;
    }
  }

  /**
   * Synchronous uncompress using Node's zlib
   */
  uncompressSync(maxLen?: number): SwfReader {
    const compressedData = this.data.slice(this._offset, this.end);

    try {
      const uncompressed = inflateSync(compressedData);
      const headerData = this.data.slice(0, this._offset);
      const fullData = new Uint8Array(headerData.length + uncompressed.length);
      fullData.set(headerData, 0);
      fullData.set(uncompressed, headerData.length);

      if (maxLen !== undefined && fullData.length > maxLen) {
        if (this.errors & Errors.EXTRA_DATA) {
          throw new ParserExtraDataException(
            `Uncompressed data exceeds maximum length of ${maxLen} bytes (actual ${fullData.length} bytes)`,
            this._offset,
            fullData.length - maxLen,
          );
        }
        const truncated = fullData.slice(0, maxLen);
        const reader = new SwfReader(truncated, maxLen, this.errors);
        reader._offset = this._offset;
        return reader;
      }

      const reader = new SwfReader(fullData, fullData.length, this.errors);
      reader._offset = this._offset;
      return reader;
    } catch (e) {
      if (e instanceof ParserExtraDataException) throw e;
      if (this.errors & Errors.INVALID_DATA) {
        throw ParserInvalidDataException.createInvalidCompressedData(this._offset);
      }
      const reader = new SwfReader(this.data.slice(0, this._offset), this._offset, this.errors);
      reader._offset = this._offset;
      return reader;
    }
  }

  /**
   * Create a new reader with a chunk of the binary data.
   */
  chunk(offset: number, end: number): SwfReader {
    if (end > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadAfterEnd(end, this.end);
      }
      end = this.end;
    }
    const reader = new SwfReader(this.data, end, this.errors);
    reader._offset = offset;
    return reader;
  }

  /**
   * Read multiple bytes from the binary data.
   */
  readBytes(num: number): Uint8Array {
    if (this._offset + num > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, num);
      }
      const available = Math.max(this.end - this._offset, 0);
      const result = new Uint8Array(num);
      result.set(this.data.slice(this._offset, this._offset + available), 0);
      this._offset = this.end;
      return result;
    }
    const result = this.data.slice(this._offset, this._offset + num);
    this._offset += num;
    return result;
  }

  /**
   * Read bytes as a string (latin1 encoding).
   */
  readBytesAsString(num: number): string {
    const bytes = this.readBytes(num);
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]!);
    }
    return result;
  }

  /**
   * Read bytes until the specified offset.
   */
  readBytesTo(targetOffset: number): Uint8Array {
    if (targetOffset <= this._offset) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw new ParserOutOfBoundException(
          `Cannot read bytes to offset ${targetOffset} before current offset ${this._offset}`,
          targetOffset,
        );
      }
      return new Uint8Array(0);
    }
    if (targetOffset > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadAfterEnd(this._offset, this.end);
      }
      targetOffset = this.end;
    }
    const result = this.data.slice(this._offset, targetOffset);
    this._offset = targetOffset;
    return result;
  }

  /**
   * Read ZLib compressed bytes and uncompress them.
   */
  readZLibTo(targetOffset: number): Uint8Array {
    const compressed = this.readBytesTo(targetOffset);
    if (compressed.length === 0) return new Uint8Array(0);

    try {
      return inflateSync(compressed);
    } catch {
      if (this.errors & Errors.INVALID_DATA) {
        throw ParserInvalidDataException.createInvalidCompressedData(this._offset);
      }
      return new Uint8Array(0);
    }
  }

  /**
   * Skip bytes.
   */
  skipBytes(num: number): void {
    this._offset += num;
  }

  /**
   * Skip to offset.
   */
  skipTo(offset: number): void {
    this._offset = offset;
  }

  /**
   * Read a single byte.
   */
  readChar(): number {
    if (this._offset >= this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadAfterEnd(this._offset, this.end);
      }
      return 0;
    }
    return this.data[this._offset++]!;
  }

  /**
   * Read a null-terminated string.
   */
  readNullTerminatedString(): string {
    let result = '';
    let pos = this._offset;

    while (pos < this.end) {
      const byte = this.data[pos]!;
      if (byte === 0) {
        this._offset = pos + 1;
        return result;
      }
      result += String.fromCharCode(byte);
      pos++;
    }

    if (this.errors & Errors.INVALID_DATA) {
      throw new ParserInvalidDataException('String terminator not found', this._offset);
    }
    this._offset = this.end;
    return result;
  }

  /**
   * Reset bit reader state.
   */
  alignByte(): void {
    if (this.bitOffset !== 0) {
      this._offset++;
      this.bitOffset = 0;
      this.currentByte = -1;
    }
  }

  /**
   * Read unsigned bits.
   */
  readUB(numBits: number): number {
    if (numBits === 0) return 0;

    let value = 0;
    let remaining = numBits;

    while (remaining > 0) {
      if (this.currentByte === -1) {
        if (this._offset >= this.end) {
          if (this.errors & Errors.OUT_OF_BOUNDS) {
            throw ParserOutOfBoundException.createReadAfterEnd(this._offset, this.end);
          }
          return value;
        }
        this.currentByte = this.data[this._offset]!;
        this.bitOffset = 0;
      }

      const availableBits = 8 - this.bitOffset;
      const bitsToRead = Math.min(remaining, availableBits);
      const shift = availableBits - bitsToRead;
      const mask = (1 << bitsToRead) - 1;
      const bits = (this.currentByte >> shift) & mask;

      value = (value << bitsToRead) | bits;
      remaining -= bitsToRead;
      this.bitOffset += bitsToRead;

      if (this.bitOffset >= 8) {
        this._offset++;
        this.currentByte = -1;
        this.bitOffset = 0;
      }
    }

    return value;
  }

  /**
   * Read signed bits.
   */
  readSB(numBits: number): number {
    if (numBits === 0) return 0;

    const value = this.readUB(numBits);
    const signBit = 1 << (numBits - 1);

    if (value & signBit) {
      return value - (1 << numBits);
    }
    return value;
  }

  /**
   * Read fixed-point bits (16.16 format).
   */
  readFB(numBits: number): number {
    return this.readSB(numBits) / 65536;
  }

  /**
   * Read a single bit as boolean.
   */
  readBool(): boolean {
    return this.readUB(1) === 1;
  }

  // Unsigned integer readers

  /** Read unsigned 8-bit integer */
  readUI8(): number {
    this.alignByte();
    if (this._offset >= this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadAfterEnd(this._offset, this.end);
      }
      return 0;
    }
    return this.data[this._offset++]!;
  }

  /** Read unsigned 16-bit integer (little-endian) */
  readUI16(): number {
    this.alignByte();
    if (this._offset + 2 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 2);
      }
      return 0;
    }
    const value = this.view.getUint16(this._offset, true);
    this._offset += 2;
    return value;
  }

  /** Read unsigned 32-bit integer (little-endian) */
  readUI32(): number {
    this.alignByte();
    if (this._offset + 4 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 4);
      }
      return 0;
    }
    const value = this.view.getUint32(this._offset, true);
    this._offset += 4;
    return value;
  }

  // Signed integer readers

  /** Read signed 8-bit integer */
  readSI8(): number {
    this.alignByte();
    if (this._offset >= this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadAfterEnd(this._offset, this.end);
      }
      return 0;
    }
    const val = this.data[this._offset++]!;
    return val > 127 ? val - 256 : val;
  }

  /** Read signed 16-bit integer (little-endian) */
  readSI16(): number {
    this.alignByte();
    if (this._offset + 2 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 2);
      }
      return 0;
    }
    const value = this.view.getInt16(this._offset, true);
    this._offset += 2;
    return value;
  }

  /** Read signed 32-bit integer (little-endian) */
  readSI32(): number {
    this.alignByte();
    if (this._offset + 4 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 4);
      }
      return 0;
    }
    const value = this.view.getInt32(this._offset, true);
    this._offset += 4;
    return value;
  }

  // Fixed-point readers

  /** Read 8.8 fixed-point number */
  readFixed8(): number {
    return this.readSI16() / 256;
  }

  /** Read 16.16 fixed-point number */
  readFixed(): number {
    return this.readSI32() / 65536;
  }

  // Floating-point readers

  /** Read 32-bit float (little-endian) */
  readFloat(): number {
    this.alignByte();
    if (this._offset + 4 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 4);
      }
      return 0;
    }
    const value = this.view.getFloat32(this._offset, true);
    this._offset += 4;
    return value;
  }

  /** Read 64-bit double (little-endian) */
  readDouble(): number {
    this.alignByte();
    if (this._offset + 8 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 8);
      }
      return 0;
    }
    const value = this.view.getFloat64(this._offset, true);
    this._offset += 8;
    return value;
  }

  /**
   * Read 64-bit double with swapped 32-bit halves.
   * SWF ActionScript stores doubles with the low 4 bytes first, then the high 4 bytes.
   */
  readDoubleSwapped(): number {
    this.alignByte();
    if (this._offset + 8 > this.end) {
      if (this.errors & Errors.OUT_OF_BOUNDS) {
        throw ParserOutOfBoundException.createReadTooManyBytes(this._offset, this.end, 8);
      }
      return 0;
    }
    // Read low 4 bytes, then high 4 bytes, and swap them
    const low = this.data.slice(this._offset, this._offset + 4);
    const high = this.data.slice(this._offset + 4, this._offset + 8);
    // Create a new buffer with swapped halves
    const swapped = new Uint8Array(8);
    swapped.set(high, 0);
    swapped.set(low, 4);
    const view = new DataView(swapped.buffer);
    this._offset += 8;
    return view.getFloat64(0, true);
  }

  /**
   * Read encoded U32 (variable-length unsigned 32-bit integer).
   * Uses 7 bits per byte, with high bit indicating continuation.
   */
  readEncodedU32(): number {
    let value = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = this.readUI8();
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80 && shift < 35);

    return value >>> 0; // Convert to unsigned
  }

  /**
   * Check if there's remaining data to read.
   */
  hasRemaining(): boolean {
    return this._offset < this.end;
  }

  /**
   * Get remaining byte count.
   */
  remaining(): number {
    return Math.max(0, this.end - this._offset);
  }
}

