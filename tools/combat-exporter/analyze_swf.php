<?php

require 'vendor/autoload.php';

use Arakne\Swf\SwfFile;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\Parser\Structure\Tag\DefineSpriteTag;
use Arakne\Swf\Parser\Structure\Tag\FrameLabelTag;
use Arakne\Swf\Parser\Structure\Tag\ShowFrameTag;
use Arakne\Swf\Error\Errors;

$swfPath = $argv[1] ?? null;

if (!$swfPath) {
    echo "Usage: php analyze_swf.php <path-to-swf>\n";
    exit(1);
}

$swf = new SwfFile($swfPath, errors: Errors::IGNORE_INVALID_TAG);

echo "=== SWF Analysis: " . basename($swfPath) . " ===\n\n";
echo "Frame count: " . $swf->header()->frameCount . "\n";
echo "Frame rate: " . $swf->frameRate() . " fps\n\n";

// Skip sound check - focus on sprites

// Check main timeline actions
echo "\n=== Main Timeline Actions ===\n";
foreach ($swf->tags(DoActionTag::TYPE) as $tag) {
    foreach ($tag->actions as $action) {
        echo "  " . $action->opcode->name;
        if ($action->data !== null) {
            if (is_array($action->data)) {
                echo " " . json_encode($action->data);
            } elseif (is_string($action->data)) {
                echo ' "' . substr($action->data, 0, 80) . '"';
            } else {
                echo " " . $action->data;
            }
        }
        echo "\n";
    }
}

// Check sprite internal actions
echo "\n=== Sprite Internal Tags ===\n";

foreach ($swf->tags(DefineSpriteTag::TYPE) as $spriteTag) {
    $hasContent = false;
    $frameNum = 0;
    $output = "";

    foreach ($spriteTag->tags as $ctag) {
        if ($ctag instanceof DoActionTag) {
            $output .= "  Frame $frameNum actions:\n";
            foreach ($ctag->actions as $action) {
                $output .= "    " . $action->opcode->name;
                if ($action->data !== null) {
                    if (is_array($action->data)) {
                        $output .= " " . json_encode($action->data);
                    } elseif (is_string($action->data)) {
                        $output .= ' "' . substr($action->data, 0, 80) . '"';
                    } elseif (is_object($action->data)) {
                        $output .= " " . json_encode($action->data);
                    } else {
                        $output .= " " . $action->data;
                    }
                }
                $output .= "\n";
            }
            $hasContent = true;
        }

        if ($ctag instanceof FrameLabelTag) {
            $output .= "  Frame label at frame $frameNum: \"" . $ctag->label . "\"\n";
            $hasContent = true;
        }

        // Check for sound using class name
        $className = get_class($ctag);
        if (str_contains($className, 'Sound')) {
            $output .= "  Sound tag ($className) at frame $frameNum\n";
            $hasContent = true;
        }

        // Count frames
        if ($ctag instanceof ShowFrameTag) {
            $frameNum++;
        }
    }

    if ($hasContent) {
        echo "\nSprite ID " . $spriteTag->spriteId . " ($frameNum frames):\n";
        echo $output;
    }
}
