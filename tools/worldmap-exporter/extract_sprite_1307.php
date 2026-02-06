<?php

require_once __DIR__ . '/vendor/autoload.php';

use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Drawer\Converter\ScaleResizer;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\SwfFile;

// Configuration
const SCALE_FACTOR = 6;
const SPRITE_ID = 1307;
const SWF_PATH = __DIR__ . '/../../assets/sources/loader.swf';
const OUTPUT_DIR = __DIR__ . '/../../assets/output/sprite_1307';

echo "=======================================================================\n";
echo "Sprite 1307 (UI_Banner) Nested Characters Extractor\n";
echo "=======================================================================\n";
echo "This extracts ONLY the characters directly nested in sprite 1307,\n";
echo "not all UI sprites from the entire SWF file.\n";
echo "=======================================================================\n";
echo "Source: " . SWF_PATH . "\n";
echo "Sprite ID: " . SPRITE_ID . " (UI_Banner)\n";
echo "Scale: " . SCALE_FACTOR . "x\n";
echo "Output: " . OUTPUT_DIR . "\n\n";

// Check if SWF file exists
if (!file_exists(SWF_PATH)) {
    die("ERROR: SWF file not found: " . SWF_PATH . "\n");
}

// Create output directory
if (!is_dir(OUTPUT_DIR)) {
    mkdir(OUTPUT_DIR, 0755, true);
    echo "✓ Created output directory\n\n";
}

try {
    echo "[1/3] Loading loader.swf...\n";
    // Use NONE to parse all tags including those after corrupted ones
    // IGNORE_INVALID_TAG would skip tags after the corrupted DoActionTag!
    $swf = new SwfFile(SWF_PATH, Errors::NONE);
    $extractor = new SwfExtractor($swf);
    $scaleResizer = new ScaleResizer(scale: SCALE_FACTOR);
    $converter = new Converter(resizer: $scaleResizer, subpixelStrokeWidth: false);
    echo "✓ SWF loaded successfully\n\n";

    echo "[2/3] Extracting sprite " . SPRITE_ID . "...\n";
    $sprite = $extractor->character(SPRITE_ID);

    if (!$sprite instanceof SpriteDefinition) {
        die("ERROR: Character " . SPRITE_ID . " is not a sprite\n");
    }

    echo "✓ Sprite found\n\n";

    echo "[3/3] Recursively extracting ALL nested characters...\n";

    // Recursively find all nested character IDs
    function findAllNestedCharacters($extractor, $characterId, &$visited = []) {
        if (isset($visited[$characterId])) {
            return []; // Already processed
        }
        $visited[$characterId] = true;

        $nested = [];

        try {
            $character = $extractor->character($characterId);

            // If it's a sprite, look for nested characters in both tags and timeline
            if ($character instanceof SpriteDefinition) {
                // Method 1: Check raw tags for PlaceObject references
                foreach ($character->tag->tags as $tag) {
                    if (property_exists($tag, 'characterId') && $tag->characterId !== null) {
                        $nestedId = $tag->characterId;
                        $nested[] = $nestedId;
                        // Recursively find characters nested in this one
                        $nested = array_merge($nested, findAllNestedCharacters($extractor, $nestedId, $visited));
                    }
                }

                // Method 2: Also check timeline objects for additional characters
                try {
                    $timeline = $character->timeline();
                    foreach ($timeline->frames as $frame) {
                        foreach ($frame->objects as $frameObject) {
                            $obj = $frameObject->object;
                            // Try to get ID from known types
                            if (property_exists($obj, 'id') && !isset($visited[$obj->id])) {
                                $nestedId = $obj->id;
                                $nested[] = $nestedId;
                                $nested = array_merge($nested, findAllNestedCharacters($extractor, $nestedId, $visited));
                            }
                        }
                    }
                } catch (\Exception $e) {
                    // Timeline might fail, continue with tags only
                }
            }
        } catch (\Exception $e) {
            // Skip if character can't be loaded
        }

        return $nested;
    }

    $visited = [];
    $nestedCharacterIds = findAllNestedCharacters($extractor, SPRITE_ID, $visited);
    $nestedCharacterIds = array_unique($nestedCharacterIds);

    echo "✓ Found " . count($nestedCharacterIds) . " total nested character(s) (recursive)\n\n";

    $extracted = 0;
    $skipped = 0;
    $failed = 0;
    $manifest = [];

    foreach ($nestedCharacterIds as $characterId) {
        echo "Processing character $characterId... ";

        try {
            $character = $extractor->character($characterId);

            // Try to extract any drawable character
            if (method_exists($character, 'bounds')) {
                try {
                    $webpData = $converter->toWebp($character, 0, ['quality' => 95]);
                    $filename = OUTPUT_DIR . '/character_' . $characterId . '.webp';

                    if (file_put_contents($filename, $webpData)) {
                        $bounds = $character->bounds();
                        $type = get_class($character);
                        $typeName = substr($type, strrpos($type, '\\') + 1);

                        $manifest[$characterId] = [
                            'character_id' => $characterId,
                            'type' => $typeName,
                            'file' => 'character_' . $characterId . '.webp',
                            'width' => $bounds->width() / 20,
                            'height' => $bounds->height() / 20,
                            'offsetX' => $bounds->xmin / 20,
                            'offsetY' => $bounds->ymin / 20,
                        ];
                        echo "✓ Extracted ($typeName)\n";
                        $extracted++;
                    } else {
                        echo "✗ Failed to write file\n";
                        $failed++;
                    }
                } catch (\Exception $e) {
                    echo "⚠ Skipped (can't render: " . $e->getMessage() . ")\n";
                    $skipped++;
                }
            } else {
                echo "⚠ Skipped (not drawable)\n";
                $skipped++;
            }
        } catch (\Exception $e) {
            echo "✗ Failed: " . $e->getMessage() . "\n";
            $failed++;
        }
    }

    echo "\n";
    echo "=======================================================================\n";
    echo "Extraction Complete!\n";
    echo "=======================================================================\n";
    echo "✓ Extracted: $extracted character(s)\n";
    if ($skipped > 0) {
        echo "⚠ Skipped: $skipped non-sprite character(s)\n";
    }
    if ($failed > 0) {
        echo "✗ Failed: $failed character(s)\n";
    }

    // Save manifest
    $manifestData = [
        'version' => '1.0',
        'generated' => date('c'),
        'source' => 'loader.swf',
        'sprite_id' => SPRITE_ID,
        'scale' => SCALE_FACTOR,
        'total_nested' => count($nestedCharacterIds),
        'extracted' => $extracted,
        'skipped' => $skipped,
        'failed' => $failed,
        'characters' => $manifest,
    ];

    $manifestPath = OUTPUT_DIR . '/manifest.json';
    if (file_put_contents($manifestPath, json_encode($manifestData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES))) {
        echo "✓ Manifest saved: $manifestPath\n";
    }

    echo "\nOutput directory: " . OUTPUT_DIR . "\n";

} catch (\Exception $e) {
    echo "\nERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
