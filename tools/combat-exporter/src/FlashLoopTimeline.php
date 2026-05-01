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
 * Honors Flash MovieClip default semantics around the end of a sprite's
 * own timeline:
 *
 * - **No `stop()` anywhere** → the playhead loops back to frame 0 each
 *   time it overruns the last frame. Used for ambient sub-sprites whose
 *   parent keeps them on screen longer than their natural cycle (e.g.
 *   the 21-frame inner pattern in Armure Terrestre's spell_5, placed
 *   for ~63 frames — should loop 3×).
 * - **`stop()` at frame N** → the playhead freezes at frame N. Frames
 *   after N are never reached even if the parent keeps the sprite on
 *   screen.
 *
 * Arakne's stock {@see Timeline::draw()} always clamps with
 * `min($frame, count($frames)-1)`, which freezes a no-stop sprite at
 * its last frame instead of looping. That produces the "extra useless
 * sprite static in the middle" symptom — the 20th frame of a 21-frame
 * particle sticks on screen forever once parent global time exceeds 20.
 *
 * The wrapper is applied during extraction by
 * {@see ExtractSpellAnimsCommand::wrapTimelineWithRatioOffsets()}; the
 * recursion walks every nested SpriteDefinition so non-staggered nested
 * sprites also benefit.
 */
final class FlashLoopTimeline implements DrawableInterface
{
    public function __construct(
        private readonly Timeline $wrapped,
        /**
         * 0-indexed frame where the sprite calls stop(). Null when the
         * sprite has no stop() — in which case the playhead loops.
         */
        private readonly ?int $stopFrame,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->wrapped->bounds;
    }

    public function framesCount(bool $recursive = false): int
    {
        return $this->wrapped->framesCount($recursive);
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        $frames = $this->wrapped->frames;
        $total = count($frames);
        if ($total === 0) {
            return $drawer;
        }

        if ($this->stopFrame !== null) {
            // Clamp at stop() frame (canonical Flash behavior).
            $displayListFrame = $frame < 0 ? 0 : ($frame > $this->stopFrame ? $this->stopFrame : $frame);
        } else {
            // No stop() → loop. Use a positive modulo so negative frames
            // (shouldn't happen, but defensive) land on a valid index.
            $displayListFrame = (($frame % $total) + $total) % $total;
        }

        if ($displayListFrame > $total - 1) {
            $displayListFrame = $total - 1;
        }

        // Pass the ORIGINAL frame to children so inner sprites continue
        // their own independent timelines (per Flash semantics — children
        // do not stop just because their parent stopped).
        return $frames[$displayListFrame]->draw($drawer, $frame);
    }

    public function transformColors(ColorTransform $colorTransform): DrawableInterface
    {
        return new self(
            $this->wrapped->transformColors($colorTransform),
            $this->stopFrame,
        );
    }

    public function modify(CharacterModifierInterface $modifier, int $maxDepth = -1): DrawableInterface
    {
        return new self(
            $this->wrapped->modify($modifier, $maxDepth),
            $this->stopFrame,
        );
    }

    public function getWrapped(): Timeline
    {
        return $this->wrapped;
    }

    public function getStopFrame(): ?int
    {
        return $this->stopFrame;
    }
}
