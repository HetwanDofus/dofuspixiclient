<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\DrawerInterface;
use Arakne\Swf\Extractor\Modifier\CharacterModifierInterface;
use Arakne\Swf\Extractor\Timeline\Timeline;
use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Rectangle;

/**
 * Wrapper around a Timeline that implements stop() frame behavior correctly.
 *
 * Flash's stop() behavior:
 * - When stop() is called on frame S, the MovieClip's playhead stays at frame S
 * - The DISPLAY LIST (which children are visible and their transforms) stays frozen at frame S
 * - But CHILDREN continue playing their own independent timelines
 *
 * This wrapper implements this by:
 * 1. Returning a large framesCount() to prevent FrameObject.computeRelativeFrame() from wrapping
 * 2. In draw(frame), using min(frame, stopFrame) to select which Frame (display list) to use
 * 3. But passing the ORIGINAL frame to Frame.draw() so children receive the correct frame
 *
 * This differs from StopFrameSprite which clamps the frame for everything, incorrectly
 * stopping child sprites as well.
 */
final class StopFrameTimeline implements DrawableInterface
{
    /**
     * Large enough to exceed any reasonable parent frame count,
     * preventing the modulo from ever wrapping.
     */
    private const PREVENT_MODULO_WRAP = 10000;

    public function __construct(
        private readonly Timeline $wrapped,
        private readonly int $stopFrame,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->wrapped->bounds;
    }

    public function framesCount(bool $recursive = false): int
    {
        // Return a large number to prevent FrameObject.computeRelativeFrame()
        // from wrapping via modulo.
        return self::PREVENT_MODULO_WRAP;
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        $frames = $this->wrapped->frames;

        // Use the clamped frame to select which display list (Frame) to render
        // This freezes the display list at the stop frame
        $displayListFrame = min($frame, $this->stopFrame);
        $displayListFrame = min($displayListFrame, count($frames) - 1);

        // Get the frame's display list, but pass the ORIGINAL frame
        // This allows children to continue playing their own animations
        return $frames[$displayListFrame]->draw($drawer, $frame);
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

    public function getWrapped(): Timeline
    {
        return $this->wrapped;
    }

    public function getStopFrame(): int
    {
        return $this->stopFrame;
    }
}
