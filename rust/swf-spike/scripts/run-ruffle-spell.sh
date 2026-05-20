#!/usr/bin/env bash
# Render spell 802 via Ruffle's exporter, framed by the spell's actual bbox
# (computed by `print-bounds`). Single-line invocation, no zsh wrap surprises.
set -euo pipefail

EXPORTER="/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofus-vello-custom-format/vendor-ruffle/target/release/exporter"
SPELL="/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofuswebclient2/assets/sources/clips/spells/802.swf"
OUT="/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofus-vello-custom-format/packages/swf-spike/output/ruffle-spell-802"

"$EXPORTER" "$SPELL" "$OUT" \
  -f 5 \
  --stage-width 193 --stage-height 193 \
  --width 193 --height 193 \
  --offset-x 5000 --offset-y 5000 \
  --scale 4 --silent
