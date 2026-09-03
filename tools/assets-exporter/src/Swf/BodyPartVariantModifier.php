<?php

namespace App\Swf;

use Arakne\Swf\Extractor\Modifier\AbstractCharacterModifier;
use Arakne\Swf\Extractor\Modifier\GotoAndStop;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Parser\Structure\Action\Opcode;
use Arakne\Swf\Parser\Structure\Action\Value;
use Arakne\Swf\Parser\Structure\Tag\DefineSpriteTag;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\Parser\Structure\Tag\ShowFrameTag;
use Override;

use function is_array;

/**
 * Holds a breed sprite's *variant* body parts on their first frame.
 *
 * A body part of a Dofus 1.29 character is a still: the pose lives on the
 * animation's own inner timeline and each part is a one-frame clip placed
 * with a per-frame matrix. A part that carries **several** frames is not
 * animating — it is a set of alternatives the ActionScript picks between,
 * and the only one in the breed sprites is the head:
 *
 *   frame 1 — the hair as the character wears it;
 *   frame 2 — the hair cut short, so a hat sits on it.
 *
 * Nothing in the SWF advances that clip. `GAC.applyAccessory(this, 1,
 * "R_tete", _parent)` on the hat anchor hands the head over precisely so a
 * hat can jump it to frame 2; with no hat it must never leave frame 1.
 * Extraction has no such call to replay, and the converter renders every
 * nested clip at the parent's own frame index — so from the second frame of
 * every animation the Iop's head came out with the short hair, which is what
 * "the hair disappears as soon as he moves" was (QA-149).
 *
 * The test is deliberately narrow. A multi-frame nested clip is pinned only
 * when it calls `GAC.applyColor`, which is what makes it a *drawn, tinted
 * body part*: the accessory anchors (5, 9, 16, 28 frames — one per direction
 * label) and the genuinely animated sub-clips (the hit flash, the level-up
 * star) carry no such call and keep all of their frames.
 */
final class BodyPartVariantModifier extends AbstractCharacterModifier
{
    #[Override]
    public function applyOnSprite(SpriteDefinition $sprite): SpriteDefinition
    {
        if (!self::isVariantBodyPart($sprite->tag)) {
            return $sprite;
        }

        // `maxDepth: 1` — the clip's own timeline and nothing below it.
        return $sprite->modify(new GotoAndStop(1), 1);
    }

    private static function isVariantBodyPart(DefineSpriteTag $tag): bool
    {
        $frames = 0;
        $tinted = false;

        foreach ($tag->tags as $child) {
            if ($child instanceof ShowFrameTag) {
                ++$frames;
                continue;
            }

            if ($child instanceof DoActionTag && !$tinted) {
                $tinted = self::callsApplyColor($child);
            }
        }

        return $frames > 1 && $tinted;
    }

    private static function callsApplyColor(DoActionTag $tag): bool
    {
        foreach ($tag->actions as $action) {
            if ($action->opcode !== Opcode::ActionPush || !is_array($action->data)) {
                continue;
            }

            foreach ($action->data as $pushed) {
                if ($pushed instanceof Value && $pushed->value === 'applyColor') {
                    return true;
                }
            }
        }

        return false;
    }
}
