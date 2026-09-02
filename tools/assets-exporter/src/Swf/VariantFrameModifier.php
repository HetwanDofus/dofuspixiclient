<?php

namespace App\Swf;

use Arakne\Swf\Extractor\Modifier\AbstractCharacterModifier;
use Arakne\Swf\Extractor\Modifier\GotoAndStop;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Override;

/**
 * Pins the variant-carrying clips of a tile to the frame the wrapper asked
 * for, as computed by {@see VariantFrameResolver}.
 *
 * Applied through {@see SpriteDefinition::modify()}, so it visits the whole
 * character tree; only the ids in the resolved map are touched, and each is
 * pinned on its own timeline alone (`maxDepth: 1`) so nested animations keep
 * all their frames.
 */
final class VariantFrameModifier extends AbstractCharacterModifier
{
    /** @param array<int, int> $frames character id => 1-based frame number */
    public function __construct(private readonly array $frames)
    {
    }

    #[Override]
    public function applyOnSprite(SpriteDefinition $sprite): SpriteDefinition
    {
        $frame = $this->frames[$sprite->id] ?? null;

        if ($frame === null) {
            return $sprite;
        }

        return $sprite->modify(new GotoAndStop($frame), 1);
    }
}
