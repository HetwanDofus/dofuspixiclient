<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\DrawerInterface;
use Arakne\Swf\Extractor\Modifier\CharacterModifierInterface;
use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Rectangle;

/**
 * No-op drawable used to "strip" a sprite placement from a parent's
 * pre-rendered SVG without changing the rest of the display list (depth
 * order, bounds, sibling rendering).
 *
 * The original sprite's bounds rectangle is preserved so the parent's
 * frame bounds — which are the union of all object bounds — don't change.
 * Otherwise the SVG viewBox would shrink and downstream atlasing would
 * silently produce different-sized frames between renders.
 *
 * Placeholder bounds are reported, but {@see draw()} writes nothing.
 */
final class EmptyDrawable implements DrawableInterface
{
    public function __construct(
        private readonly Rectangle $bounds,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->bounds;
    }

    public function framesCount(bool $recursive = false): int
    {
        return 1;
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        // Intentionally empty: this placement is rendered by the runtime
        // spell class (via clip.attach + onLoad/onEnterFrame), not by the
        // pre-rendered SVG.
        return $drawer;
    }

    public function transformColors(ColorTransform $colorTransform): DrawableInterface
    {
        // Color transforms are also a no-op since we render nothing.
        return $this;
    }

    public function modify(CharacterModifierInterface $modifier, int $maxDepth = -1): DrawableInterface
    {
        return $this;
    }
}
