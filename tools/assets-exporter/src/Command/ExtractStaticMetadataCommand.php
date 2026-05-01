<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Extractor\Timeline\Timeline;
use Arakne\Swf\Parser\Structure\Action\Type as ActionValueType;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

use function sprintf;

/**
 * Extract color-zone metadata from static-shape SWFs (artworks, emblems,
 * auras, alignments). Walks the timeline recursively, parses zone-marker
 * AS2 calls on each body-part sprite, and emits a per-id metadata.json with
 * the same shape character-sprite metadata uses:
 *
 *   { gfxId, colorZones: { "1": [#hex, ...], ... }, colorMapping: { "1": N } }
 *
 * Two zone-marker mechanisms are recognized — they're the same canonical
 * pattern with different host-callback names:
 *
 *   - `GAC.applyColor(this, zone)` — used by character sprites and chevauchors
 *     (host: dofus.aks.GAC). The call lives on a body-part sprite's own
 *     timeline; `this` is the sprite, so we extract fills from the sprite
 *     whose actions we're scanning.
 *
 *   - `this.stringCourseColor(<namedClip>, zone)` — used by `artworks/big`
 *     portrait SWFs (host: `dofus.graphics.gapi.ui.StringCourse`, which
 *     injects the `stringCourseColor` callback on the loaded artwork's
 *     content; PlayerShop uses the same hook). The call lives on the
 *     SWF's *root* timeline, and the target clip is referenced by its
 *     PlaceObject2 name (e.g. "cheveux", "cape", "shirt"). We resolve
 *     the named FrameObject and extract fills from its underlying
 *     SpriteDefinition.
 *
 * Both mechanisms can use a Constant Pool (ActionConstantPool) so the
 * method-name push lands as a Constant8/Constant16 index. We resolve
 * those via the active pool while scanning, so `in_array('applyColor', ...)`
 * works regardless of how the SWF compiler chose to encode strings.
 */
class ExtractStaticMetadataCommand extends Command
{
    private const ZONE_MARKER_METHODS = ['applyColor', 'stringCourseColor'];

    private Converter $converter;

    protected function configure(): void
    {
        $this
            ->setName('static:metadata')
            ->setDescription('Extract color-zone metadata from static SWFs (artworks, emblems, auras, alignments)')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input dir containing *.swf')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output dir (one subdir per id)')
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'Only extract this id')
            ->addOption('identity-mapping', null, InputOption::VALUE_NONE,
                'Emit identity colorMapping {1:1,2:2,3:3} instead of requiring a sprite-side table');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $inputDir = (string) $input->getOption('input');
        $outputDir = (string) $input->getOption('output');
        $filterId = $input->getOption('id');
        $identityMapping = (bool) $input->getOption('identity-mapping');

        if (!$inputDir || !is_dir($inputDir)) {
            $io->error('Missing or invalid --input');
            return Command::FAILURE;
        }
        if (!$outputDir) {
            $io->error('Missing --output');
            return Command::FAILURE;
        }

        @mkdir($outputDir, 0755, true);
        $this->converter = new Converter(subpixelStrokeWidth: false);

        $extracted = 0;
        $skipped = 0;
        $noZones = 0;

        foreach (glob($inputDir . '/*.swf') ?: [] as $swfPath) {
            $id = pathinfo($swfPath, PATHINFO_FILENAME);
            if ($filterId !== null && $id !== (string) $filterId) continue;

            $metadata = $this->extractMetadata($swfPath, $id, $identityMapping);
            if ($metadata === null) {
                $skipped++;
                continue;
            }
            if (empty($metadata['colorZones'])) {
                $noZones++;
                continue;
            }

            $outFile = sprintf('%s/%s/metadata.json', $outputDir, $id);
            @mkdir(dirname($outFile), 0755, true);
            file_put_contents(
                $outFile,
                json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
            );
            $extracted++;
        }

        $io->success(sprintf(
            'Done: %d metadata files written, %d skipped, %d had no zones',
            $extracted,
            $skipped,
            $noZones
        ));
        return Command::SUCCESS;
    }

    private function extractMetadata(string $swfPath, string $id, bool $identityMapping): ?array
    {
        try {
            $swf = new SwfFile($swfPath);
            if (!$swf->valid()) return null;
            $ext = new SwfExtractor($swf);
        } catch (\Exception $e) {
            return null;
        }

        $colorZones = [];

        try {
            // (1) Sprite-internal `GAC.applyColor` markers (sprites, chevauchors,
            //     and any static SWF that uses the same in-sprite pattern). The
            //     export table is the canonical entry point for sprites.
            foreach ($ext->exported() as $name => $characterId) {
                $char = $ext->character($characterId);
                if (!($char instanceof SpriteDefinition)) continue;
                $this->walkForZones($char, $colorZones, 0);
            }

            // (2) Root-timeline `stringCourseColor(namedClip, zone)` markers
            //     (artworks/big and any UI-loaded artwork whose host injects
            //     the `stringCourseColor` callback). artworks/big SWFs export
            //     no symbols; the pattern only shows up here.
            $this->scanRootForStringCourseColor($ext, $colorZones);

            $ext->release();
        } catch (\Exception $e) {
            return null;
        }

        foreach ($colorZones as $z => $colors) {
            $colorZones[$z] = array_values(array_unique($colors));
        }

        $colorMapping = $identityMapping || !empty($colorZones)
            ? $this->deriveColorMapping($colorZones)
            : [];

        return [
            'gfxId' => ctype_digit((string) $id) ? (int) $id : $id,
            'colorZones' => $colorZones,
            'colorMapping' => $colorMapping,
        ];
    }

    private function walkForZones(SpriteDefinition $sprite, array &$zones, int $depth): void
    {
        if ($depth > 6) return; // guard against cycles
        $this->scanSpriteActionsForApplyColor($sprite, $zones);

        try {
            $frames = $this->getFrames($sprite->timeline());
            foreach ($frames as $frame) {
                $objects = $this->getObjects($frame) ?? [];
                foreach ($objects as $obj) {
                    $child = $this->getChildObject($obj);
                    if ($child instanceof SpriteDefinition) {
                        $this->walkForZones($child, $zones, $depth + 1);
                    }
                }
            }
        } catch (\Exception $e) {
            // ignore traversal errors — we already scanned this sprite's own actions
        }
    }

    /**
     * For every frame in this sprite's timeline, parse DoAction records for
     * `GAC.applyColor(this, zone)` calls. When found, scrape unique fill hex
     * colors from the sprite's rendered SVG and bucket them under the zone id.
     */
    private function scanSpriteActionsForApplyColor(SpriteDefinition $sprite, array &$zones): void
    {
        try {
            $frames = $this->getFrames($sprite->timeline());
        } catch (\Exception $e) {
            return;
        }

        foreach ($frames as $frame) {
            try {
                $actions = $this->getActions($frame);
            } catch (\Exception $e) {
                continue;
            }
            foreach ($actions as $tag) {
                try {
                    $records = $this->getActionRecords($tag);
                } catch (\Exception $e) {
                    continue;
                }
                foreach ($this->iterateMethodCalls($records) as $call) {
                    if ($call['method'] !== 'applyColor') continue;
                    $zone = $this->findZoneInt($call['stack']);
                    if ($zone === null) continue;
                    $colors = $this->extractFillColors($sprite);
                    if (!isset($zones[$zone])) $zones[$zone] = [];
                    $zones[$zone] = array_merge($zones[$zone], $colors);
                }
            }
        }
    }

    /**
     * Scan the SWF's root timeline for `stringCourseColor(namedClip, zone)`
     * calls. Each call's named target points at a FrameObject whose
     * underlying SpriteDefinition holds the fills we want to bucket under
     * that zone.
     */
    private function scanRootForStringCourseColor(SwfExtractor $ext, array &$zones): void
    {
        try {
            $timeline = $ext->timeline();
        } catch (\Exception $e) {
            return;
        }
        if (!$timeline instanceof Timeline) return;

        // Collect named children from all root frames so we can resolve
        // call targets by name. PlaceObject2 names are stable across the
        // single-frame artworks we care about, but iterate defensively.
        $namedChildren = [];
        try {
            $rootFrames = $this->getFrames($timeline);
        } catch (\Exception $e) {
            $rootFrames = [];
        }
        foreach ($rootFrames as $frame) {
            $objects = $this->getObjects($frame) ?? [];
            foreach ($objects as $obj) {
                $name = $this->getFrameObjectName($obj);
                if ($name === null || $name === '') continue;
                $child = $this->getChildObject($obj);
                if ($child instanceof SpriteDefinition && !isset($namedChildren[$name])) {
                    $namedChildren[$name] = $child;
                }
            }
        }

        foreach ($rootFrames as $frame) {
            try {
                $actions = $this->getActions($frame);
            } catch (\Exception $e) {
                continue;
            }
            foreach ($actions as $tag) {
                try {
                    $records = $this->getActionRecords($tag);
                } catch (\Exception $e) {
                    continue;
                }
                foreach ($this->iterateMethodCalls($records) as $call) {
                    if ($call['method'] !== 'stringCourseColor') continue;
                    $zone = $this->findZoneInt($call['stack']);
                    if ($zone === null) continue;

                    $target = $this->findTargetName($call['stack'], $namedChildren);
                    if ($target === null || !isset($namedChildren[$target])) {
                        // Couldn't resolve target — bail rather than colour
                        // every fill in the SWF under one zone (which would
                        // wrongly merge zones).
                        continue;
                    }

                    $colors = $this->extractFillColors($namedChildren[$target]);
                    if (!isset($zones[$zone])) $zones[$zone] = [];
                    $zones[$zone] = array_merge($zones[$zone], $colors);
                }
            }
        }
    }

    /**
     * Generator: walks an action-record stream, tracks the active constant
     * pool, and yields one descriptor per `ActionCallMethod`:
     *   ['method' => string|null, 'stack' => mixed[]]
     * The stack items are pre-resolved (Constant8/Constant16 → string from
     * pool), so callers can do `in_array('applyColor', $stack, true)`.
     */
    private function iterateMethodCalls(array $records): \Generator
    {
        $constantPool = [];
        $pushStack = [];

        foreach ($records as $rec) {
            $opcode = $this->getOpcode($rec);
            $data = $this->getData($rec);

            if ($opcode === 'ActionConstantPool' && is_array($data)) {
                $constantPool = $data;
                continue;
            }

            if ($opcode === 'ActionPush' && is_array($data)) {
                foreach ($data as $v) {
                    if (is_object($v)) {
                        $pushStack[] = $this->resolvePushValue($v, $constantPool);
                    }
                }
                continue;
            }

            if ($opcode === 'ActionCallMethod') {
                // Stack on entry (top→bottom): methodName, object, argCount, args...
                // The method name is the LAST value pushed before CallMethod,
                // which is the last entry of $pushStack at this point.
                $method = null;
                if (!empty($pushStack)) {
                    $top = $pushStack[count($pushStack) - 1];
                    if (is_string($top)) $method = $top;
                }
                yield ['method' => $method, 'stack' => $pushStack];
                $pushStack = [];
            }
        }
    }

    /**
     * Resolve one ActionPush Value object to its concrete payload.
     * Constant8/Constant16 indices are dereferenced via the active pool;
     * everything else returns the raw `value` field.
     */
    private function resolvePushValue(object $v, array $constantPool)
    {
        $rc = new \ReflectionClass($v);
        $type = null;
        if ($rc->hasProperty('type')) {
            $tp = $rc->getProperty('type');
            $tp->setAccessible(true);
            $type = $tp->getValue($v);
        }
        $value = null;
        if ($rc->hasProperty('value')) {
            $vp = $rc->getProperty('value');
            $vp->setAccessible(true);
            $value = $vp->getValue($v);
        }

        if ($type instanceof ActionValueType
            && ($type === ActionValueType::Constant8 || $type === ActionValueType::Constant16)
            && is_int($value)
            && isset($constantPool[$value])
        ) {
            return $constantPool[$value];
        }
        return $value;
    }

    private function findZoneInt(array $stack): ?int
    {
        foreach ($stack as $v) {
            if (is_int($v) && $v >= 1 && $v <= 3) return $v;
        }
        return null;
    }

    /**
     * Pull the named target argument from a stringCourseColor call. The AS2
     * idiom is `this.stringCourseColor(<name>, zone)`, which compiles to
     * `push zone, push <name>, getVariable, push 2, push "this", getVariable,
     * push "stringCourseColor", callMethod` — the resolved push stack
     * therefore contains the literal "<name>" string. We pick the first
     * stack entry that's a known named child.
     */
    private function findTargetName(array $stack, array $namedChildren): ?string
    {
        foreach ($stack as $v) {
            if (is_string($v) && isset($namedChildren[$v])) return $v;
        }
        return null;
    }

    private function extractFillColors(SpriteDefinition $sprite): array
    {
        try {
            $svg = $this->converter->toSvg($sprite, 0);
            if (!$svg) return [];
            preg_match_all('/fill="(#[0-9a-fA-F]{6})"/', $svg, $matches);
            return array_values(array_unique($matches[1] ?? []));
        } catch (\Exception $e) {
            return [];
        }
    }

    /**
     * Static shapes don't carry a remap table (that's sprite-specific). The
     * safe default: identity mapping — zone N tints to player_colors[N-1].
     * Callers with a specific remap (e.g. guild emblems) can post-process.
     */
    private function deriveColorMapping(array $zones): array
    {
        $mapping = [];
        foreach (array_keys($zones) as $zone) {
            $mapping[(string) $zone] = (int) $zone;
        }
        return $mapping;
    }

    // ── Reflection helpers (mirror the ones in ExtractSpriteMetadataCommand) ──

    private function getFrames($timeline): array
    {
        $rc = new \ReflectionClass($timeline);
        if (!$rc->hasProperty('frames')) return [];
        $fp = $rc->getProperty('frames');
        $fp->setAccessible(true);
        return $fp->getValue($timeline) ?? [];
    }

    private function getObjects($frame): array
    {
        $rc = new \ReflectionClass($frame);
        if (!$rc->hasProperty('objects')) return [];
        $op = $rc->getProperty('objects');
        $op->setAccessible(true);
        return $op->getValue($frame) ?? [];
    }

    private function getActions($frame): array
    {
        $rc = new \ReflectionClass($frame);
        if (!$rc->hasProperty('actions')) return [];
        $ap = $rc->getProperty('actions');
        $ap->setAccessible(true);
        return $ap->getValue($frame) ?? [];
    }

    private function getChildObject($frameObject)
    {
        $rc = new \ReflectionClass($frameObject);
        if (!$rc->hasProperty('object')) return null;
        $op = $rc->getProperty('object');
        $op->setAccessible(true);
        return $op->getValue($frameObject);
    }

    private function getFrameObjectName($frameObject): ?string
    {
        $rc = new \ReflectionClass($frameObject);
        if (!$rc->hasProperty('name')) return null;
        $np = $rc->getProperty('name');
        $np->setAccessible(true);
        $v = $np->getValue($frameObject);
        return is_string($v) ? $v : null;
    }

    private function getActionRecords($tag): array
    {
        $rc = new \ReflectionClass($tag);
        if (!$rc->hasProperty('actions')) return [];
        $ap = $rc->getProperty('actions');
        $ap->setAccessible(true);
        return $ap->getValue($tag) ?? [];
    }

    private function getOpcode($record): string
    {
        $rc = new \ReflectionClass($record);
        $op = $rc->getProperty('opcode');
        $op->setAccessible(true);
        $v = $op->getValue($record);
        return is_object($v) ? $v->name : (string) $v;
    }

    private function getData($record)
    {
        $rc = new \ReflectionClass($record);
        $dp = $rc->getProperty('data');
        $dp->setAccessible(true);
        return $dp->getValue($record);
    }
}
