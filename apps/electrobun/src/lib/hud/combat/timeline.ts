import { Container, Graphics, Text, TextStyle } from "pixi.js";

/**
 * Fighter data for timeline display.
 */
export interface TimelineFighter {
  id: number;
  name: string;
  team: number;
  hp: number;
  maxHp: number;
  isCurrentTurn: boolean;
}

/**
 * Timeline configuration.
 */
export interface TimelineConfig {
  x?: number;
  y?: number;
  fighterSize?: number;
  spacing?: number;
}

/**
 * Combat timeline UI.
 * Displays the turn order of fighters.
 */
export class Timeline {
  private container: Container;
  private background: Graphics;
  private fighterSlots: Map<number, Container> = new Map();
  private turnIndicator: Graphics;
  private timerText: Text;
  private turnOrder: number[] = [];

  private fighterSize: number;
  private spacing: number;
  private currentTurnId: number | null = null;
  private turnTimeRemaining = 0;
  private turnDuration = 0;

  constructor(config: TimelineConfig = {}) {
    this.fighterSize = config.fighterSize ?? 40;
    this.spacing = config.spacing ?? 5;

    this.container = new Container();
    this.container.label = "timeline";
    this.container.x = config.x ?? 10;
    this.container.y = config.y ?? 10;

    // Background
    this.background = new Graphics();
    this.container.addChild(this.background);

    // Turn indicator (arrow above current fighter)
    this.turnIndicator = new Graphics();
    this.turnIndicator.visible = false;
    this.container.addChild(this.turnIndicator);
    this.drawTurnIndicator();

    // Timer text
    const timerStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 12,
      fontWeight: "bold",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 2 },
    });

    this.timerText = new Text({ text: "", style: timerStyle });
    this.timerText.anchor.set(0.5, 0);
    this.container.addChild(this.timerText);
  }

  /**
   * Set the turn order.
   */
  setTurnOrder(fighterIds: number[]): void {
    this.turnOrder = [...fighterIds];
    this.updateLayout();
  }

  /**
   * Add or update a fighter in the timeline.
   */
  setFighter(fighter: TimelineFighter): void {
    let slot = this.fighterSlots.get(fighter.id);

    if (!slot) {
      slot = this.createFighterSlot(fighter);
      this.fighterSlots.set(fighter.id, slot);
      this.container.addChild(slot);
    }

    this.updateFighterSlot(slot, fighter);

    if (fighter.isCurrentTurn) {
      this.setCurrentTurn(fighter.id);
    }
  }

  /**
   * Remove a fighter from the timeline.
   */
  removeFighter(id: number): void {
    const slot = this.fighterSlots.get(id);

    if (slot) {
      this.container.removeChild(slot);
      slot.destroy({ children: true });
      this.fighterSlots.delete(id);
    }

    this.turnOrder = this.turnOrder.filter((fid) => fid !== id);
    this.updateLayout();
  }

  /**
   * Set the current turn.
   */
  setCurrentTurn(fighterId: number): void {
    this.currentTurnId = fighterId;

    // Update all slots
    for (const [id, slot] of this.fighterSlots) {
      const isCurrentTurn = id === fighterId;
      this.updateSlotHighlight(slot, isCurrentTurn);
    }

    this.updateTurnIndicatorPosition();
  }

  /**
   * Set turn timer.
   */
  setTurnTimer(remaining: number, duration: number): void {
    this.turnTimeRemaining = remaining;
    this.turnDuration = duration;
    this.updateTimerDisplay();
  }

  /**
   * Update timer (call each frame).
   */
  updateTimer(deltaMs: number): void {
    if (this.turnTimeRemaining > 0) {
      this.turnTimeRemaining = Math.max(0, this.turnTimeRemaining - deltaMs);
      this.updateTimerDisplay();
    }
  }

  /**
   * Get the container for adding to scene.
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
   * Clear all fighters.
   */
  clear(): void {
    for (const slot of this.fighterSlots.values()) {
      slot.destroy({ children: true });
    }

    this.fighterSlots.clear();
    this.turnOrder = [];
    this.currentTurnId = null;
    this.turnIndicator.visible = false;
    this.timerText.text = "";
  }

  /**
   * Destroy the timeline.
   */
  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }

  /**
   * Create a fighter slot.
   */
  private createFighterSlot(fighter: TimelineFighter): Container {
    const slot = new Container();
    slot.label = `timeline-fighter-${fighter.id}`;

    // Background
    const bg = new Graphics();
    bg.label = "bg";
    slot.addChild(bg);

    // HP bar
    const hpBar = new Graphics();
    hpBar.label = "hp-bar";
    hpBar.y = this.fighterSize + 2;
    slot.addChild(hpBar);

    // Name text
    const nameStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 8,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 1 },
    });

    const nameText = new Text({ text: fighter.name, style: nameStyle });
    nameText.label = "name";
    nameText.anchor.set(0.5, 0);
    nameText.x = this.fighterSize / 2;
    nameText.y = this.fighterSize + 8;
    slot.addChild(nameText);

    return slot;
  }

  /**
   * Update a fighter slot.
   */
  private updateFighterSlot(slot: Container, fighter: TimelineFighter): void {
    const bg = slot.getChildByLabel("bg") as Graphics;
    const hpBar = slot.getChildByLabel("hp-bar") as Graphics;
    const nameText = slot.getChildByLabel("name") as Text;

    // Draw background with team color
    bg.clear();
    const teamColor = fighter.team === 0 ? 0xff4444 : 0x4444ff;
    bg.roundRect(0, 0, this.fighterSize, this.fighterSize, 4);
    bg.fill({ color: teamColor, alpha: 0.8 });
    bg.stroke({ color: 0x000000, width: 2 });

    // Draw HP bar
    hpBar.clear();
    const hpRatio = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
    const barWidth = this.fighterSize;
    const barHeight = 4;

    // Background
    hpBar.rect(0, 0, barWidth, barHeight);
    hpBar.fill({ color: 0x333333 });

    // HP fill
    const hpColor =
      hpRatio > 0.5 ? 0x00ff00 : hpRatio > 0.25 ? 0xffff00 : 0xff0000;
    hpBar.rect(0, 0, barWidth * hpRatio, barHeight);
    hpBar.fill({ color: hpColor });

    // Border
    hpBar.rect(0, 0, barWidth, barHeight);
    hpBar.stroke({ color: 0x000000, width: 1 });

    // Update name
    nameText.text = fighter.name;
  }

  /**
   * Update slot highlight for current turn.
   */
  private updateSlotHighlight(slot: Container, isCurrentTurn: boolean): void {
    const bg = slot.getChildByLabel("bg") as Graphics;

    if (isCurrentTurn) {
      bg.stroke({ color: 0xffff00, width: 3 });
    }
  }

  /**
   * Update layout based on turn order.
   */
  private updateLayout(): void {
    let x = 0;

    for (const fighterId of this.turnOrder) {
      const slot = this.fighterSlots.get(fighterId);

      if (slot) {
        slot.x = x;
        slot.y = 20; // Leave room for turn indicator
        x += this.fighterSize + this.spacing;
      }
    }

    // Update background
    this.background.clear();

    if (this.turnOrder.length > 0) {
      const totalWidth = x - this.spacing;
      const totalHeight = this.fighterSize + 20 + 15; // Indicator + slot + HP + name

      this.background.roundRect(-5, 0, totalWidth + 10, totalHeight, 8);
      this.background.fill({ color: 0x000000, alpha: 0.6 });
    }

    // Update timer position
    this.timerText.x = (x - this.spacing) / 2;
    this.timerText.y = this.fighterSize + 35;

    this.updateTurnIndicatorPosition();
  }

  /**
   * Update turn indicator position.
   */
  private updateTurnIndicatorPosition(): void {
    if (this.currentTurnId === null) {
      this.turnIndicator.visible = false;
      return;
    }

    const index = this.turnOrder.indexOf(this.currentTurnId);

    if (index === -1) {
      this.turnIndicator.visible = false;
      return;
    }

    const x = index * (this.fighterSize + this.spacing) + this.fighterSize / 2;
    this.turnIndicator.x = x;
    this.turnIndicator.y = 15;
    this.turnIndicator.visible = true;
  }

  /**
   * Draw turn indicator arrow.
   */
  private drawTurnIndicator(): void {
    this.turnIndicator.clear();

    const size = 10;
    this.turnIndicator.poly([0, size, -size / 2, 0, size / 2, 0]);
    this.turnIndicator.fill({ color: 0xffff00 });
    this.turnIndicator.stroke({ color: 0x000000, width: 1 });
  }

  /**
   * Update timer display.
   */
  private updateTimerDisplay(): void {
    if (this.turnDuration <= 0) {
      this.timerText.text = "";
      return;
    }

    const seconds = Math.ceil(this.turnTimeRemaining / 1000);
    this.timerText.text = `${seconds}s`;

    // Color based on time remaining
    const ratio = this.turnTimeRemaining / this.turnDuration;

    if (ratio > 0.5) {
      this.timerText.style.fill = 0xffffff;
    } else if (ratio > 0.25) {
      this.timerText.style.fill = 0xffff00;
    } else {
      this.timerText.style.fill = 0xff0000;
    }
  }
}
