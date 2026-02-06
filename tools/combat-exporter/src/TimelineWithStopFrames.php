<?php

declare(strict_types=1);

namespace App;

use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\Timeline\Frame;
use Arakne\Swf\Extractor\Timeline\Timeline;

/**
 * Utility class to wrap a Timeline with stop frame handling for specified child sprites.
 *
 * This allows pre-rendered frames to respect ActionScript stop() calls while correctly
 * allowing nested child sprites to continue their own animations.
 *
 * Flash's stop() behavior:
 * - When stop() is called on a MovieClip, its playhead stays at that frame
 * - The DISPLAY LIST (which children are visible) freezes at the stop frame
 * - But CHILDREN continue playing their own independent timelines
 *
 * We use StopFrameTimeline (not StopFrameSprite) to correctly implement this.
 */
final class TimelineWithStopFrames
{
    /**
     * Create a new Timeline where specified child sprites have stop frame handling applied.
     *
     * @param Timeline $timeline The original timeline to wrap
     * @param array<int, int> $stopFrameMap Map of characterId => stopFrame
     * @return Timeline A new timeline with wrapped child sprites
     */
    public static function wrap(Timeline $timeline, array $stopFrameMap): Timeline
    {
        if (empty($stopFrameMap)) {
            return $timeline;
        }

        $newFrames = [];
        foreach ($timeline->frames as $frame) {
            $newFrames[] = self::wrapFrame($frame, $stopFrameMap);
        }

        return new Timeline($timeline->bounds, ...$newFrames);
    }

    /**
     * Wrap a single Frame's objects with stop frame handling where applicable.
     */
    private static function wrapFrame(Frame $frame, array $stopFrameMap): Frame
    {
        $newObjects = [];
        $hasChanges = false;

        foreach ($frame->objects as $depth => $frameObject) {
            $characterId = $frameObject->object->id;
            $nestedObject = $frameObject->object;

            // Check if this characterId has a stop frame defined
            if (isset($stopFrameMap[$characterId])) {
                $stopFrame = $stopFrameMap[$characterId];

                // For SpriteDefinitions, we need to use StopFrameTimeline to correctly
                // handle nested children - freezing the display list but allowing children
                // to continue their own animations
                if ($nestedObject instanceof SpriteDefinition) {
                    $nestedTimeline = $nestedObject->timeline();

                    // First, recursively wrap any nested children that have stop frames
                    $wrappedNestedTimeline = self::wrap($nestedTimeline, $stopFrameMap);

                    // Then wrap with StopFrameTimeline to handle this sprite's stop frame
                    $stopFrameTimeline = new StopFrameTimeline($wrappedNestedTimeline, $stopFrame);

                    // Create a wrapper that uses the modified timeline
                    $wrappedSprite = new StopFrameTimelineWrapper($nestedObject, $stopFrameTimeline);
                    $newObjects[$depth] = $frameObject->with(object: $wrappedSprite);
                    $hasChanges = true;
                } else {
                    // For non-sprite objects (shapes, etc.), use StopFrameSprite
                    // These don't have nested children, so simple clamping works
                    $wrappedObject = new StopFrameSprite($nestedObject, $stopFrame);
                    $newObjects[$depth] = $frameObject->with(object: $wrappedObject);
                    $hasChanges = true;
                }
            } else {
                // Check for nested sprites recursively even if they don't have a stop frame
                // Their children might have stop frames
                if ($nestedObject instanceof SpriteDefinition) {
                    $nestedTimeline = $nestedObject->timeline();
                    $wrappedTimeline = self::wrap($nestedTimeline, $stopFrameMap);

                    // If the nested timeline changed, we need to wrap it
                    if ($wrappedTimeline !== $nestedTimeline) {
                        // Create a wrapper that uses the modified timeline
                        $wrappedSprite = new StopFrameTimelineWrapper($nestedObject, $wrappedTimeline);
                        $newObjects[$depth] = $frameObject->with(object: $wrappedSprite);
                        $hasChanges = true;
                        continue;
                    }
                }
                $newObjects[$depth] = $frameObject;
            }
        }

        if (!$hasChanges) {
            return $frame;
        }

        return new Frame($frame->bounds, $newObjects, $frame->actions, $frame->label);
    }
}
