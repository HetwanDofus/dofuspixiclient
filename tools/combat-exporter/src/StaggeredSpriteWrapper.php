<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\DrawerInterface;
use Arakne\Swf\Extractor\Modifier\CharacterModifierInterface;
use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Rectangle;

/**
 * Honors Macromedia/Adobe Flash's staggered sprite-placement convention.
 *
 * The Flash authoring tool stamps a unique `ratio` value on every
 * `PlaceObject2` whose `characterId` is a SpriteDefinition. By convention,
 * `ratio == parent_frame_at_which_this_instance_was_placed`. Each instance is
 * a fresh MovieClip and starts its own playhead at frame 0 — so at parent
 * global frame N, the instance should render its inner sprite at frame
 * `N - ratio`, not at frame `N`.
 *
 * Arakne stores `ratio` on `FrameObject` but only honors it for morph shapes.
 * For SpriteDefinition placements, Arakne always passes the global frame
 * straight to the sprite's draw(), causing every instance to render the same
 * frame. When the inner sprite has empty frames at the end (e.g. via
 * RemoveObject2 followed by stop()), every staggered instance simultaneously
 * hits the empty zone and the spell visual collapses to a static fragment
 * — which is exactly the symptom users see ("does the right thing, then
 * goes static and wrong").
 *
 * This wrapper subtracts the placement offset before delegating to the
 * underlying drawable, restoring the per-instance phase that Flash plays.
 *
 * @see ExtractSpellAnimsCommand::wrapTimelineWithRatioOffsets()
 */
final class StaggeredSpriteWrapper implements DrawableInterface
{
    public function __construct(
        private readonly DrawableInterface $wrapped,
        private readonly int $offset,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->wrapped->bounds();
    }

    public function framesCount(bool $recursive = false): int
    {
        return $this->wrapped->framesCount($recursive);
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        $effective = $frame - $this->offset;
        if ($effective < 0) {
            $effective = 0;
        }

        return $this->wrapped->draw($drawer, $effective);
    }

    public function transformColors(ColorTransform $colorTransform): DrawableInterface
    {
        return new self(
            $this->wrapped->transformColors($colorTransform),
            $this->offset,
        );
    }

    public function modify(CharacterModifierInterface $modifier, int $maxDepth = -1): DrawableInterface
    {
        return new self(
            $this->wrapped->modify($modifier, $maxDepth),
            $this->offset,
        );
    }

    public function getWrapped(): DrawableInterface
    {
        return $this->wrapped;
    }

    public function getOffset(): int
    {
        return $this->offset;
    }
}
