#!/bin/bash

# Generate TypeScript spell implementation using Claude Code
#
# Usage: ./generate-spell.sh <spell_id>
# Example: ./generate-spell.sh 909

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -z "$1" ]; then
    echo "Usage: $0 <spell_id>"
    echo "Example: $0 909"
    exit 1
fi

SPELL_ID="$1"
SPELL_DIR="$SCRIPT_DIR/output/spell-anims/$SPELL_ID"
MANIFEST_FILE="$SPELL_DIR/manifest.json"
SCRIPTS_DIR="$SPELL_DIR/scripts"
OUTPUT_FILE="$SCRIPT_DIR/test-player/src/spells/spell-$SPELL_ID.ts"

# Check if manifest exists
if [ ! -f "$MANIFEST_FILE" ]; then
    echo "Error: Manifest not found at $MANIFEST_FILE"
    echo "Make sure you've run the extraction for spell $SPELL_ID first."
    exit 1
fi

# Check if spell requires TypeScript
REQUIRES_TS=$(jq -r '.requiresTypeScript // false' "$MANIFEST_FILE")
if [ "$REQUIRES_TS" != "true" ]; then
    echo "Warning: Spell $SPELL_ID does not require TypeScript implementation."
    echo "It can be played using pre-rendered frames only."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Check if output already exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "Warning: $OUTPUT_FILE already exists."
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Build the prompt
PROMPT="Generate a TypeScript spell animation implementation for spell ID $SPELL_ID.

## CRITICAL REQUIREMENT
The implementation must behave **EXACTLY** as the original ActionScript describes. No approximations, no 'improvements', no deviations. Copy formulas exactly, use the same frame timings, replicate the same randomization patterns.

## Instructions
1. Read the CLAUDE.md guide at: tools/combat-exporter/test-player/src/spells/CLAUDE.md
2. Read the manifest at: tools/combat-exporter/output/spell-anims/$SPELL_ID/manifest.json
3. Read **ALL** ActionScript files in: tools/combat-exporter/output/spell-anims/$SPELL_ID/scripts/
   - These are the SOURCE OF TRUTH for behavior
   - Every formula, every timing, every random range must be replicated exactly
4. Study the reference implementations:
   - tools/combat-exporter/test-player/src/spells/spell-909.ts (beam with particles)
   - tools/combat-exporter/test-player/src/spells/spell-1005.ts (radial with randomization)
5. Read the utilities to understand available helpers:
   - tools/combat-exporter/spell-utils/index.ts
   - tools/combat-exporter/spell-interface.ts
6. Create the implementation at: tools/combat-exporter/test-player/src/spells/spell-$SPELL_ID.ts

## Key Requirements
- Frame numbers: AS is 1-indexed, TS is 0-indexed (subtract 1)
- Scale: Apply 1/SPELL_CONSTANTS.EXTRACTION_SCALE (1/6) to all sprites
- Positioning: Use SPELL_CONSTANTS.Y_OFFSET for vertical offset
- Particle physics: Copy EXACT formulas from AS (e.g., accX = 0.8 + 0.12 * Math.random())
- Randomization: Replicate exact ranges (AS random(90) = Math.floor(Math.random() * 90))
- Sounds: Play at exact frames specified in AS
- Hit signal: Call at exact frame AS calls this.end() or signals hit
- Completion: Wait for ALL animations AND particles to finish

Write the complete TypeScript implementation file."

echo "Generating spell $SPELL_ID..."

# Launch Claude Code non-interactively
cd "$PROJECT_ROOT"
echo "$PROMPT" | claude -p --allowedTools "Read,Write,Glob,Grep" 2>/dev/null

echo "✓ Done"
