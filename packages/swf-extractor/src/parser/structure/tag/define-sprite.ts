import type { SwfReader } from '@/parser/swf-reader.ts';
import { type SwfTag, readAllTags } from '../swf-tag.ts';

/**
 * Parsed DefineSprite tag.
 */
export interface DefineSprite {
  /** Character ID */
  readonly id: number;
  /** Frame count */
  readonly frameCount: number;
  /** Control tags within the sprite */
  readonly controlTags: readonly SwfTag[];
}

/**
 * Read DefineSprite tag.
 */
export function readDefineSprite(reader: SwfReader): DefineSprite {
  const id = reader.readUI16();
  const frameCount = reader.readUI16();

  // Read all control tags within the sprite
  const controlTags = Array.from(readAllTags(reader));

  return {
    id,
    frameCount,
    controlTags,
  };
}

