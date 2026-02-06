<?php

require_once __DIR__ . '/vendor/autoload.php';

use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\SwfFile;

const SWF_PATH = __DIR__ . '/../../assets/sources/loader.swf';
const SPRITE_ID = 1307;

$swf = new SwfFile(SWF_PATH, Errors::IGNORE_INVALID_TAG);
$extractor = new SwfExtractor($swf);

echo "=== Analyzing UI_Banner (1307) ActionScript References ===\n\n";

$sprite = $extractor->character(SPRITE_ID);

if (!$sprite instanceof SpriteDefinition) {
    die("ERROR: Character " . SPRITE_ID . " is not a sprite\n");
}

// Check for DoAction tags
echo "ActionScript code in sprite tags:\n";
$foundActions = false;

foreach ($sprite->tag->tags as $tag) {
    if (get_class($tag) === 'Arakne\Swf\Parser\Structure\Tag\DoActionTag') {
        $foundActions = true;
        echo "\n✓ Found DoActionTag\n";
        echo "  Actions count: " . count($tag->actions) . "\n";

        // Try to find string references (these might be export names for attachMovie)
        foreach ($tag->actions as $action) {
            if (method_exists($action, 'data')) {
                $data = $action->data;
                if (is_string($data) && strlen($data) > 0) {
                    echo "  String reference: $data\n";
                }
            }
        }
    }
}

if (!$foundActions) {
    echo "✗ No ActionScript code found in sprite tags\n";
}

echo "\n=== Timeline Frame Labels ===\n";
$timeline = $sprite->timeline();
foreach ($timeline->frames as $frameIndex => $frame) {
    if ($frame->label) {
        echo "Frame $frameIndex: Label = '{$frame->label}'\n";
    }
}

echo "\n=== Only Directly Nested Characters ===\n";
echo "These are the ONLY characters that should be extracted:\n\n";

$directlyNested = [];
foreach ($sprite->tag->tags as $tag) {
    if (property_exists($tag, 'characterId') && $tag->characterId !== null) {
        $directlyNested[] = $tag->characterId;
    }
}
$directlyNested = array_unique($directlyNested);

$exported = $extractor->exported();
$exportNameMap = array_flip($exported);

foreach ($directlyNested as $charId) {
    $exportName = $exportNameMap[$charId] ?? 'Not exported';
    echo "  Character $charId: $exportName\n";

    // Show nested children
    try {
        $char = $extractor->character($charId);
        if ($char instanceof SpriteDefinition) {
            $childIds = [];
            foreach ($char->tag->tags as $childTag) {
                if (property_exists($childTag, 'characterId') && $childTag->characterId !== null) {
                    $childIds[] = $childTag->characterId;
                }
            }
            $childIds = array_unique($childIds);
            foreach ($childIds as $childId) {
                $childName = $exportNameMap[$childId] ?? 'Not exported';
                echo "    └─ Child $childId: $childName\n";
            }
        }
    } catch (\Exception $e) {
        // Skip
    }
}

echo "\n=== Recommendation ===\n";
echo "Extract ONLY the " . count($directlyNested) . " directly nested characters and their children.\n";
echo "Do NOT extract unrelated UI sprites like Chat, Inventory, etc.\n";
