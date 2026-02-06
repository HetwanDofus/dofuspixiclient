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
$exported = $extractor->exported();
$exportNameMap = array_flip($exported);

echo "=== RAW TAGS Analysis for Sprite 1307 ===\n\n";

$sprite = $extractor->character(SPRITE_ID);

echo "Analyzing all raw tags in sprite...\n\n";

$placeObjectCount = 0;
$allCharacterIds = [];

foreach ($sprite->tag->tags as $index => $tag) {
    $tagType = get_class($tag);
    $tagName = substr($tagType, strrpos($tagType, '\\') + 1);

    // Check for PlaceObject tags
    if (strpos($tagName, 'PlaceObject') !== false) {
        $placeObjectCount++;

        $charId = property_exists($tag, 'characterId') ? $tag->characterId : null;
        $depth = property_exists($tag, 'depth') ? $tag->depth : 'N/A';
        $name = property_exists($tag, 'name') ? $tag->name : 'unnamed';
        $move = property_exists($tag, 'move') ? ($tag->move ? 'MOVE' : 'ADD') : 'ADD';

        if ($charId !== null) {
            $allCharacterIds[] = $charId;
            $exportName = $exportNameMap[$charId] ?? 'Not exported';
            echo "Tag #$index - $tagName ($move):\n";
            echo "  Depth: $depth\n";
            echo "  Character ID: $charId ($exportName)\n";
            echo "  Instance name: $name\n\n";
        } else {
            echo "Tag #$index - $tagName ($move):\n";
            echo "  Depth: $depth\n";
            echo "  Character ID: NULL (modifying existing instance)\n";
            echo "  Instance name: $name\n\n";
        }
    }
}

echo "=== Summary ===\n";
echo "Total PlaceObject tags: $placeObjectCount\n";

$uniqueCharIds = array_unique($allCharacterIds);
sort($uniqueCharIds);

echo "Unique character IDs: " . count($uniqueCharIds) . "\n";
echo "Character IDs: " . implode(', ', $uniqueCharIds) . "\n\n";

echo "=== All Character IDs with Export Names ===\n";
foreach ($uniqueCharIds as $charId) {
    $exportName = $exportNameMap[$charId] ?? 'Not exported';
    echo "  - Character $charId: $exportName\n";
}

echo "\n=== Comparison ===\n";
$timeline = $sprite->timeline();
echo "Timeline shows " . count($timeline->frames[0]->objects) . " objects\n";
echo "Raw tags show $placeObjectCount PlaceObject tags\n";

if ($placeObjectCount > count($timeline->frames[0]->objects)) {
    echo "\n⚠ WARNING: More PlaceObject tags than timeline objects!\n";
    echo "Some objects might be hidden or filtered out.\n";
}
