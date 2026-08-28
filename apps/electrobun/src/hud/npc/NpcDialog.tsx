import { useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import {
  markNpcDialogAnswered,
  type NpcDialogAnswer,
  npcDialogStore,
} from "@/game/stores";

import { CharacterPortrait } from "../stats/CharacterPortrait";
import { LEAVE_ID, visibleAnswers } from "./answers";

interface NpcDialogProps {
  gameClient: GameClient | null;
  zoom?: number;
}

/**
 * Palette of the canonical speech bubble: a pale parchment card with a thin
 * warm rule, the NPC's name in bold across the top, and a solid amber bar
 * under the answer the cursor is on.
 */
const PAPER_TOP = "#fffdf0";
const PAPER = "#fbf6cf";
const PAPER_EDGE = "#d9c98a";
const RULE = "#e6dcae";
const INK = "#221f19";
const INK_MUTED = "#9a927a";
const HIGHLIGHT = "#f5a623";

const BUBBLE_W = 350;
const PORTRAIT_W = 128;
/** How far down the bust the card's top edge sits — roughly the chin. */
const CARD_DROP = 96;

/**
 * The NPC conversation — canonical `NpcDialog` + `QuestionViewer`
 * (`assets/sources/client-code/dofus/graphics/gapi/ui/NpcDialog.as`,
 * `.../controls/QuestionViewer.as`).
 *
 * It is a speech bubble, not one of the game's wooden panels: the NPC's bust
 * stands **outside** the card at the top left, the card is tucked under its
 * chin, and a small tail points back at it. That is why this does not use
 * `Panel`, and why the card grows to its content instead of sitting at a fixed
 * height — a one-line remark and a five-answer branch are both common, and a
 * fixed box makes the first look broken.
 *
 * The portrait is `CharacterPortrait` unchanged. Despite the name it is a
 * generic `artworks/big/<gfx>.dofasset` renderer with colour zones, which is
 * exactly what `setNpcCharacteristics` loads — the only difference being which
 * id goes in, and the handler has already resolved that (`customArtwork` when
 * the template overrides it, the sprite gfx otherwise).
 */
export function NpcDialog({ gameClient, zoom = 1 }: NpcDialogProps) {
  const state = useSyncExternalStore(
    npcDialogStore.subscribe,
    npcDialogStore.getSnapshot
  );
  const [hovered, setHovered] = useState<number | null>(null);

  if (!state.open) {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);

  const leave = () => gameClient?.leaveNpcDialog();

  const pick = (answer: NpcDialogAnswer) => {
    if (answer.disabled) {
      return;
    }
    if (answer.id === LEAVE_ID) {
      leave();
      return;
    }
    markNpcDialogAnswered();
    gameClient?.answerNpcDialog(state.questionId, answer.id);
  };

  const answers = visibleAnswers(state.answers, state.isFirstQuestion);
  const hasPortrait = state.portraitGfx > 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        pointerEvents: "auto",
        fontSize: p(12),
        color: INK,
        lineHeight: 1.4,
      }}
    >
      {hasPortrait && (
        <div
          style={{
            width: p(PORTRAIT_W),
            height: p(CARD_DROP + 70),
            flex: "0 0 auto",
            filter: `drop-shadow(0 ${p(2)}px ${p(3)}px rgba(0,0,0,.5))`,
          }}
        >
          <CharacterPortrait
            gfxId={state.portraitGfx}
            colors={state.colors}
            pixelSize={p(PORTRAIT_W)}
            label={state.npcName}
          />
        </div>
      )}

      <div
        style={{
          position: "relative",
          marginTop: hasPortrait ? p(CARD_DROP) : 0,
          // Overlaps the bust so the tail lands on it rather than in the gap.
          marginLeft: hasPortrait ? p(-18) : 0,
        }}
      >
        {hasPortrait && (
          // The bubble's tail. Two triangles so the border reads as a
          // continuous outline rather than stopping at the card's edge.
          <>
            <span
              style={{
                position: "absolute",
                left: p(-10),
                top: p(14),
                width: 0,
                height: 0,
                borderTop: `${p(7)}px solid transparent`,
                borderBottom: `${p(7)}px solid transparent`,
                borderRight: `${p(10)}px solid ${PAPER_EDGE}`,
              }}
            />
            <span
              style={{
                position: "absolute",
                left: p(-8),
                top: p(15),
                width: 0,
                height: 0,
                borderTop: `${p(6)}px solid transparent`,
                borderBottom: `${p(6)}px solid transparent`,
                borderRight: `${p(9)}px solid ${PAPER_TOP}`,
              }}
            />
          </>
        )}

        <div
          style={{
            width: p(BUBBLE_W),
            background: PAPER,
            border: `${Math.max(1, p(1))}px solid ${PAPER_EDGE}`,
            borderRadius: p(6),
            boxShadow: `0 ${p(2)}px ${p(6)}px rgba(0,0,0,.4)`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: p(8),
              background: PAPER_TOP,
              borderBottom: `${Math.max(1, p(1))}px solid ${RULE}`,
              padding: `${p(5)}px ${p(9)}px`,
              fontWeight: 700,
              fontSize: p(13),
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {state.npcName}
            </span>
            <button
              type="button"
              aria-label="Fermer"
              onClick={leave}
              style={{
                background: "none",
                border: "none",
                color: INK,
                cursor: "pointer",
                font: "inherit",
                lineHeight: 1,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          <p
            style={{
              margin: 0,
              padding: `${p(9)}px ${p(11)}px`,
              // The bundle carries hard line breaks and 1.29 honours them.
              whiteSpace: "pre-wrap",
            }}
          >
            {state.text}
          </p>

          {answers.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: `0 0 ${p(5)}px`,
              }}
            >
              {answers.map((answer) => {
                const lit = hovered === answer.id && !answer.disabled;
                return (
                  <li key={answer.id}>
                    <button
                      type="button"
                      disabled={answer.disabled}
                      onClick={() => pick(answer)}
                      onPointerEnter={() => setHovered(answer.id)}
                      onPointerLeave={() =>
                        setHovered((cur) => (cur === answer.id ? null : cur))
                      }
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: p(7),
                        width: "100%",
                        textAlign: "left",
                        background: lit ? HIGHLIGHT : "transparent",
                        border: "none",
                        padding: `${p(4)}px ${p(11)}px`,
                        font: "inherit",
                        color: answer.disabled ? INK_MUTED : INK,
                        cursor: answer.disabled ? "default" : "pointer",
                      }}
                    >
                      <span aria-hidden="true">•</span>
                      <span>{answer.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
