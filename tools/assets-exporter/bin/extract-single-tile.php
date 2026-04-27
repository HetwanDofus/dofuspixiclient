<?php
// One-off: extract a single tile by id from o*.swf (or g*.swf) into /tmp.
// Usage: php extract-single-tile.php <tileId> [ground|objects]
require __DIR__ . '/../vendor/autoload.php';

use Arakne\Swf\SwfFile;
use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;

$tileId = (int)($argv[1] ?? 628);
$kind = $argv[2] ?? 'objects';
$prefix = $kind === 'ground' ? 'g' : 'o';

$gfxDir = __DIR__ . '/../../../assets/sources/clips/gfx';
$outDir = "/tmp/tile-$tileId";
@mkdir($outDir, 0755, true);

$swfFiles = glob("$gfxDir/{$prefix}*.swf");
foreach ($swfFiles as $swfPath) {
    $swf = new SwfFile($swfPath, errors: Errors::IGNORE_INVALID_TAG & ~Errors::EXTRA_DATA & ~Errors::UNPROCESSABLE_DATA);
    if (!$swf->valid()) continue;

    $extractor = new SwfExtractor($swf);
    $exported = $extractor->exported();

    foreach ($exported as $name => $characterId) {
        if ((int)$name !== $tileId) continue;

        $character = $extractor->character($characterId);
        if (!($character instanceof SpriteDefinition || $character instanceof ShapeDefinition)) continue;

        $isSprite = $character instanceof SpriteDefinition;
        if ($isSprite) {
            $timeline = $character->timeline();
            $frameCount = $timeline->framesCount(true);
            $drawable = $timeline;
        } else {
            $frameCount = 1;
            $drawable = $character;
        }

        echo "found tile $tileId in " . basename($swfPath) . ", frameCount=$frameCount\n";
        $converter = new Converter(subpixelStrokeWidth: false);
        for ($i = 0; $i < $frameCount; $i++) {
            try {
                $svg = $converter->toSvg($drawable, $i);
                file_put_contents("$outDir/tile_$i.svg", $svg);
                echo "  wrote tile_$i.svg (" . strlen($svg) . " bytes)\n";
            } catch (\Throwable $e) {
                echo "  frame $i FAILED: " . $e->getMessage() . "\n";
            }
        }
        exit(0);
    }
}

echo "tile $tileId not found in any $prefix*.swf\n";
exit(1);
