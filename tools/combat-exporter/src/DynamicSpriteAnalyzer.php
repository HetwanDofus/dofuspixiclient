<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Parser\Structure\Record\ClipEventFlags;
use Arakne\Swf\Parser\Structure\Tag\DefineSpriteTag;
use Arakne\Swf\Parser\Structure\Tag\EndTag;
use Arakne\Swf\Parser\Structure\Tag\PlaceObject2Tag;
use Arakne\Swf\Parser\Structure\Tag\PlaceObject3Tag;
use Arakne\Swf\Parser\Structure\Tag\ShowFrameTag;
use Arakne\Swf\SwfFile;

/**
 * Walks a spell SWF's raw tag tree and identifies the **container sprites**
 * that own at least one PlaceObject2 with CLIPACTIONRECORDs
 * (onClipEvent(load), onClipEvent(enterFrame), …).
 *
 * Why container, not the placed character:
 *
 *   sprite_9 contains:
 *     PlaceObject2 char=8 depth=1 + clipActions(load: random scale)
 *
 * The handler runs on the *placed instance* of sprite_8, but visually the
 * pair (sprite_9 + sprite_8 inner) is indivisible — sprite_9 is a 1-frame
 * outer wrapper whose only content is sprite_8. Modeling sprite_9 as the
 * library symbol and applying the handler directly to its clip gives the
 * same visual result while keeping the runtime model flat. This matches
 * what hand-written spell-101.ts already does (`sprite9`, `sprite3`, …).
 *
 * Why this matters: Arakne's `TimelineProcessor` reads ClipActions from
 * PlaceObject2Tag but DROPS them when building Frame/FrameObject, so they
 * never reach the renderer. The pre-rendered SVGs only capture the static
 * placement transform — particles never bounce, spirals never rotate.
 *
 * Architecture:
 *   1. For every container sprite that owns a clipActions placement, mark
 *      it as a "dynamic library symbol".
 *   2. Strip these sprites from parent SVG renders (so the runtime can
 *      attach a live clip with onLoad/onEnterFrame instead of double-
 *      rendering on top of the bake).
 *   3. Export each dynamic sprite as a standalone library symbol with its
 *      full inner content baked, plus a `placements[]` schedule describing
 *      where the parent timeline placed it.
 *
 * This analyzer ONLY identifies what's dynamic. It does not strip or
 * re-render — that's done by {@see ExtractSpellAnimsCommand} using the
 * data this class returns.
 */
final class DynamicSpriteAnalyzer
{
    /**
     * @var array<int, true> Set of CONTAINER sprite IDs that own at least
     *     one PlaceObject2 carrying CLIPACTIONRECORDs (directly OR
     *     transitively, via a dynamic descendant).
     */
    private array $dynamicCharacterIds = [];

    /**
     * @var array<int, true> Subset of $dynamicCharacterIds that DIRECTLY
     *     own a clipAction placement. The runtime spell class ports
     *     onLoad / onEnterFrame handlers into this sprite's
     *     SymbolDefinition.
     */
    private array $directlyDynamicIds = [];

    /**
     * @var list<DynamicPlacement> Every placement of a dynamic sprite,
     *     in tag-walk order. Includes both initial placements (kind=place)
     *     and tween updates (kind=move).
     */
    private array $placements = [];

    /**
     * @var array<int, int> sprite_id → frameCount (resolved from DefineSpriteTag).
     */
    private array $spriteFrameCounts = [];

    public function analyze(SwfFile $swf): void
    {
        // First pass: collect DefineSprite frame counts + the direct
        // containment graph (sprite → set of children placed inside it).
        $childrenOf = [];
        foreach ($swf->tags() as $tag) {
            if ($tag instanceof DefineSpriteTag) {
                $this->spriteFrameCounts[$tag->spriteId] = $tag->frameCount;
                $childrenOf[$tag->spriteId] = $this->collectPlacedCharacterIds($tag->tags);
            }
        }

        // Second pass: mark sprites that DIRECTLY own a clipAction
        // placement.
        $directlyDynamic = [];
        foreach ($swf->tags() as $tag) {
            if ($tag instanceof DefineSpriteTag) {
                if ($this->ownsClipActionPlacement($tag->tags)) {
                    $directlyDynamic[$tag->spriteId] = true;
                }
            }
        }

        // Propagate: any sprite that transitively contains a directly-
        // dynamic descendant is also "dynamic" for our purposes — its
        // placements need to be stripped from parent SVGs and emitted as
        // a library symbol so the runtime can attach a live clip there
        // and recurse into the inner dynamics. Iterate to fixpoint.
        $dynamic = $directlyDynamic;
        do {
            $changed = false;
            foreach ($childrenOf as $parentId => $children) {
                if (isset($dynamic[$parentId])) {
                    continue;
                }
                foreach ($children as $childId => $_) {
                    if (isset($dynamic[$childId])) {
                        $dynamic[$parentId] = true;
                        $changed = true;
                        break;
                    }
                }
            }
        } while ($changed);

        $this->dynamicCharacterIds = $dynamic;
        $this->directlyDynamicIds = $directlyDynamic;

        // Third pass: collect every placement of dynamic sprites.
        // For directly-dynamic parents (which own a clipAction
        // placement), we additionally record the inner placement so the
        // generator can correlate it with the right CLIPACTIONRECORD AS
        // file path (`scripts/scripts/DefineSprite_<parentId>/.../`).
        foreach ($swf->tags() as $tag) {
            if ($tag instanceof DefineSpriteTag) {
                $this->collectPlacementsOfDynamic($tag->spriteId, $tag->tags);
            }
        }
    }

    /**
     * @param iterable<object> $tags
     * @return array<int, true> set of character IDs placed in this body
     */
    private function collectPlacedCharacterIds(iterable $tags): array
    {
        $set = [];
        foreach ($tags as $tag) {
            if ($tag instanceof EndTag) {
                break;
            }
            if (!($tag instanceof PlaceObject2Tag || $tag instanceof PlaceObject3Tag)) {
                continue;
            }
            if ($tag->characterId !== null) {
                $set[$tag->characterId] = true;
            }
        }
        return $set;
    }

    /**
     * Returns true if any direct PlaceObject2/3 inside this sprite's body
     * carries a CLIPACTIONRECORD with a clip-lifecycle flag (load,
     * enterFrame, unload, initialize, construct). Mouse/key/data events
     * don't drive visual state, so we skip them.
     *
     * @param iterable<object> $tags
     */
    private function ownsClipActionPlacement(iterable $tags): bool
    {
        $relevantFlags = ClipEventFlags::LOAD
            | ClipEventFlags::ENTER_FRAME
            | ClipEventFlags::UNLOAD
            | ClipEventFlags::INITIALIZE
            | ClipEventFlags::CONSTRUCT;

        foreach ($tags as $tag) {
            if ($tag instanceof EndTag) {
                break;
            }
            if (!($tag instanceof PlaceObject2Tag || $tag instanceof PlaceObject3Tag)) {
                continue;
            }
            $clipActions = $tag->clipActions ?? null;
            if ($clipActions === null) {
                continue;
            }
            foreach ($clipActions->records as $record) {
                if (($record->flags->flags & $relevantFlags) !== 0) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Walk the sprite's body and record every placement of a known-dynamic
     * character. We also track move=1 tween updates so the runtime can
     * apply per-frame transform/colorTransform changes (e.g. the alpha
     * fade-in/out tween on Trêve's sprite_4).
     *
     * @param iterable<object> $tags
     */
    private function collectPlacementsOfDynamic(int $parentSpriteId, iterable $tags): void
    {
        $frameIndex = 0;
        // depth → most recent characterId placed there, so move=1 tweens
        // (which omit characterId) can be attributed to the right symbol.
        $depthToCharacterId = [];

        foreach ($tags as $tag) {
            if ($tag instanceof EndTag) {
                break;
            }
            if ($tag instanceof ShowFrameTag) {
                $frameIndex++;
                continue;
            }
            if (!($tag instanceof PlaceObject2Tag || $tag instanceof PlaceObject3Tag)) {
                continue;
            }

            $isNewObject = !($tag->move ?? false);

            if ($isNewObject) {
                if ($tag->characterId === null) {
                    continue;
                }
                $depthToCharacterId[$tag->depth] = $tag->characterId;
                if (!isset($this->dynamicCharacterIds[$tag->characterId])) {
                    continue;
                }
                $this->placements[] = new DynamicPlacement(
                    parentSpriteId: $parentSpriteId,
                    parentFrameIndex: $frameIndex,
                    depth: $tag->depth,
                    characterId: $tag->characterId,
                    matrix: $tag->matrix,
                    colorTransform: $tag->colorTransform,
                    ratio: $tag->ratio,
                    name: $tag->name,
                    clipDepth: $tag->clipDepth,
                    placedSpriteFrameCount: $this->spriteFrameCounts[$tag->characterId] ?? 1,
                    kind: 'place',
                );
                continue;
            }

            // move=1 (modify existing object at this depth). Record as
            // a transform/colorTransform update if it modifies a dynamic
            // symbol's instance.
            $charAtDepth = $depthToCharacterId[$tag->depth] ?? null;
            if ($charAtDepth === null || !isset($this->dynamicCharacterIds[$charAtDepth])) {
                continue;
            }
            // Only record updates that actually change something visible
            // — bare ShowFrame-spanning modifies with no matrix or
            // colorTransform are noise.
            if ($tag->matrix === null && $tag->colorTransform === null) {
                continue;
            }
            $this->placements[] = new DynamicPlacement(
                parentSpriteId: $parentSpriteId,
                parentFrameIndex: $frameIndex,
                depth: $tag->depth,
                characterId: $charAtDepth,
                matrix: $tag->matrix,
                colorTransform: $tag->colorTransform,
                ratio: $tag->ratio,
                name: $tag->name,
                clipDepth: $tag->clipDepth,
                placedSpriteFrameCount: $this->spriteFrameCounts[$charAtDepth] ?? 1,
                kind: 'move',
            );
        }
    }

    /** @return array<int, true> */
    public function getDynamicCharacterIds(): array
    {
        return $this->dynamicCharacterIds;
    }

    public function isDynamic(int $characterId): bool
    {
        return isset($this->dynamicCharacterIds[$characterId]);
    }

    /**
     * True only for sprites that DIRECTLY own a clipAction placement.
     * The runtime spell class ports onLoad/onEnterFrame handlers into
     * these sprites' SymbolDefinitions; "wrapper" sprites (dynamic only
     * by virtue of containing a directly-dynamic descendant) get
     * frameScripts that attach the descendants but no handlers of their
     * own.
     */
    public function isDirectlyDynamic(int $characterId): bool
    {
        return isset($this->directlyDynamicIds[$characterId]);
    }

    /** @return list<DynamicPlacement> */
    public function getPlacements(): array
    {
        return $this->placements;
    }

    /**
     * @return array<int, list<DynamicPlacement>> dynamicCharacterId → its placements (across all parents)
     */
    public function getPlacementsByPlacedSprite(): array
    {
        $byPlaced = [];
        foreach ($this->placements as $p) {
            $byPlaced[$p->characterId][] = $p;
        }
        return $byPlaced;
    }
}
