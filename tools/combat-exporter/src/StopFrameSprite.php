<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\DrawerInterface;
use Arakne\Swf\Extractor\Modifier\CharacterModifierInterface;
use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Rectangle;

/**
 * Wrapper around a DrawableInterface that enforces a stop frame.
 *
 * When the frame number exceeds the stop frame, it will render at the stop frame
 * instead of continuing to advance or loop.
 *
 * The key insight is that FrameObject.computeRelativeFrame() uses modulo:
 *   return $globalFrame % $objectFrameCount;
 *
 * To prevent looping, we report a very high frame count (10000) so that:
 *   - The modulo passes through the global frame as-is
 *   - Our draw() method then clamps to the stop frame
 *
 * Example with stopFrame=28:
 *   - framesCount() returns 10000
 *   - For global frame 60: computeRelativeFrame(60) = 60 % 10000 = 60
 *   - draw() receives 60, clamps to min(60, 28) = 28
 *   - Result: renders frame 28 (the stop frame)
 */
final class StopFrameSprite implements DrawableInterface
{
    /**
     * Large enough to exceed any reasonable parent frame count,
     * preventing the modulo from ever wrapping.
     * 10000 frames = ~166 seconds at 60fps.
     */
    private const PREVENT_MODULO_WRAP = 10000;

    public function __construct(
        private readonly DrawableInterface $wrapped,
        private readonly int $stopFrame,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->wrapped->bounds();
    }

    public function framesCount(bool $recursive = false): int
    {
        // Return a large number to prevent FrameObject.computeRelativeFrame()
        // from wrapping via modulo. This way the global frame passes through
        // unchanged and we can clamp it in draw().
        return self::PREVENT_MODULO_WRAP;
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        // Clamp frame to the stop frame - this is where the stop() behavior happens
        $clampedFrame = min($frame, $this->stopFrame);
        return $this->wrapped->draw($drawer, $clampedFrame);
    }

    public function transformColors(ColorTransform $colorTransform): DrawableInterface
    {
        return new self(
            $this->wrapped->transformColors($colorTransform),
            $this->stopFrame
        );
    }

    public function modify(CharacterModifierInterface $modifier, int $maxDepth = -1): DrawableInterface
    {
        return new self(
            $this->wrapped->modify($modifier, $maxDepth),
            $this->stopFrame
        );
    }

    public function getWrapped(): DrawableInterface
    {
        return $this->wrapped;
    }

    public function getStopFrame(): int
    {
        return $this->stopFrame;
    }
}
