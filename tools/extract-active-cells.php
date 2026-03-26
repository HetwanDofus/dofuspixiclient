<?php
/**
 * Extract the 'active' flag for every cell of every map using the Arakne PHP Map Parser.
 *
 * Outputs a JSON file mapping mapId -> array of active booleans (indexed by cellId).
 *
 * Usage: php extract-active-cells.php
 */

require_once '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/tools/php-map-parser/vendor/autoload.php';

use Arakne\MapParser\Loader\MapLoader;
use Arakne\MapParser\Loader\MapKey;
use Arakne\MapParser\Loader\MapStructure;
use Arakne\Swf\SwfFile;

$mapsDir = '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/clients/Retro1.47/retroclient/data/maps';
$keysDir = '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/MapKeys-DR/maps';
$outputFile = __DIR__ . '/active-cells.json';

$loader = new MapLoader();
$result = [];
$errors = [];

// Build a key lookup: mapId -> key file path
$keyFiles = [];
foreach (glob("$keysDir/*.txt") as $keyFile) {
    $basename = basename($keyFile, '.txt');
    $mapId = (int) explode('_', $basename)[0];
    $keyFiles[$mapId] = $keyFile;
}

// Process all SWF map files
$swfFiles = glob("$mapsDir/*.swf");
$total = count($swfFiles);
$processed = 0;

fprintf(STDERR, "Processing %d maps...\n", $total);

foreach ($swfFiles as $swfPath) {
    $processed++;
    $basename = basename($swfPath, '.swf');
    // Remove trailing X for encrypted maps
    $cleanName = rtrim($basename, 'X');
    $mapId = (int) explode('_', $cleanName)[0];

    if ($processed % 500 === 0) {
        fprintf(STDERR, "  %d/%d maps processed...\n", $processed, $total);
    }

    try {
        $structure = MapStructure::fromSwfFile(new SwfFile($swfPath));

        $attachments = [];
        if ($structure->encrypted && isset($keyFiles[$mapId])) {
            $attachments[] = MapKey::fromFile($keyFiles[$mapId]);
        }

        $map = $loader->load($structure, ...$attachments);

        $activeFlags = [];
        foreach ($map->cells as $i => $cell) {
            $activeFlags[] = $cell->active;
        }

        $result[$mapId] = $activeFlags;
    } catch (\Throwable $e) {
        $errors[] = "Map $mapId: " . $e->getMessage();
    }
}

// Write output
file_put_contents($outputFile, json_encode($result));

fprintf(STDERR, "Done. %d maps processed, %d errors.\n", count($result), count($errors));
if ($errors) {
    fprintf(STDERR, "Errors:\n");
    foreach (array_slice($errors, 0, 10) as $err) {
        fprintf(STDERR, "  %s\n", $err);
    }
}
fprintf(STDERR, "Output: %s\n", $outputFile);
