<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\DrawerInterface;
use Arakne\Swf\Extractor\Modifier\CharacterModifierInterface;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\Timeline\Timeline;
use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Rectangle;

/**
 * Wrapper that makes a SpriteDefinition use a modified timeline or drawable.
 *
 * Since SpriteDefinition is readonly, we can't modify its timeline directly.
 * This wrapper delegates to a modified timeline/drawable for rendering while preserving
 * the original sprite's bounds and interface.
 *
 * Can wrap either:
 * - Timeline: A modified timeline with wrapped children
 * - StopFrameTimeline: A timeline with stop frame behavior
 * - Any other DrawableInterface
 */
final class StopFrameTimelineWrapper implements DrawableInterface
{
    public function __construct(
        private readonly SpriteDefinition $originalSprite,
        private readonly DrawableInterface $modifiedDrawable,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->modifiedDrawable->bounds();
    }

    public function framesCount(bool $recursive = false): int
    {
        return $this->modifiedDrawable->framesCount($recursive);
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        return $this->modifiedDrawable->draw($drawer, $frame);
    }

    public function transformColors(ColorTransform $colorTransform): DrawableInterface
    {
        return new self(
            $this->originalSprite,
            $this->modifiedDrawable->transformColors($colorTransform)
        );
    }

    public function modify(CharacterModifierInterface $modifier, int $maxDepth = -1): DrawableInterface
    {
        return new self(
            $this->originalSprite,
            $this->modifiedDrawable->modify($modifier, $maxDepth)
        );
    }

    public function getOriginalSprite(): SpriteDefinition
    {
        return $this->originalSprite;
    }

    public function getModifiedDrawable(): DrawableInterface
    {
        return $this->modifiedDrawable;
    }
}
