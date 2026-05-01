<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Parser\Structure\Record\ColorTransform;
use Arakne\Swf\Parser\Structure\Record\Matrix;

/**
 * One PlaceObject2/3 placement that ships CLIPACTIONRECORDs.
 *
 * Captured by {@see DynamicSpriteAnalyzer} during the raw-tag walk. The
 * extractor uses these to:
 *   1. Strip the placed sprite from the parent's pre-rendered SVG (so the
 *      runtime can attach a live clip without double-rendering).
 *   2. Emit a per-spell `librarySymbols[]` entry in the manifest with the
 *      placement schedule, so the AI generator knows when to call
 *      `clip.attach(sym, ...)` in the parent's frameScripts.
 */
final readonly class DynamicPlacement
{
    public function __construct(
        /** Sprite that owns the timeline this placement appears in. */
        public int $parentSpriteId,
        /** 0-indexed frame within the parent sprite's timeline. */
        public int $parentFrameIndex,
        public int $depth,
        /** Character (sprite) being placed. */
        public int $characterId,
        public ?Matrix $matrix,
        public ?ColorTransform $colorTransform,
        public ?int $ratio,
        public ?string $name,
        public ?int $clipDepth,
        /** Frame count of the placed sprite (for runtime lifecycle hints). */
        public int $placedSpriteFrameCount,
        /**
         * 'place' = initial PlaceObject2 (creates a new instance), or
         * 'move'  = subsequent PlaceObject2 with move=1 (tween update on
         *           the already-placed instance at this depth).
         * The runtime class translates 'place' to clip.attach() and
         * 'move' to a frameScript that mutates the existing clip's
         * matrix/colorTransform.
         */
        public string $kind = 'place',
    ) {}

    /**
     * Serializable representation for the manifest. We keep matrix /
     * colorTransform deliberately simple (twips → pixels for translation)
     * so the AI prompt doesn't need any conversion glue.
     *
     * @return array<string, mixed>
     */
    public function toManifest(): array
    {
        $matrix = null;
        if ($this->matrix !== null) {
            $matrix = [
                'scaleX' => $this->matrix->scaleX,
                'scaleY' => $this->matrix->scaleY,
                'rotateSkew0' => $this->matrix->rotateSkew0,
                'rotateSkew1' => $this->matrix->rotateSkew1,
                // Matrix translation is stored in twips by Arakne; emit
                // pixels (Dofus runtime convention).
                'translateX' => $this->matrix->translateX / 20,
                'translateY' => $this->matrix->translateY / 20,
            ];
        }

        $ct = null;
        if ($this->colorTransform !== null) {
            $ct = [
                'redMult' => $this->colorTransform->redMult,
                'greenMult' => $this->colorTransform->greenMult,
                'blueMult' => $this->colorTransform->blueMult,
                'alphaMult' => $this->colorTransform->alphaMult,
                'redAdd' => $this->colorTransform->redAdd,
                'greenAdd' => $this->colorTransform->greenAdd,
                'blueAdd' => $this->colorTransform->blueAdd,
                'alphaAdd' => $this->colorTransform->alphaAdd,
            ];
        }

        return [
            'kind' => $this->kind,
            'parentSpriteId' => $this->parentSpriteId,
            'frame' => $this->parentFrameIndex,
            'depth' => $this->depth,
            'matrix' => $matrix,
            'colorTransform' => $ct,
            'ratio' => $this->ratio,
            'name' => $this->name,
            'clipDepth' => $this->clipDepth,
        ];
    }
}
