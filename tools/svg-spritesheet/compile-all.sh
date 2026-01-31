#!/bin/bash
# Compile all sprites from source SVGs to atlas format

INPUT_BASE="/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofuswebclient3-vello-shared-test/assets/rasters/sprites/svg"
OUTPUT_BASE="/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofuswebclient3-vello-shared-test/assets/output/sprites"

# Create output directory
mkdir -p "$OUTPUT_BASE"

# Count total sprites
TOTAL=$(ls -d "$INPUT_BASE"/*/ 2>/dev/null | wc -l | tr -d ' ')
CURRENT=0
FAILED=0
SUCCESS=0

echo "=== Compiling $TOTAL sprites ==="
echo "Input: $INPUT_BASE"
echo "Output: $OUTPUT_BASE"
echo ""

# Process each sprite directory
for SPRITE_DIR in "$INPUT_BASE"/*/; do
    SPRITE_ID=$(basename "$SPRITE_DIR")
    CURRENT=$((CURRENT + 1))

    # Skip if not a directory or empty
    if [ ! -d "$SPRITE_DIR" ]; then
        continue
    fi

    # Count SVG files (using find to avoid "argument list too long" with large directories)
    SVG_COUNT=$(find "$SPRITE_DIR" -maxdepth 1 -name "*.svg" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$SVG_COUNT" -eq 0 ]; then
        echo "[$CURRENT/$TOTAL] Skipping $SPRITE_ID (no SVG files)"
        continue
    fi

    OUTPUT_DIR="$OUTPUT_BASE/$SPRITE_ID"

    # Run batch compile
    echo "[$CURRENT/$TOTAL] Compiling sprite $SPRITE_ID ($SVG_COUNT files)..."

    if bun /Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofuswebclient3-vello-shared-test/tools/svg-spritesheet/src/batch-compile.ts \
        "$SPRITE_DIR" "$OUTPUT_DIR" "$SPRITE_ID" --parallel 8 > /dev/null 2>&1; then
        SUCCESS=$((SUCCESS + 1))
    else
        echo "  ERROR: Failed to compile sprite $SPRITE_ID"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
echo "=== Compilation Complete ==="
echo "Total: $TOTAL"
echo "Success: $SUCCESS"
echo "Failed: $FAILED"

# Calculate total size
if [ -d "$OUTPUT_BASE" ]; then
    OUTPUT_SIZE=$(du -sh "$OUTPUT_BASE" | cut -f1)
    echo "Output size: $OUTPUT_SIZE"
fi
