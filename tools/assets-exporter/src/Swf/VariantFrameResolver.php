<?php

namespace App\Swf;

use Arakne\Swf\Avm\Processor;
use Arakne\Swf\Avm\State;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Parser\Structure\Action\ActionRecord;
use Arakne\Swf\Parser\Structure\Action\Opcode;
use Arakne\Swf\Parser\Structure\Tag\DefineSpriteTag;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\Parser\Structure\Tag\PlaceObject2Tag;
use Arakne\Swf\Parser\Structure\Tag\ShowFrameTag;
use Throwable;

use function array_pop;
use function is_int;

/**
 * Works out which frame each nested clip of a tile must be pinned to.
 *
 * Dofus 1.29 declines one piece of art into a whole family of resources: the
 * exported symbol is a thin wrapper whose frame 0 assigns a variant number
 * (`n_arbre = 3`, `n = 5` — see {@see ClipVariables}), and the clip holding
 * the variants jumps to the matching frame. It does so in one of two ways:
 *
 *   - from its own first frame, `gotoAndStop(_parent._parent.n_arbre + 1)`
 *     (the nine tree essences, the nine ores);
 *   - from an `onClipEvent` attached to its placement,
 *     `this.gotoAndStop(_parent._parent.n + 1)` (the cereals, the plants).
 *
 * Nothing replays either one during extraction, so every member of a family
 * used to be published as the default variant — see QA-144. This resolver
 * replays them and returns the frame each character must be pinned to;
 * {@see VariantFrameModifier} applies the result.
 *
 * Only jumps that actually read one of the wrapper's variables are reported,
 * so ordinary clips — including those with a constant `gotoAndPlay` — are
 * left exactly as they were.
 */
final class VariantFrameResolver
{
    /**
     * @return array<int, int> character id => frame number (1-based, as
     *                         {@see \Arakne\Swf\Extractor\Timeline\Timeline::keepFrameByNumber}
     *                         expects). Empty when the tile has no variants.
     */
    public static function resolve(
        SwfExtractor $extractor,
        SpriteDefinition $sprite
    ): array {
        $variables = ClipVariables::of($sprite);

        if ($variables === []) {
            return [];
        }

        $frames = [];
        $visited = [];

        self::walk($extractor, $sprite->tag, $variables, $frames, $visited);

        return $frames;
    }

    /**
     * @param array<string, int> $variables
     * @param array<int, int> $frames
     * @param array<int, true> $visited
     */
    private static function walk(
        SwfExtractor $extractor,
        DefineSpriteTag $tag,
        array $variables,
        array &$frames,
        array &$visited
    ): void {
        if (isset($visited[$tag->spriteId])) {
            return;
        }

        $visited[$tag->spriteId] = true;

        $firstFrame = true;

        foreach ($tag->tags as $child) {
            if ($child instanceof ShowFrameTag) {
                $firstFrame = false;
                continue;
            }

            // Own first frame: `gotoAndStop(_parent._parent.<var> + 1)`.
            if ($firstFrame && $child instanceof DoActionTag) {
                $frame = self::evaluate($child->actions, $variables);

                if ($frame !== null) {
                    $frames[$tag->spriteId] = $frame;
                }

                continue;
            }

            if (!($child instanceof PlaceObject2Tag)) {
                continue;
            }

            // Placement handler: `this.gotoAndStop(_parent._parent.<var> + 1)`.
            $placed = $child->characterId;

            if ($placed !== null && $child->clipActions !== null) {
                foreach ($child->clipActions->records as $record) {
                    $frame = self::evaluate($record->actions, $variables);

                    if ($frame !== null) {
                        $frames[$placed] = $frame;
                        break;
                    }
                }
            }

            if ($placed === null) {
                continue;
            }

            try {
                $character = $extractor->character($placed);
            } catch (Throwable) {
                continue;
            }

            if ($character instanceof SpriteDefinition) {
                self::walk($extractor, $character->tag, $variables, $frames, $visited);
            }
        }
    }

    /**
     * Replay one action list and return the frame it jumps to, or null when it
     * is not a jump driven by one of the wrapper's variables.
     *
     * The AVM shipped with arakne-swf covers the constant pool, pushes, member
     * lookups and method calls; `Add2` and `GotoFrame2` are handled here.
     *
     * @param list<ActionRecord> $actions
     * @param array<string, int> $variables
     */
    private static function evaluate(array $actions, array $variables): ?int
    {
        $scope = new VariantScope($variables);
        $recorder = new FrameRecorder();

        $state = new State();
        $state->variables['_parent'] = $scope;
        $state->variables['this'] = $recorder;

        $processor = new Processor(allowFunctionCall: true);
        $jump = null;

        foreach ($actions as $action) {
            switch ($action->opcode) {
                case Opcode::ActionAdd2:
                    $right = array_pop($state->stack);
                    $left = array_pop($state->stack);

                    if (!is_int($left) || !is_int($right)) {
                        return null;
                    }

                    $state->stack[] = $left + $right;
                    break;

                case Opcode::ActionGotoFrame2:
                    $target = array_pop($state->stack);

                    if (is_int($target)) {
                        $jump = $target;
                    }
                    break;

                default:
                    try {
                        $processor->execute($state, $action);
                    } catch (Throwable) {
                        return null;
                    }
            }
        }

        $frame = $recorder->frame ?? $jump;

        return $scope->used ? $frame : null;
    }
}
