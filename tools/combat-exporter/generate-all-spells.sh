#!/bin/bash

# Generate TypeScript implementations for ALL spells that require it
#
# Usage: ./generate-all-spells.sh [--dry-run] [--skip-existing] [--parallel N]
#
# Options:
#   --dry-run         List spells that need implementation without generating
#   --skip-existing   Skip spells that already have an implementation file
#   --parallel N      Run N spells in parallel (default: 4)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output/spell-anims"
SPELLS_DIR="$SCRIPT_DIR/test-player/src/spells"

DRY_RUN=false
SKIP_EXISTING=false
PARALLEL=4

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-existing)
            SKIP_EXISTING=true
            shift
            ;;
        --parallel)
            PARALLEL="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Find all spells that require TypeScript
echo "Scanning for spells that require TypeScript implementation..."
echo ""

SPELLS_NEEDING_TS=()
SPELLS_ALREADY_DONE=()
SPELLS_TO_GENERATE=()

for manifest in "$OUTPUT_DIR"/*/manifest.json; do
    if [ ! -f "$manifest" ]; then
        continue
    fi

    SPELL_ID=$(jq -r '.id' "$manifest")
    REQUIRES_TS=$(jq -r '.requiresTypeScript // false' "$manifest")

    if [ "$REQUIRES_TS" = "true" ]; then
        SPELLS_NEEDING_TS+=("$SPELL_ID")

        # Check if implementation already exists
        if [ -f "$SPELLS_DIR/spell-$SPELL_ID.ts" ]; then
            SPELLS_ALREADY_DONE+=("$SPELL_ID")
            if [ "$SKIP_EXISTING" = "true" ]; then
                continue
            fi
        fi

        SPELLS_TO_GENERATE+=("$SPELL_ID")
    fi
done

echo "Summary:"
echo "  Total spells requiring TypeScript: ${#SPELLS_NEEDING_TS[@]}"
echo "  Already implemented: ${#SPELLS_ALREADY_DONE[@]}"
echo "  To generate: ${#SPELLS_TO_GENERATE[@]}"
echo "  Parallel jobs: $PARALLEL"
echo ""

if [ ${#SPELLS_TO_GENERATE[@]} -eq 0 ]; then
    echo "No spells to generate."
    exit 0
fi

echo "Spells to generate:"
for spell_id in "${SPELLS_TO_GENERATE[@]}"; do
    if [[ " ${SPELLS_ALREADY_DONE[@]} " =~ " $spell_id " ]]; then
        echo "  - $spell_id (will overwrite existing)"
    else
        echo "  - $spell_id"
    fi
done
echo ""

if [ "$DRY_RUN" = "true" ]; then
    echo "(Dry run - no files will be generated)"
    exit 0
fi

read -p "Generate implementations for ${#SPELLS_TO_GENERATE[@]} spells? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
fi

# Create a temporary directory for logs
LOG_DIR=$(mktemp -d)
echo "Logs will be written to: $LOG_DIR"
echo ""

# Function to generate a single spell (called in parallel)
generate_spell() {
    local spell_id="$1"
    local log_file="$LOG_DIR/spell-$spell_id.log"
    local output_file="$SPELLS_DIR/spell-$spell_id.ts"

    echo "[START] Spell $spell_id" >> "$log_file"

    PROMPT="Generate a TypeScript spell animation implementation for spell ID $spell_id.

## CRITICAL REQUIREMENT
The implementation must behave **EXACTLY** as the original ActionScript describes. No approximations, no 'improvements', no deviations. Copy formulas exactly, use the same frame timings, replicate the same randomization patterns.

## Instructions
1. Read the CLAUDE.md guide at: tools/combat-exporter/test-player/src/spells/CLAUDE.md
2. Read the base class at: tools/combat-exporter/test-player/src/spells/base-spell.ts
3. Read the manifest at: tools/combat-exporter/output/spell-anims/$spell_id/manifest.json
4. Read **ALL** ActionScript files in: tools/combat-exporter/output/spell-anims/$spell_id/scripts/
   - These are the SOURCE OF TRUTH for behavior
   - Every formula, every timing, every random range must be replicated exactly
5. Study the reference implementations:
   - tools/combat-exporter/test-player/src/spells/spell-909.ts (beam with particles)
   - tools/combat-exporter/test-player/src/spells/spell-1005.ts (radial with randomization)
6. Read the utilities to understand available helpers:
   - tools/combat-exporter/spell-utils/index.ts
   - tools/combat-exporter/spell-interface.ts
7. Create the implementation at: tools/combat-exporter/test-player/src/spells/spell-$spell_id.ts

## Key Requirements
- MUST extend BaseSpell (not implement ISpellAnimation)
- Use this.anims.add() to register all FrameAnimatedSprite instances
- Use this.anims.update(deltaTime) to update all animations at once
- Use this.signalHit() instead of direct callbacks.onHit() (auto-guarded)
- Use this.complete() instead of setting done manually (auto-guarded)
- Use init parameter for: scale, angleRad, casterY, targetX, targetY
- Frame numbers: AS is 1-indexed, TS is 0-indexed (subtract 1)
- Use frame numbers inline, not as constants
- Particle physics: Copy EXACT formulas from AS
- Randomization: Replicate exact ranges (AS random(90) = Math.floor(Math.random() * 90))
- Sounds: Play at exact frames specified in AS
- No inline ifs (use block form with braces)
- No reset() method needed
- Only override destroy() if you have extra resources (particles)

Write the complete TypeScript implementation file."

    cd "$PROJECT_ROOT"
    if echo "$PROMPT" | claude -p --allowedTools "Read,Write,Glob,Grep" >> "$log_file" 2>&1; then
        echo "✓ $spell_id"
        echo "[SUCCESS] Spell $spell_id" >> "$log_file"
        return 0
    else
        echo "✗ $spell_id (see $log_file)"
        echo "[FAILED] Spell $spell_id" >> "$log_file"
        return 1
    fi
}

export -f generate_spell
export PROJECT_ROOT SPELLS_DIR LOG_DIR

# Run in parallel using xargs
echo "Starting parallel generation ($PARALLEL jobs)..."
echo ""

printf '%s\n' "${SPELLS_TO_GENERATE[@]}" | xargs -P "$PARALLEL" -I {} bash -c 'generate_spell "$@"' _ {}

echo ""
echo "=========================================="
echo "Generation complete!"
echo "Logs available at: $LOG_DIR"
echo "=========================================="

# Count successes and failures
SUCCESS=$(grep -l "SUCCESS" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
FAILED=$(grep -l "FAILED" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')

echo "  Successful: $SUCCESS"
echo "  Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
    echo ""
    echo "Failed spells:"
    grep -l "FAILED" "$LOG_DIR"/*.log 2>/dev/null | while read f; do
        basename "$f" .log | sed 's/spell-/  - /'
    done
fi
