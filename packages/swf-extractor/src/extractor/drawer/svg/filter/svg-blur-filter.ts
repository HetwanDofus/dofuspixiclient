/**
 * SVG blur filter implementation.
 */

import type { BlurFilter } from '@/parser/structure/record/filter/blur-filter';
import type { SvgFilterBuilder } from './svg-filter-builder';

// Limit the box blur radius to avoid crashes or performance issues.
// The limit is set to 9 because RSVG handle only 20x20 pixels for the convolution kernel,
// so 9 is the maximum radius that can be used without exceeding this limit.
const MAX_BOX_BLUR_RADIUS = 9;

// Use sqrt(3) which approximates the blur box variance
const BLUR_BOX_RADIUS_TO_GAUSSIAN_BLUR_RATIO = 1.732;

/**
 * Apply the blur effect to the given filter builder.
 */
export function applyBlurFilter(builder: SvgFilterBuilder, filter: BlurFilter, inAttr: string): string {
  return blur(builder, filter.blurX, filter.blurY, filter.passes, inAttr);
}

/**
 * Create filters for the blur effect similar to the one in Flash.
 * Flash does not use a Gaussian blur, but a box blur, so <feConvolveMatrix> is used instead of <feGaussianBlur>.
 */
export function blur(
  builder: SvgFilterBuilder,
  blurX: number,
  blurY: number,
  passes: number,
  inAttr: string,
): string {
  if (blurX > MAX_BOX_BLUR_RADIUS || blurY > MAX_BOX_BLUR_RADIUS) {
    // The blur box is too large to use a convolution filter, so we use a Gaussian blur to approximate it.
    const stdDevX = blurX / BLUR_BOX_RADIUS_TO_GAUSSIAN_BLUR_RATIO;
    const stdDevY = blurY / BLUR_BOX_RADIUS_TO_GAUSSIAN_BLUR_RATIO;

    builder.addOffset(stdDevX * 3, stdDevY * 3);

    return builder.addResultFilter('feGaussianBlur', inAttr, {
      stdDeviation: `${stdDevX} ${stdDevY}`,
    });
  }

  const blurXInt = 2 * Math.ceil(blurX) + 1;
  const blurYInt = 2 * Math.ceil(blurY) + 1;

  const order = `${blurXInt} ${blurYInt}`;
  const divisor = blurXInt * blurYInt;
  const kernelMatrix = Array(divisor).fill('1').join(' ');
  let lastResult = inAttr;

  for (let i = 0; i < passes; i++) {
    lastResult = builder.addResultFilter('feConvolveMatrix', lastResult, {
      order,
      divisor: String(divisor),
      kernelMatrix,
    });
  }

  return lastResult;
}

