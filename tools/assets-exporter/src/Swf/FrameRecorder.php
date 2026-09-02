<?php

namespace App\Swf;

use function is_int;

/**
 * Stands in for `this` while replaying a clip's `gotoAndStop` call, recording
 * the frame it asks for instead of playing it.
 */
final class FrameRecorder
{
    public ?int $frame = null;

    public function gotoAndStop(mixed $frame): void
    {
        if (is_int($frame)) {
            $this->frame = $frame;
        }
    }
}
