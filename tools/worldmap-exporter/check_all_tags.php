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

echo "=== ALL TAGS in Sprite 1307 ===\n\n";

$sprite = $extractor->character(SPRITE_ID);

echo "Total tags: " . count($sprite->tag->tags) . "\n\n";

foreach ($sprite->tag->tags as $index => $tag) {
    $tagType = get_class($tag);
    $tagName = substr($tagType, strrpos($tagType, '\\') + 1);

    echo "Tag #$index: $tagName\n";

    // Show relevant properties based on tag type
    if (property_exists($tag, 'depth')) {
        echo "  Depth: {$tag->depth}\n";
    }
    if (property_exists($tag, 'characterId')) {
        echo "  Character ID: {$tag->characterId}\n";
    }
    if (property_exists($tag, 'name')) {
        echo "  Name: {$tag->name}\n";
    }
    if (property_exists($tag, 'label')) {
        echo "  Label: {$tag->label}\n";
    }
}

echo "\n=== Looking for depth 0 ===\n";
$depthZeroFound = false;
foreach ($sprite->tag->tags as $tag) {
    if (property_exists($tag, 'depth') && $tag->depth === 0) {
        $depthZeroFound = true;
        $tagType = get_class($tag);
        $tagName = substr($tagType, strrpos($tagType, '\\') + 1);
        echo "Found depth 0: $tagName\n";
        if (property_exists($tag, 'characterId')) {
            echo "  Character ID: {$tag->characterId}\n";
        }
    }
}

if (!$depthZeroFound) {
    echo "No depth 0 found\n";
}

echo "\n=== All unique depths used ===\n";
$depths = [];
foreach ($sprite->tag->tags as $tag) {
    if (property_exists($tag, 'depth')) {
        $depths[] = $tag->depth;
    }
}
$depths = array_unique($depths);
sort($depths);
echo "Depths: " . implode(', ', $depths) . "\n";
echo "Total unique depths: " . count($depths) . "\n";
