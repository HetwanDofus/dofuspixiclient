<?php

namespace App\Swf;

use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Parser\Structure\Action\Opcode;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\Parser\Structure\Tag\PlaceObject2Tag;
use Arakne\Swf\Parser\Structure\Tag\ShowFrameTag;

use function is_int;

/**
 * Reads the state machine an interactive element's timeline really is.
 *
 * A 1.29 interactive element (a tree, an ore vein, a fishing spot) is one
 * clip whose *root* timeline has one frame per state: nothing advances it but
 * the server, which sends `GDF;<cell>;<frame>` and the client answers with
 * `gotoAndStop(frame)`. The art lives in the nested clip each frame places:
 *
 *   - a frame that places it under an `onClipEvent` (`stop()`, or
 *     `gotoAndStop(n)`) is a **still** — the state's resting image;
 *   - a frame that places it bare lets it **play** — the state's transition
 *     (the tree falling, the crop growing back), which ends by calling
 *     `_parent.gotoAndStop(...)` to hand over to the resting state;
 *   - a frame that places nothing keeps the previous still on screen.
 *
 * Extraction has no AVM, so it cannot replay any of that: it walks the root
 * timeline one frame at a time and hands the same tick to every nested clip,
 * which yields neither the states nor the transitions — frame 2 of an ash
 * tree came out as a half-fallen tree, and the stump the felled one leaves
 * was in none of the published frames at all (QA-145).
 *
 * This resolver returns, for each state, *where* in the nested clip its
 * frames start and how many there are. {@see ExtractTileCommand} exports the
 * states end to end and records their ranges in the manifest, so the client
 * can hold a still, or play a transition once and rest on its last frame.
 *
 * @phpstan-type State array{frame:int, nested:int, count:int}
 */
final class InteractiveStateResolver
{
    /**
     * @return list<State>|null The states, in root-frame order (`frame` is
     *         the 1-based number the server names), or null when the sprite
     *         is not an interactive element.
     */
    public static function resolve(SpriteDefinition $sprite): ?array
    {
        $rootFrames = $sprite->timeline()->frames;

        if (count($rootFrames) < 2) {
            return null;
        }

        $states = [];
        $index = 0;
        $stopsOnFirstFrame = false;
        $placed = false;
        $pinned = null;
        $hasTransition = false;
        $hasHandover = false;

        foreach ($sprite->tag->tags as $tag) {
            if ($tag instanceof DoActionTag) {
                foreach ($tag->actions as $action) {
                    // A timeline that drives itself is an animation, whatever
                    // else it looks like: a `random` tile rolls its variant,
                    // an animated one plays or jumps on its own. Only the
                    // server moves an interactive element.
                    if (
                        $action->opcode === Opcode::ActionRandomNumber
                        || $action->opcode === Opcode::ActionPlay
                        || $action->opcode === Opcode::ActionGotoFrame
                        || $action->opcode === Opcode::ActionGotoFrame2
                    ) {
                        return null;
                    }

                    if ($action->opcode === Opcode::ActionStop && $index === 0) {
                        $stopsOnFirstFrame = true;
                    }
                }

                continue;
            }

            if ($tag instanceof PlaceObject2Tag && $tag->characterId !== null) {
                $placed = true;
                $pinned ??= self::pinnedFrame($tag);

                continue;
            }

            if (!($tag instanceof ShowFrameTag)) {
                continue;
            }

            $previous = $index > 0 ? $states[$index - 1]['nested'] : 0;
            $state = ['frame' => $index + 1, 'nested' => $previous, 'count' => 1];

            if ($placed && $pinned === null) {
                $state['nested'] = 0;
                $state['count'] = max(1, $rootFrames[$index]?->framesCount(true) ?? 1);
                $hasTransition = $hasTransition || $state['count'] > 1;
            } elseif ($pinned !== null) {
                $state['nested'] = $pinned;
                $hasHandover = $hasHandover || $pinned > 0;
            }

            $states[] = $state;

            $index++;
            $placed = false;
            $pinned = null;
        }

        if (!$stopsOnFirstFrame || count($states) !== count($rootFrames)) {
            return null;
        }

        // The signature of the idiom: a state that plays, or one pinned to
        // the frame another one ends on (the stump a felling leaves). Without
        // either, the clip is a pile of stills nothing moves between, and the
        // flat export already renders it correctly.
        return $hasTransition || $hasHandover ? $states : null;
    }

    /**
     * The nested frame an `onClipEvent` pins the placed clip to, or null when
     * the clip is placed bare and therefore plays.
     *
     * `stop()` pins it where it is (frame 0); `gotoAndStop(n)` pins it to
     * `n`, which is how a felled tree keeps its stump on screen — the handler
     * carries the last frame of the falling clip.
     */
    private static function pinnedFrame(PlaceObject2Tag $placement): ?int
    {
        if ($placement->clipActions === null) {
            return null;
        }

        $pinned = null;

        foreach ($placement->clipActions->records as $record) {
            foreach ($record->actions as $action) {
                if ($action->opcode === Opcode::ActionGotoFrame && is_int($action->data)) {
                    $pinned = $action->data;
                }

                if ($action->opcode === Opcode::ActionStop && $pinned === null) {
                    $pinned = 0;
                }
            }
        }

        return $pinned;
    }
}
