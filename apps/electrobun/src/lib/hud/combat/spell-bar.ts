import {
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type Texture,
} from "pixi.js";

/**
 * Spell data for display.
 */
export interface SpellSlotData {
  id: number;
  name: string;
  iconTexture?: Texture;
  apCost: number;
  level: number;
  cooldown: number;
  maxCooldown: number;
  usesThisTurn: number;
  maxUsesPerTurn: number;
  canCast: boolean;
}

/**
 * Spell bar configuration.
 */
export interface SpellBarConfig {
  x?: number;
  y?: number;
  slotSize?: number;
  slotsPerRow?: number;
  spacing?: number;
}

/**
 * Spell bar event callbacks.
 */
export interface SpellBarCallbacks {
  onSpellClick?: (spellId: number, position: number) => void;
  onSpellHover?: (spellId: number | null, position: number | null) => void;
}

/**
 * Combat spell bar UI.
 * Displays spell shortcuts with cooldowns.
 */
export class SpellBar {
  private container: Container;
  private background: Graphics;
  private slots: Map<number, Container> = new Map();
  private selectedPosition: number | null = null;
  private callbacks: SpellBarCallbacks = {};

  private slotSize: number;
  private slotsPerRow: number;
  private spacing: number;

  constructor(config: SpellBarConfig = {}) {
    this.slotSize = config.slotSize ?? 36;
    this.slotsPerRow = config.slotsPerRow ?? 10;
    this.spacing = config.spacing ?? 2;

    this.container = new Container();
    this.container.label = "spell-bar";
    this.container.x = config.x ?? 0;
    this.container.y = config.y ?? 0;

    // Background
    this.background = new Graphics();
    this.container.addChild(this.background);

    this.drawBackground();
    this.createSlots();
  }

  /**
   * Set event callbacks.
   */
  setCallbacks(callbacks: SpellBarCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Set spell in a slot.
   */
  setSpell(position: number, spell: SpellSlotData): void {
    const slot = this.slots.get(position);

    if (!slot) {
      return;
    }

    // Store spell data
    (slot as SpellSlotContainer).spellData = spell;

    this.updateSlot(slot, spell);
  }

  /**
   * Clear a spell slot.
   */
  clearSpell(position: number): void {
    const slot = this.slots.get(position);

    if (!slot) {
      return;
    }

    (slot as SpellSlotContainer).spellData = undefined;
    this.clearSlot(slot);
  }

  /**
   * Update spell cooldown.
   */
  updateCooldown(position: number, cooldown: number): void {
    const slot = this.slots.get(position);

    if (!slot) {
      return;
    }

    const spellData = (slot as SpellSlotContainer).spellData;

    if (spellData) {
      spellData.cooldown = cooldown;
      this.updateSlot(slot, spellData);
    }
  }

  /**
   * Select a spell slot.
   */
  selectSpell(position: number | null): void {
    // Deselect previous
    if (this.selectedPosition !== null) {
      const prevSlot = this.slots.get(this.selectedPosition);

      if (prevSlot) {
        this.updateSlotSelection(prevSlot, false);
      }
    }

    this.selectedPosition = position;

    // Select new
    if (position !== null) {
      const slot = this.slots.get(position);

      if (slot) {
        this.updateSlotSelection(slot, true);
      }
    }
  }

  /**
   * Get selected spell position.
   */
  getSelectedPosition(): number | null {
    return this.selectedPosition;
  }

  /**
   * Get selected spell ID.
   */
  getSelectedSpellId(): number | null {
    if (this.selectedPosition === null) {
      return null;
    }

    const slot = this.slots.get(this.selectedPosition);
    const spellData = (slot as SpellSlotContainer)?.spellData;

    return spellData?.id ?? null;
  }

  /**
   * Update all spells cast state.
   */
  updateCanCast(currentAP: number): void {
    for (const [, slot] of this.slots) {
      const spellData = (slot as SpellSlotContainer).spellData;

      if (spellData) {
        const canAfford = currentAP >= spellData.apCost;
        const notOnCooldown = spellData.cooldown <= 0;
        const hasUsesLeft =
          spellData.maxUsesPerTurn === 0 ||
          spellData.usesThisTurn < spellData.maxUsesPerTurn;

        spellData.canCast = canAfford && notOnCooldown && hasUsesLeft;
        this.updateSlot(slot, spellData);
      }
    }
  }

  /**
   * Get the container.
   */
  getContainer(): Container {
    return this.container;
  }

  /**
   * Set visibility.
   */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Clear all spells.
   */
  clear(): void {
    for (const slot of this.slots.values()) {
      this.clearSlot(slot);
      (slot as SpellSlotContainer).spellData = undefined;
    }

    this.selectedPosition = null;
  }

  /**
   * Destroy the spell bar.
   */
  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }

  /**
   * Draw background.
   */
  private drawBackground(): void {
    const rows = Math.ceil(31 / this.slotsPerRow);
    const width =
      this.slotsPerRow * (this.slotSize + this.spacing) + this.spacing;
    const height = rows * (this.slotSize + this.spacing) + this.spacing;

    this.background.clear();
    this.background.roundRect(0, 0, width, height, 4);
    this.background.fill({ color: 0x000000, alpha: 0.7 });
    this.background.stroke({ color: 0x333333, width: 1 });
  }

  /**
   * Create spell slots.
   */
  private createSlots(): void {
    for (let i = 0; i < 31; i++) {
      const slot = this.createSlot(i);
      this.slots.set(i, slot);
      this.container.addChild(slot);

      const row = Math.floor(i / this.slotsPerRow);
      const col = i % this.slotsPerRow;

      slot.x = this.spacing + col * (this.slotSize + this.spacing);
      slot.y = this.spacing + row * (this.slotSize + this.spacing);
    }
  }

  /**
   * Create a single spell slot.
   */
  private createSlot(position: number): Container {
    const slot = new Container() as SpellSlotContainer;
    slot.label = `spell-slot-${position}`;
    slot.eventMode = "static";
    slot.cursor = "pointer";

    // Background
    const bg = new Graphics();
    bg.label = "bg";
    bg.roundRect(0, 0, this.slotSize, this.slotSize, 4);
    bg.fill({ color: 0x222222 });
    bg.stroke({ color: 0x444444, width: 1 });
    slot.addChild(bg);

    // Icon placeholder
    const iconContainer = new Container();
    iconContainer.label = "icon";
    slot.addChild(iconContainer);

    // Cooldown overlay
    const cooldownOverlay = new Graphics();
    cooldownOverlay.label = "cooldown";
    cooldownOverlay.visible = false;
    slot.addChild(cooldownOverlay);

    // Cooldown text
    const cooldownStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 14,
      fontWeight: "bold",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 2 },
    });

    const cooldownText = new Text({ text: "", style: cooldownStyle });
    cooldownText.label = "cooldown-text";
    cooldownText.anchor.set(0.5, 0.5);
    cooldownText.x = this.slotSize / 2;
    cooldownText.y = this.slotSize / 2;
    cooldownText.visible = false;
    slot.addChild(cooldownText);

    // AP cost
    const apStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 9,
      fontWeight: "bold",
      fill: 0x00aaff,
      stroke: { color: 0x000000, width: 1 },
    });

    const apText = new Text({ text: "", style: apStyle });
    apText.label = "ap-cost";
    apText.anchor.set(1, 1);
    apText.x = this.slotSize - 2;
    apText.y = this.slotSize - 2;
    apText.visible = false;
    slot.addChild(apText);

    // Selection highlight
    const highlight = new Graphics();
    highlight.label = "highlight";
    highlight.roundRect(-2, -2, this.slotSize + 4, this.slotSize + 4, 4);
    highlight.stroke({ color: 0xffff00, width: 2 });
    highlight.visible = false;
    slot.addChild(highlight);

    // Events
    slot.on("pointerdown", () => {
      if (slot.spellData?.canCast) {
        this.callbacks.onSpellClick?.(slot.spellData.id, position);
      }
    });

    slot.on("pointerover", () => {
      this.callbacks.onSpellHover?.(slot.spellData?.id ?? null, position);
    });

    slot.on("pointerout", () => {
      this.callbacks.onSpellHover?.(null, null);
    });

    return slot;
  }

  /**
   * Update a slot display.
   */
  private updateSlot(slot: Container, spell: SpellSlotData): void {
    const bg = slot.getChildByLabel("bg") as Graphics;
    const iconContainer = slot.getChildByLabel("icon") as Container;
    const cooldownOverlay = slot.getChildByLabel("cooldown") as Graphics;
    const cooldownText = slot.getChildByLabel("cooldown-text") as Text;
    const apText = slot.getChildByLabel("ap-cost") as Text;

    // Update background based on can cast
    bg.clear();
    bg.roundRect(0, 0, this.slotSize, this.slotSize, 4);

    if (spell.canCast) {
      bg.fill({ color: 0x333333 });
      bg.stroke({ color: 0x666666, width: 1 });
    } else {
      bg.fill({ color: 0x222222 });
      bg.stroke({ color: 0x333333, width: 1 });
    }

    // Update icon
    iconContainer.removeChildren();

    if (spell.iconTexture) {
      const icon = new Sprite(spell.iconTexture);
      icon.width = this.slotSize - 4;
      icon.height = this.slotSize - 4;
      icon.x = 2;
      icon.y = 2;
      iconContainer.addChild(icon);
    } else {
      // Placeholder
      const placeholder = new Graphics();
      placeholder.rect(4, 4, this.slotSize - 8, this.slotSize - 8);
      placeholder.fill({ color: 0x555555, alpha: 0.5 });
      iconContainer.addChild(placeholder);
    }

    // Update cooldown
    if (spell.cooldown > 0) {
      cooldownOverlay.visible = true;
      cooldownOverlay.clear();
      cooldownOverlay.roundRect(0, 0, this.slotSize, this.slotSize, 4);
      cooldownOverlay.fill({ color: 0x000000, alpha: 0.7 });

      cooldownText.visible = true;
      cooldownText.text = String(spell.cooldown);
    } else {
      cooldownOverlay.visible = false;
      cooldownText.visible = false;
    }

    // Update AP cost
    apText.visible = true;
    apText.text = String(spell.apCost);

    // Dim if can't cast
    if (!spell.canCast) {
      iconContainer.alpha = 0.5;
    } else {
      iconContainer.alpha = 1;
    }
  }

  /**
   * Clear a slot.
   */
  private clearSlot(slot: Container): void {
    const bg = slot.getChildByLabel("bg") as Graphics;
    const iconContainer = slot.getChildByLabel("icon") as Container;
    const cooldownOverlay = slot.getChildByLabel("cooldown") as Graphics;
    const cooldownText = slot.getChildByLabel("cooldown-text") as Text;
    const apText = slot.getChildByLabel("ap-cost") as Text;
    const highlight = slot.getChildByLabel("highlight") as Graphics;

    bg.clear();
    bg.roundRect(0, 0, this.slotSize, this.slotSize, 4);
    bg.fill({ color: 0x222222 });
    bg.stroke({ color: 0x444444, width: 1 });

    iconContainer.removeChildren();
    cooldownOverlay.visible = false;
    cooldownText.visible = false;
    apText.visible = false;
    highlight.visible = false;
  }

  /**
   * Update slot selection highlight.
   */
  private updateSlotSelection(slot: Container, selected: boolean): void {
    const highlight = slot.getChildByLabel("highlight") as Graphics;
    highlight.visible = selected;
  }
}

/**
 * Extended container with spell data.
 */
interface SpellSlotContainer extends Container {
  spellData?: SpellSlotData;
}
