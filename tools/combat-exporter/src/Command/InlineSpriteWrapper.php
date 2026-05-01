<?php

declare(strict_types=1);

namespace App\Command;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\DrawerInterface;
use Arakne\Swf\Extractor\Modifier\CharacterModifierInterface;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Rectangle;

/**
 * Drawable that reuses a SpriteDefinition's bounds/identity but delegates
 * rendering to a rewritten timeline (typically wrapped further in
 * {@see \App\FlashLoopTimeline}). Used by
 * {@see ExtractSpellAnimsCommand::wrapTimelineWithRatioOffsets()} to thread
 * stagger + loop semantics into nested sprites without mutating the
 * (`final`) SpriteDefinition class.
 */
final class InlineSpriteWrapper implements DrawableInterface
{
    public function __construct(
        private readonly SpriteDefinition $original,
        private readonly DrawableInterface $rewrittenTimeline,
    ) {}

    public function bounds(): Rectangle
    {
        return $this->original->bounds();
    }

    public function framesCount(bool $recursive = false): int
    {
        return $this->rewrittenTimeline->framesCount($recursive);
    }

    public function draw(DrawerInterface $drawer, int $frame = 0): DrawerInterface
    {
        return $this->rewrittenTimeline->draw($drawer, $frame);
    }

    public function transformColors(ColorTransform $colorTransform): DrawableInterface
    {
        return new self(
            $this->original,
            $this->rewrittenTimeline->transformColors($colorTransform),
        );
    }

    public function modify(CharacterModifierInterface $modifier, int $maxDepth = -1): DrawableInterface
    {
        return new self(
            $this->original,
            $this->rewrittenTimeline->modify($modifier, $maxDepth),
        );
    }
}
