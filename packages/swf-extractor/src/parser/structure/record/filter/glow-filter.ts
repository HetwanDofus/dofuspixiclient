import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rgba } from '@/parser/structure/record/color.ts';
import { readRgba } from '@/parser/structure/record/color.ts';

export const GLOW_FILTER_ID = 2;

/**
 * Glow filter.
 */
export interface GlowFilter {
  readonly type: typeof GLOW_FILTER_ID;
  readonly glowColor: Rgba;
  readonly blurX: number;
  readonly blurY: number;
  readonly strength: number;
  readonly innerGlow: boolean;
  readonly knockout: boolean;
  readonly compositeSource: boolean;
  readonly passes: number;
}

/**
 * Read a glow filter from the reader.
 */
export function readGlowFilter(reader: SwfReader): GlowFilter {
  const glowColor = readRgba(reader);
  const blurX = reader.readFixed();
  const blurY = reader.readFixed();
  const strength = reader.readFixed8();
  const innerGlow = reader.readBool();
  const knockout = reader.readBool();
  const compositeSource = reader.readBool();
  const passes = reader.readUB(5);

  return {
    type: GLOW_FILTER_ID,
    glowColor,
    blurX,
    blurY,
    strength,
    innerGlow,
    knockout,
    compositeSource,
    passes,
  };
}

