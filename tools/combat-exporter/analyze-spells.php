<?php

declare(strict_types=1);

/**
 * Spell ActionScript Analyzer
 *
 * Extracts ActionScript from all spell SWF files and analyzes which ones
 * need custom TypeScript implementations beyond simple stop().
 */

$inputDir = $argv[1] ?? null;
$outputDir = $argv[2] ?? './spell-analysis';
$ffdec = '/Applications/FFDec.app/Contents/Resources/ffdec.sh';

if (!$inputDir || !is_dir($inputDir)) {
    echo "Usage: php analyze-spells.php <input-dir> [output-dir]\n";
    exit(1);
}

@mkdir($outputDir, 0755, true);
$scriptsDir = "$outputDir/scripts";
@mkdir($scriptsDir, 0755, true);

// Find all spell SWF files
$swfFiles = glob("$inputDir/*.swf");
echo "Found " . count($swfFiles) . " spell files\n\n";

// Categories for spells
$categories = [
    'simple_stop' => [],      // Only stop() calls - no custom TS needed
    'gotoAndPlay' => [],      // Uses gotoAndPlay - might need frame control
    'variables' => [],        // Uses variables (t, alpha, scale, etc.)
    'onEnterFrame' => [],     // Uses onEnterFrame - needs ticker
    'timing' => [],           // Uses setInterval/setTimeout
    'math_random' => [],      // Uses Math.random()
    'target_distance' => [],  // References target, distance, etc.
    'complex' => [],          // Multiple complex patterns
    'no_script' => [],        // No ActionScript at all
];

// Variables of interest
$variablePatterns = [
    'distance' => '/\bdistance\b/i',
    'target' => '/\b_target\b|\btarget\b/i',
    'cible' => '/\bcible\b/i',
    'vitesse' => '/\bvitesse\b/i',
    'speed' => '/\bspeed\b/i',
    't' => '/\bthis\.t\b|\b_root\.t\b/',
    'alpha' => '/\balpha\b/',
    'scale' => '/\b_xscale\b|\b_yscale\b|\bscale\b/i',
    'rotation' => '/\b_rotation\b|\brotation\b/i',
];

// Action patterns
$actionPatterns = [
    'stop' => '/\bstop\s*\(\s*\)\s*;/',
    'play' => '/\bplay\s*\(\s*\)\s*;/',
    'gotoAndPlay' => '/\bgotoAndPlay\s*\(/i',
    'gotoAndStop' => '/\bgotoAndStop\s*\(/i',
    'onEnterFrame' => '/\bonEnterFrame\b/',
    'setInterval' => '/\bsetInterval\b/',
    'setTimeout' => '/\bsetTimeout\b/',
    'Math_random' => '/\bMath\.random\b/',
    'attachMovie' => '/\battachMovie\b/',
    'removeMovieClip' => '/\bremoveMovieClip\b/',
    'duplicateMovieClip' => '/\bduplicateMovieClip\b/',
    'loadMovie' => '/\bloadMovie\b/',
    '_parent' => '/\b_parent\b/',
    '_root' => '/\b_root\b/',
];

$spellAnalysis = [];

foreach ($swfFiles as $i => $swfFile) {
    $spellId = (int) pathinfo($swfFile, PATHINFO_FILENAME);
    $spellDir = "$scriptsDir/$spellId";

    // Export ActionScript
    @mkdir($spellDir, 0755, true);
    $cmd = sprintf(
        '%s -export script %s %s 2>&1',
        escapeshellarg($ffdec),
        escapeshellarg($spellDir),
        escapeshellarg($swfFile)
    );

    exec($cmd, $output, $returnCode);

    // Find all .as files
    $asFiles = [];
    if (is_dir($spellDir)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($spellDir)
        );
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'as') {
                $asFiles[] = $file->getPathname();
            }
        }
    }

    // Analyze the scripts
    $analysis = [
        'id' => $spellId,
        'hasScript' => !empty($asFiles),
        'scriptCount' => count($asFiles),
        'actions' => [],
        'variables' => [],
        'complexity' => 'simple',
        'notes' => [],
    ];

    $allContent = '';
    foreach ($asFiles as $asFile) {
        $content = file_get_contents($asFile);
        $allContent .= "\n" . $content;
    }

    if (empty($asFiles)) {
        $analysis['complexity'] = 'none';
        $categories['no_script'][] = $spellId;
    } else {
        // Check for action patterns
        foreach ($actionPatterns as $name => $pattern) {
            if (preg_match($pattern, $allContent)) {
                $analysis['actions'][] = $name;
            }
        }

        // Check for variable patterns
        foreach ($variablePatterns as $name => $pattern) {
            if (preg_match($pattern, $allContent)) {
                $analysis['variables'][] = $name;
            }
        }

        // Categorize
        $hasComplexActions = !empty(array_intersect($analysis['actions'],
            ['onEnterFrame', 'setInterval', 'setTimeout', 'attachMovie', 'duplicateMovieClip']));
        $hasVariables = !empty($analysis['variables']);
        $hasGoto = in_array('gotoAndPlay', $analysis['actions']) || in_array('gotoAndStop', $analysis['actions']);
        $hasRandom = in_array('Math_random', $analysis['actions']);

        // Determine complexity
        if ($hasComplexActions && $hasVariables) {
            $analysis['complexity'] = 'complex';
            $categories['complex'][] = $spellId;
        } elseif (in_array('onEnterFrame', $analysis['actions'])) {
            $analysis['complexity'] = 'ticker';
            $categories['onEnterFrame'][] = $spellId;
        } elseif (in_array('setInterval', $analysis['actions']) || in_array('setTimeout', $analysis['actions'])) {
            $analysis['complexity'] = 'timing';
            $categories['timing'][] = $spellId;
        } elseif (!empty(array_intersect($analysis['variables'], ['distance', 'target', 'cible']))) {
            $analysis['complexity'] = 'target_dependent';
            $categories['target_distance'][] = $spellId;
        } elseif ($hasRandom) {
            $analysis['complexity'] = 'random';
            $categories['math_random'][] = $spellId;
        } elseif ($hasVariables) {
            $analysis['complexity'] = 'variables';
            $categories['variables'][] = $spellId;
        } elseif ($hasGoto) {
            $analysis['complexity'] = 'gotoAndPlay';
            $categories['gotoAndPlay'][] = $spellId;
        } else {
            // Only has stop/play - simple
            $analysis['complexity'] = 'simple';
            $categories['simple_stop'][] = $spellId;
        }

        // Extract specific patterns for notes
        if (preg_match('/\bdistance\s*[*\/+-]?\s*(\d+)?/', $allContent, $m)) {
            $analysis['notes'][] = 'Uses distance calculation';
        }
        if (preg_match('/\bvitesse\s*=\s*(\d+)/', $allContent, $m)) {
            $analysis['notes'][] = "Speed: {$m[1]}";
        }
        if (preg_match('/gotoAndPlay\s*\(\s*(\d+|"[^"]+"|\'[^\']+\')\s*\)/', $allContent, $m)) {
            $analysis['notes'][] = "gotoAndPlay({$m[1]})";
        }
    }

    $spellAnalysis[$spellId] = $analysis;

    // Progress
    if (($i + 1) % 50 === 0) {
        echo "Processed " . ($i + 1) . "/" . count($swfFiles) . " spells\n";
    }
}

// Generate report
$report = "# Spell ActionScript Analysis Report\n\n";
$report .= "Generated: " . date('Y-m-d H:i:s') . "\n\n";
$report .= "Total spells analyzed: " . count($swfFiles) . "\n\n";

$report .= "## Summary by Category\n\n";
$report .= "| Category | Count | Description |\n";
$report .= "|----------|-------|-------------|\n";
$report .= "| No Script | " . count($categories['no_script']) . " | No ActionScript - pure animation |\n";
$report .= "| Simple Stop | " . count($categories['simple_stop']) . " | Only stop() calls - no custom TS needed |\n";
$report .= "| GotoAndPlay | " . count($categories['gotoAndPlay']) . " | Uses gotoAndPlay - might need frame jumps |\n";
$report .= "| Variables | " . count($categories['variables']) . " | Uses variables (t, alpha, scale) |\n";
$report .= "| onEnterFrame | " . count($categories['onEnterFrame']) . " | Uses onEnterFrame - needs ticker |\n";
$report .= "| Timing | " . count($categories['timing']) . " | Uses setInterval/setTimeout |\n";
$report .= "| Math.random | " . count($categories['math_random']) . " | Uses randomization |\n";
$report .= "| Target/Distance | " . count($categories['target_distance']) . " | References target, distance - needs game data |\n";
$report .= "| Complex | " . count($categories['complex']) . " | Multiple complex patterns - needs custom TS |\n";
$report .= "\n";

// Spells that need custom TypeScript
$needsCustomTS = array_merge(
    $categories['onEnterFrame'],
    $categories['timing'],
    $categories['target_distance'],
    $categories['complex']
);
sort($needsCustomTS);

$report .= "## Spells Requiring Custom TypeScript (" . count($needsCustomTS) . ")\n\n";
$report .= "These spells have ActionScript logic that cannot be handled by simple pre-rendering.\n\n";

foreach ($needsCustomTS as $spellId) {
    $analysis = $spellAnalysis[$spellId];
    $report .= "### Spell $spellId\n";
    $report .= "- Complexity: {$analysis['complexity']}\n";
    $report .= "- Actions: " . implode(', ', $analysis['actions']) . "\n";
    if (!empty($analysis['variables'])) {
        $report .= "- Variables: " . implode(', ', $analysis['variables']) . "\n";
    }
    if (!empty($analysis['notes'])) {
        $report .= "- Notes: " . implode('; ', $analysis['notes']) . "\n";
    }
    $report .= "\n";
}

// Simple spells that just need pre-rendering
$report .= "## Simple Spells (No Custom TS Needed)\n\n";
$report .= "These spells can be handled with pre-rendered frames or simple stop frame logic.\n\n";
$report .= "IDs: " . implode(', ', array_merge($categories['no_script'], $categories['simple_stop'], $categories['gotoAndPlay'])) . "\n\n";

// Variable usage spells
$report .= "## Spells Using Variables (May Need Custom TS)\n\n";
foreach ($categories['variables'] as $spellId) {
    $analysis = $spellAnalysis[$spellId];
    $report .= "- **$spellId**: " . implode(', ', $analysis['variables']);
    if (!empty($analysis['notes'])) {
        $report .= " (" . implode('; ', $analysis['notes']) . ")";
    }
    $report .= "\n";
}
$report .= "\n";

// Random spells
$report .= "## Spells Using Math.random()\n\n";
$report .= "These spells have randomized behavior that needs implementation.\n\n";
$report .= "IDs: " . implode(', ', $categories['math_random']) . "\n\n";

// Write report
file_put_contents("$outputDir/analysis-report.md", $report);

// Also write JSON for programmatic access
file_put_contents("$outputDir/spell-analysis.json", json_encode([
    'generated' => date('c'),
    'summary' => [
        'total' => count($swfFiles),
        'no_script' => count($categories['no_script']),
        'simple_stop' => count($categories['simple_stop']),
        'gotoAndPlay' => count($categories['gotoAndPlay']),
        'variables' => count($categories['variables']),
        'onEnterFrame' => count($categories['onEnterFrame']),
        'timing' => count($categories['timing']),
        'math_random' => count($categories['math_random']),
        'target_distance' => count($categories['target_distance']),
        'complex' => count($categories['complex']),
    ],
    'categories' => $categories,
    'spells' => $spellAnalysis,
], JSON_PRETTY_PRINT));

echo "\n\nAnalysis complete!\n";
echo "Report written to: $outputDir/analysis-report.md\n";
echo "JSON data written to: $outputDir/spell-analysis.json\n\n";

echo "Summary:\n";
echo "- No script: " . count($categories['no_script']) . "\n";
echo "- Simple stop: " . count($categories['simple_stop']) . "\n";
echo "- GotoAndPlay: " . count($categories['gotoAndPlay']) . "\n";
echo "- Variables: " . count($categories['variables']) . "\n";
echo "- onEnterFrame (needs ticker): " . count($categories['onEnterFrame']) . "\n";
echo "- Timing (setInterval/setTimeout): " . count($categories['timing']) . "\n";
echo "- Math.random: " . count($categories['math_random']) . "\n";
echo "- Target/Distance: " . count($categories['target_distance']) . "\n";
echo "- Complex: " . count($categories['complex']) . "\n";
echo "\nTotal needing custom TS: " . count($needsCustomTS) . "\n";
