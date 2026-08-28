<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Arakne\Swf\SwfFile;
use Arakne\Swf\Extractor\SwfExtractor;

/**
 * Extract metadata from character sprite SWFs:
 * - Accessory attachment points (slot, depth, x, y per animation frame)
 * - Color zone fill colors (hex values per zone, sprite-level)
 * - Color zone mapping (getColorIndex table)
 *
 * Parses AS2 bytecode in SWF frame actions to find GAC.applyAccessory
 * and GAC.applyColor calls at each body part depth.
 */
class ExtractSpriteMetadataCommand extends Command
{
    private const SPRITES_PATH = __DIR__ . '/../../../../assets/sources/clips/sprites';

    /**
     * Per-class colour-zone permutation. Empty by design — see WHY below.
     *
     * The original entries here were copied from
     * `GlobalSpriteHandler.getColorIndex()` in canonical AS2. That function
     * IS canonical, but it is only invoked through the
     * `applyHeadColor / applyBodyColor / applyBottomColor` wrappers, and the
     * vanilla class sprites (10/11/20/21/.../120/121) DO NOT call those
     * wrappers — they call `applyColor(this, N)` directly with a literal N,
     * which `GlobalSpriteHandler.applyColor` then resolves with
     * `_loc5_["color" + nZone]` (identity, no permutation).
     *
     * Verified by string-dumping the SWFs: sprite/10.swf only references
     * `applyColor` / `applyAccessory`, never the head/body/bottom wrappers.
     * Wrapper usage shows up only on a small set of cosmetic SWFs (9274,
     * 9280, 9294 and `clips/sprites/accessories/a5-a8.swf`,
     * `clips/items/82/*.swf`). Those need their own extraction path; for
     * the breed sprites the right answer is identity.
     *
     * Symptom of applying the old (wrong) table on Iop class 10:
     * `color2 = red` ended up tinting the skin/hair zone (sprite AS2 zone 3
     * → permuted to player_color_index 2) instead of the blue-clothing
     * zone (AS2 zone 2). The artwork side, which I built with identity, was
     * tinting the cape — visible mismatch between sprite and StringCourse
     * preview, despite both being canonical-correct in their own logic.
     */
    private const COLOR_MAPPINGS = [];

    private string $outputBase;

    protected function configure(): void
    {
        $this
            ->setName('sprites:metadata')
            ->setDescription('Extract accessory attachment points and color zones from character sprite SWFs')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory', __DIR__ . '/../../../../apps/electrobun/public/assets/spritesheets/sprites')
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'Only extract a specific sprite ID');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->outputBase = $input->getOption('output');
        $filterId = $input->getOption('id');

        $io->title('Sprite Metadata Extractor');

        $swfFiles = glob(self::SPRITES_PATH . '/*.swf');
        $extracted = 0;
        $skipped = 0;

        foreach ($swfFiles as $swfPath) {
            $spriteId = basename($swfPath, '.swf');
            if (!is_numeric($spriteId)) continue;
            if ($filterId !== null && $spriteId !== $filterId) continue;

            $outDir = "{$this->outputBase}/{$spriteId}";
            if (!is_dir($outDir)) {
                @mkdir($outDir, 0755, true);
            }

            try {
                $metadata = $this->extractMetadata($swfPath, (int) $spriteId);
                if ($metadata) {
                    file_put_contents(
                        "$outDir/metadata.json",
                        json_encode($metadata, JSON_UNESCAPED_UNICODE)
                    );
                    $extracted++;
                }
            } catch (\Exception $e) {
                if ($output->isVerbose()) {
                    $io->warning("Failed: $spriteId — " . $e->getMessage());
                }
            }
        }

        $io->success("Done: $extracted metadata files extracted, $skipped skipped");
        return Command::SUCCESS;
    }

    private function extractMetadata(string $swfPath, int $spriteId): ?array
    {
        $swf = new SwfFile($swfPath);
        $ext = new SwfExtractor($swf);
        $exported = $ext->exported();

        $colorZones = []; // zone => [hex colors]
        $animations = [];
        $applyEndFrames = []; // animName => frame index (0-based) where GAC.applyEnd fires
        $converter = new Converter(subpixelStrokeWidth: false);

        // First pass: extract color zones from a single animation (staticR or first available)
        $colorAnimName = null;
        foreach (['staticR', 'staticS', 'staticF'] as $try) {
            if (isset($exported[$try])) { $colorAnimName = $try; break; }
        }
        if (!$colorAnimName) $colorAnimName = array_key_first($exported);

        if ($colorAnimName && isset($exported[$colorAnimName])) {
            $colorChar = $ext->character($exported[$colorAnimName]);
            if ($colorChar instanceof SpriteDefinition) {
                $this->extractAnimation($colorChar, $colorAnimName, $ext, $converter, $colorZones, true);
                $ext->releaseIfOutOfMemory();
            }
        }

        // Second pass: extract accessory attachment points for all animations (no color extraction)
        foreach ($exported as $animName => $charId) {
            $character = $ext->character($charId);
            if (!($character instanceof SpriteDefinition)) continue;

            $animFrames = $this->extractAnimation($character, $animName, $ext, $converter, $colorZones, false);
            if ($animFrames !== null) {
                $animations[$animName] = $animFrames;
            }

            // Independently scan the animation's inner timeline for the
            // canonical `GAC.applyEnd(this)` call. That call routes
            // through GlobalSpriteHandler.applyEnd → sequencer.onActionEnd
            // (GlobalSpriteHandler.as:430) to advance the blocking
            // setAnim sequencer step, which is what triggers spell
            // visuals to launch (SpriteHandler.as:782 → 791
            // addAction(20, addEffect)). Without this metadata the
            // runtime can only fall back to the 1000ms Sequencer cap.
            $applyEnd = $this->findApplyEndFrame($character);
            if ($applyEnd !== null) {
                $applyEndFrames[$animName] = $applyEnd;
            }

            $ext->releaseIfOutOfMemory();
        }

        $ext->release();

        if (empty($animations)) return null;

        // Deduplicate colors per zone
        foreach ($colorZones as $zone => $colors) {
            $colorZones[$zone] = array_values(array_unique($colors));
        }

        // Get color mapping for this gfxId
        $colorMapping = self::COLOR_MAPPINGS[(string) $spriteId] ?? [1 => 1, 2 => 2, 3 => 3];

        $payload = [
            'gfxId' => $spriteId,
            'colorZones' => $colorZones,
            'colorMapping' => $colorMapping,
            'animations' => $animations,
        ];
        if (!empty($applyEndFrames)) {
            // 0-based inner-timeline frame indices. The runtime
            // PlayerRenderer reads this map (sprite.gfxId + animName →
            // frame index) and fires its one-shot completion callback
            // when the playhead reaches that frame, instead of waiting
            // for the last frame OR the 1000ms canonical Sequencer
            // fallback. Per AS frame numbering, AS `frame_31` = index 30.
            $payload['applyEndFrames'] = $applyEndFrames;
        }
        return $payload;
    }

    private function extractAnimation(
        SpriteDefinition $character,
        string $animName,
        SwfExtractor $ext,
        Converter $converter,
        array &$colorZones,
        bool $extractColors = false
    ): ?array {
        // Navigate: animation → wrapper child → inner sprite
        $timeline = $character->timeline();
        $frames = $this->getFrames($timeline);
        if (empty($frames)) return null;

        $allFrameData = [];

        // Process only the first outer frame that carries the pose.
        // Usually the animation places a single wrapper whose own timeline
        // holds the frames; a minority place the body parts flat (see
        // resolveBodyPartFrames).
        foreach ($frames as $frameIdx => $frame) {
            $objects = $this->getObjects($frame);
            if (empty($objects)) continue;

            $innerFrames = $this->resolveBodyPartFrames($frame, $objects);
            if (empty($innerFrames)) continue;

            foreach ($innerFrames as $innerFrameIdx => $innerFrame) {
                $bodyParts = $this->getObjects($innerFrame);
                $frameData = ['accessories' => [], 'parts' => []];

                foreach ($bodyParts as $depth => $bp) {
                    $bpObj = $this->getChildObject($bp);

                    // Build part entry for every body part (depth-ordered)
                    $partEntry = ['depth' => $depth];

                    if ($bpObj instanceof SpriteDefinition) {
                        $matrix = $this->getMatrix($bp);
                        $tx = $matrix ? round($matrix['tx'] / 20, 2) : 0;
                        $ty = $matrix ? round($matrix['ty'] / 20, 2) : 0;

                        $calls = $this->parseGacCalls($bpObj);

                        foreach ($calls as $call) {
                            if ($call['method'] === 'applyAccessory') {
                                $partEntry['accessory'] = $call['slot'];
                                // Store full affine matrix: [a, b, c, d, tx, ty]
                                // SWF matrix values: sx/sy/r0/r1 are floats, tx/ty are in twips
                                $a = $matrix ? round($matrix['sx'], 4) : 1;
                                $b = $matrix ? round($matrix['r0'] ?? 0, 4) : 0;
                                $c = $matrix ? round($matrix['r1'] ?? 0, 4) : 0;
                                $d = $matrix ? round($matrix['sy'], 4) : 1;
                                $accEntry = [
                                    'slot' => $call['slot'],
                                    'depth' => $depth,
                                    'x' => $tx,
                                    'y' => $ty,
                                    'matrix' => [$a, $b, $c, $d, $tx, $ty],
                                ];
                                // `side` is the timeline frame name the accessory
                                // MUST goto (e.g. "R", "L", "RR"). This is the only
                                // authoritative source for shield/cape directional
                                // overrides — the runtime truth table is a
                                // guess that fails for rotated / asymmetric poses.
                                if (isset($call['side'])) {
                                    $accEntry['side'] = $call['side'];
                                }
                                $frameData['accessories'][] = $accEntry;
                            } elseif ($call['method'] === 'applyColor') {
                                $partEntry['colorZone'] = $call['zone'];
                                if ($extractColors) {
                                    $zone = $call['zone'];
                                    $colors = $this->extractFillColors($bpObj, $converter);
                                    if (!isset($colorZones[$zone])) {
                                        $colorZones[$zone] = [];
                                    }
                                    $colorZones[$zone] = array_merge($colorZones[$zone], $colors);
                                }
                            }
                        }
                    }

                    $frameData['parts'][] = $partEntry;
                }

                $allFrameData[] = $frameData;
            }
            break; // Only process the first valid outer frame
        }
        return empty($allFrameData) ? null : $allFrameData;
    }

    /**
     * The frames whose placed objects are this animation's body parts.
     *
     * Nearly every sprite exports an animation clip that places a single
     * child — a wrapper whose own timeline carries the pose frames — so
     * descending into it is the usual reading.
     *
     * A minority place their body parts **flat** on the animation clip
     * itself. `9073/staticR` (the auction-house vendor, shared by 55
     * placements) places fourteen, at depths 1, 11, 13, 14, 17, 19, 22, 29,
     * 30, 34, 35, 37, 56 and 57, with no wrapper at all. Descending there
     * mistakes body part #1 for the wrapper and publishes *its* single child
     * as the whole part list, dropping the other thirteen — the sprite then
     * compiles down to a 5 px fragment. See QA-100.
     *
     * Object count alone does not separate the two: `1072/bonusR` places a
     * wrapper *and* a second clip, and its real 7 parts live one level down.
     * So both readings are built and the richer one wins — a wrapper always
     * yields more parts than the handful of objects sitting beside it, and a
     * flat pose always yields more than the one child of its first part.
     *
     * @return array frames to read body parts from — empty when the
     *               animation holds nothing usable
     */
    private function resolveBodyPartFrames($frame, array $objects): array
    {
        $wrapped = [];

        foreach ($objects as $candidate) {
            $inner = $this->getChildObject($candidate);
            if (!($inner instanceof SpriteDefinition)) continue;

            $wrapped = $this->getFrames($inner->timeline());
            break;
        }

        // No sprite child at all: `_liaison_` and friends. Nothing to read —
        // skipping keeps them out of the metadata, as before.
        if (empty($wrapped)) {
            return count($objects) > 1 ? [$frame] : [];
        }

        $wrappedParts = count($this->getObjects(reset($wrapped)));

        return $wrappedParts >= count($objects) ? $wrapped : [$frame];
    }

    /**
     * Walk an exported animation's wrapper → inner timeline and find
     * the FIRST inner frame whose `DoAction` calls `GAC.applyEnd(this)`.
     *
     * Returns 0-based frame index, or null if no applyEnd is present.
     *
     * Verified against canonical Feca (sprite 10):
     *   anim1R wrapper chid 698 → inner DefineSprite_676 (69 frames)
     *   frame_31/DoAction.as:  GAC.applyEnd(this);  → returns 30
     */
    private function findApplyEndFrame(SpriteDefinition $character): ?int
    {
        $timeline = $character->timeline();
        $frames = $this->getFrames($timeline);
        if (empty($frames)) return null;

        // Wrapper sprite = exported anim symbol, usually a 1-frame
        // PlaceObject2 of the actual inner timeline.
        foreach ($frames as $frame) {
            $objects = $this->getObjects($frame);
            if (empty($objects)) continue;
            $wrapperObj = reset($objects);
            $innerSprite = $this->getChildObject($wrapperObj);
            if (!($innerSprite instanceof SpriteDefinition)) continue;

            $innerTimeline = $innerSprite->timeline();
            $innerFrames = $this->getFrames($innerTimeline);
            if (empty($innerFrames)) continue;

            foreach ($innerFrames as $innerFrameIdx => $innerFrame) {
                if ($this->frameCallsApplyEnd($innerFrame)) {
                    return $innerFrameIdx;
                }
            }
            // Only consider the first valid wrapper; mirrors
            // extractAnimation's `break;` after the first wrapper.
            break;
        }
        return null;
    }

    /**
     * Inspect a single timeline frame's DoAction tags for the bytecode
     * sequence `... ActionPush "applyEnd" ... ActionCallMethod ...`.
     * Same pattern parseGacCalls uses to detect `applyAccessory` /
     * `applyColor` — we only need the call-name match, not the args.
     */
    private function frameCallsApplyEnd($frame): bool
    {
        $actions = $this->getActions($frame);
        if (empty($actions)) return false;

        foreach ($actions as $tag) {
            $records = $this->getActionRecords($tag);
            $pushStack = [];

            foreach ($records as $rec) {
                $opcode = $this->getOpcode($rec);
                $data = $this->getData($rec);

                if ($opcode === 'ActionPush' && is_array($data)) {
                    foreach ($data as $v) {
                        if (is_object($v)) {
                            $pushStack[] = $this->getValueFromPush($v);
                        }
                    }
                } elseif ($opcode === 'ActionCallMethod') {
                    if (in_array('applyEnd', $pushStack, true)) {
                        return true;
                    }
                    $pushStack = [];
                }
            }
        }
        return false;
    }

    /**
     * Parse AS2 bytecode in a body part sprite to find GAC.applyColor and GAC.applyAccessory calls.
     */
    private function parseGacCalls(SpriteDefinition $sprite): array
    {
        $calls = [];
        $timeline = $sprite->timeline();
        $frames = $this->getFrames($timeline);

        foreach ($frames as $frame) {
            $actions = $this->getActions($frame);
            foreach ($actions as $tag) {
                $records = $this->getActionRecords($tag);
                $pushStack = [];

                foreach ($records as $rec) {
                    $opcode = $this->getOpcode($rec);
                    $data = $this->getData($rec);

                    if ($opcode === 'ActionPush' && is_array($data)) {
                        foreach ($data as $v) {
                            if (is_object($v)) {
                                $val = $this->getValueFromPush($v);
                                $pushStack[] = $val;
                            }
                        }
                    } elseif ($opcode === 'ActionCallMethod') {
                        // AS2 call stack (bottom→top): args..., argCount, objectRef, methodName
                        // applyColor(clipRef, zone) → stack: [zone, clipRef, 2, "GAC", "applyColor"]
                        // applyAccessory(mc, slot, side, ...) → stack: [side, slot, mc, argCount, "GAC", "applyAccessory"]
                        if (in_array('applyAccessory', $pushStack)) {
                            // Find slot: first integer 0-10 in stack
                            $slot = null;
                            foreach ($pushStack as $v) {
                                if (is_int($v) && $v >= 0 && $v <= 10) {
                                    $slot = $v;
                                    break;
                                }
                            }
                            // Find side: first short non-empty string in stack that
                            // isn't a GAC/method identifier. Dofus calls always pass
                            // one of "R"/"L"/"F"/"B"/"S"/"WR"/"WL"/... as the third
                            // arg, so we capture the shortest such string.
                            $side = null;
                            foreach ($pushStack as $v) {
                                if (is_string($v)
                                    && $v !== ''
                                    && strlen($v) <= 3
                                    && $v !== 'GAC'
                                    && $v !== 'applyAccessory'
                                    && $v !== 'applyColor') {
                                    $side = $v;
                                    break;
                                }
                            }
                            if ($slot !== null) {
                                $call = ['method' => 'applyAccessory', 'slot' => $slot];
                                if ($side !== null) {
                                    $call['side'] = $side;
                                }
                                $calls[] = $call;
                            }
                        } elseif (in_array('applyColor', $pushStack)) {
                            // Zone is the FIRST value pushed (first element)
                            $zone = null;
                            foreach ($pushStack as $v) {
                                if (is_int($v) && $v >= 1 && $v <= 3) {
                                    $zone = $v;
                                    break;
                                }
                            }
                            if ($zone !== null) {
                                $calls[] = ['method' => 'applyColor', 'zone' => $zone];
                            }
                        }
                        $pushStack = [];
                    }
                }
            }
        }

        return $calls;
    }

    /**
     * Extract unique fill colors (hex) from a body part sprite's SVG.
     */
    private function extractFillColors(SpriteDefinition $sprite, Converter $converter): array
    {
        try {
            $svg = $converter->toSvg($sprite, 0);
            if (empty($svg)) return [];

            preg_match_all('/fill="(#[0-9a-fA-F]{6})"/', $svg, $matches);
            return array_unique($matches[1] ?? []);
        } catch (\Exception $e) {
            return [];
        }
    }

    // ── Reflection helpers ──

    private function getFrames($timeline): array
    {
        $rc = new \ReflectionClass($timeline);
        $fp = $rc->getProperty('frames');
        $fp->setAccessible(true);
        return $fp->getValue($timeline);
    }

    private function getObjects($frame): array
    {
        $rc = new \ReflectionClass($frame);
        $op = $rc->getProperty('objects');
        $op->setAccessible(true);
        return $op->getValue($frame);
    }

    private function getActions($frame): array
    {
        $rc = new \ReflectionClass($frame);
        $ap = $rc->getProperty('actions');
        $ap->setAccessible(true);
        return $ap->getValue($frame);
    }

    private function getChildObject($frameObject)
    {
        $rc = new \ReflectionClass($frameObject);
        $op = $rc->getProperty('object');
        $op->setAccessible(true);
        return $op->getValue($frameObject);
    }

    private function getMatrix($frameObject): ?array
    {
        $rc = new \ReflectionClass($frameObject);
        $mp = $rc->getProperty('matrix');
        $mp->setAccessible(true);
        $matrix = $mp->getValue($frameObject);
        if (!$matrix) return null;

        $mrc = new \ReflectionClass($matrix);
        $result = [];
        foreach (['translateX' => 'tx', 'translateY' => 'ty', 'scaleX' => 'sx', 'scaleY' => 'sy', 'rotateSkew0' => 'r0', 'rotateSkew1' => 'r1'] as $prop => $key) {
            try {
                $p = $mrc->getProperty($prop);
                $p->setAccessible(true);
                $result[$key] = $p->getValue($matrix);
            } catch (\ReflectionException $e) {
                $result[$key] = 0;
            }
        }
        return $result;
    }

    private function getActionRecords($tag): array
    {
        $rc = new \ReflectionClass($tag);
        $ap = $rc->getProperty('actions');
        $ap->setAccessible(true);
        return $ap->getValue($tag);
    }

    private function getOpcode($record): string
    {
        $rc = new \ReflectionClass($record);
        $op = $rc->getProperty('opcode');
        $op->setAccessible(true);
        return $op->getValue($record)->name;
    }

    private function getData($record)
    {
        $rc = new \ReflectionClass($record);
        $dp = $rc->getProperty('data');
        $dp->setAccessible(true);
        return $dp->getValue($record);
    }

    private function getValueFromPush($valueObj)
    {
        $rc = new \ReflectionClass($valueObj);
        $vp = $rc->getProperty('value');
        $vp->setAccessible(true);
        return $vp->getValue($valueObj);
    }
}
