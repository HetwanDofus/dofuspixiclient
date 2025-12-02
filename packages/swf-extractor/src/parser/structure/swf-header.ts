import type { Rectangle } from './record/rectangle.ts';

/**
 * SWF file header.
 */
export interface SwfHeader {
  /** SWF file signature (FWS, CWS, or ZWS) */
  readonly signature: string;
  /** SWF version */
  readonly version: number;
  /** File length (uncompressed) */
  readonly fileLength: number;
  /** Display frame size in twips */
  readonly frameSize: Rectangle;
  /** Frame rate (frames per second) */
  readonly frameRate: number;
  /** Total number of frames */
  readonly frameCount: number;
}

/**
 * Check if the SWF is compressed.
 */
export function isCompressed(header: SwfHeader): boolean {
  return header.signature === 'CWS' || header.signature === 'ZWS';
}

/**
 * Check if the header is valid.
 */
export function isValidSignature(signature: string): boolean {
  return signature === 'FWS' || signature === 'CWS' || signature === 'ZWS';
}

