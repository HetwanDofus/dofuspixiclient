import { Container, Graphics, Text, TextStyle } from "pixi.js";

/**
 * Action bar configuration.
 */
export interface ActionBarConfig {
  x?: number;
  y?: number;
  width?: number;
}

/**
 * Action bar event callbacks.
 */
export interface ActionBarCallbacks {
  onPassTurn?: () => void;
  onForfeit?: () => void;
}

/**
 * Combat action bar UI.
 * Displays AP/MP and action buttons.
 */
export class ActionBar {
  private container: Container;
  private background: Graphics;
  private apText: Text;
  private mpText: Text;
  private apBar: Graphics;
  private mpBar: Graphics;
  private passTurnButton: Container;
  private forfeitButton: Container;
  private callbacks: ActionBarCallbacks = {};

  private currentAP = 0;
  private maxAP = 0;
  private currentMP = 0;
  private maxMP = 0;
  private isMyTurn = false;
  private width: number;

  constructor(config: ActionBarConfig = {}) {
    this.width = config.width ?? 300;

    this.container = new Container();
    this.container.label = "action-bar";
    this.container.x = config.x ?? 0;
    this.container.y = config.y ?? 0;

    // Background
    this.background = new Graphics();
    this.container.addChild(this.background);
    this.drawBackground();

    // AP display
    const apContainer = new Container();
    apContainer.x = 10;
    apContainer.y = 10;
    this.container.addChild(apContainer);

    const apLabel = this.createLabel("AP", 0x00aaff);
    apContainer.addChild(apLabel);

    this.apBar = new Graphics();
    this.apBar.y = 16;
    apContainer.addChild(this.apBar);

    this.apText = this.createValueText("0/0", 0x00aaff);
    this.apText.x = 60;
    this.apText.y = 2;
    apContainer.addChild(this.apText);

    // MP display
    const mpContainer = new Container();
    mpContainer.x = 10;
    mpContainer.y = 40;
    this.container.addChild(mpContainer);

    const mpLabel = this.createLabel("MP", 0x00ff00);
    mpContainer.addChild(mpLabel);

    this.mpBar = new Graphics();
    this.mpBar.y = 16;
    mpContainer.addChild(this.mpBar);

    this.mpText = this.createValueText("0/0", 0x00ff00);
    this.mpText.x = 60;
    this.mpText.y = 2;
    mpContainer.addChild(this.mpText);

    // Pass turn button
    this.passTurnButton = this.createButton("Pass", 0x4444aa, () => {
      if (this.isMyTurn) {
        this.callbacks.onPassTurn?.();
      }
    });
    this.passTurnButton.x = this.width - 140;
    this.passTurnButton.y = 10;
    this.container.addChild(this.passTurnButton);

    // Forfeit button
    this.forfeitButton = this.createButton("Forfeit", 0xaa4444, () => {
      this.callbacks.onForfeit?.();
    });
    this.forfeitButton.x = this.width - 70;
    this.forfeitButton.y = 10;
    this.container.addChild(this.forfeitButton);

    this.updateButtonStates();
  }

  /**
   * Set event callbacks.
   */
  setCallbacks(callbacks: ActionBarCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Set AP values.
   */
  setAP(current: number, max: number): void {
    this.currentAP = current;
    this.maxAP = max;
    this.updateAPDisplay();
  }

  /**
   * Set MP values.
   */
  setMP(current: number, max: number): void {
    this.currentMP = current;
    this.maxMP = max;
    this.updateMPDisplay();
  }

  /**
   * Set stats at once.
   */
  setStats(ap: number, maxAp: number, mp: number, maxMp: number): void {
    this.currentAP = ap;
    this.maxAP = maxAp;
    this.currentMP = mp;
    this.maxMP = maxMp;
    this.updateAPDisplay();
    this.updateMPDisplay();
  }

  /**
   * Set if it's the player's turn.
   */
  setIsMyTurn(isMyTurn: boolean): void {
    this.isMyTurn = isMyTurn;
    this.updateButtonStates();
  }

  /**
   * Get current AP.
   */
  getAP(): number {
    return this.currentAP;
  }

  /**
   * Get current MP.
   */
  getMP(): number {
    return this.currentMP;
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
   * Destroy the action bar.
   */
  destroy(): void {
    this.container.destroy({ children: true });
  }

  /**
   * Draw background.
   */
  private drawBackground(): void {
    this.background.clear();
    this.background.roundRect(0, 0, this.width, 70, 8);
    this.background.fill({ color: 0x000000, alpha: 0.7 });
    this.background.stroke({ color: 0x333333, width: 1 });
  }

  /**
   * Create a label text.
   */
  private createLabel(text: string, color: number): Text {
    const style = new TextStyle({
      fontFamily: "Arial",
      fontSize: 12,
      fontWeight: "bold",
      fill: color,
    });

    return new Text({ text, style });
  }

  /**
   * Create a value text.
   */
  private createValueText(text: string, color: number): Text {
    const style = new TextStyle({
      fontFamily: "Arial",
      fontSize: 14,
      fontWeight: "bold",
      fill: color,
      stroke: { color: 0x000000, width: 2 },
    });

    return new Text({ text, style });
  }

  /**
   * Create a button.
   */
  private createButton(
    label: string,
    color: number,
    onClick: () => void
  ): Container {
    const button = new Container();
    button.eventMode = "static";
    button.cursor = "pointer";

    const bg = new Graphics();
    bg.label = "bg";
    bg.roundRect(0, 0, 60, 30, 4);
    bg.fill({ color, alpha: 0.8 });
    bg.stroke({ color: 0x000000, width: 1 });
    button.addChild(bg);

    const textStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 11,
      fontWeight: "bold",
      fill: 0xffffff,
    });

    const text = new Text({ text: label, style: textStyle });
    text.anchor.set(0.5, 0.5);
    text.x = 30;
    text.y = 15;
    button.addChild(text);

    button.on("pointerdown", onClick);

    button.on("pointerover", () => {
      bg.clear();
      bg.roundRect(0, 0, 60, 30, 4);
      bg.fill({ color, alpha: 1 });
      bg.stroke({ color: 0xffffff, width: 1 });
    });

    button.on("pointerout", () => {
      bg.clear();
      bg.roundRect(0, 0, 60, 30, 4);
      bg.fill({ color, alpha: 0.8 });
      bg.stroke({ color: 0x000000, width: 1 });
    });

    return button;
  }

  /**
   * Update AP display.
   */
  private updateAPDisplay(): void {
    this.apText.text = `${this.currentAP}/${this.maxAP}`;

    const barWidth = 100;
    const barHeight = 8;
    const ratio = this.maxAP > 0 ? this.currentAP / this.maxAP : 0;

    this.apBar.clear();

    // Background
    this.apBar.roundRect(0, 0, barWidth, barHeight, 2);
    this.apBar.fill({ color: 0x222222 });

    // Fill
    if (ratio > 0) {
      this.apBar.roundRect(0, 0, barWidth * ratio, barHeight, 2);
      this.apBar.fill({ color: 0x00aaff });
    }

    // Border
    this.apBar.roundRect(0, 0, barWidth, barHeight, 2);
    this.apBar.stroke({ color: 0x444444, width: 1 });
  }

  /**
   * Update MP display.
   */
  private updateMPDisplay(): void {
    this.mpText.text = `${this.currentMP}/${this.maxMP}`;

    const barWidth = 100;
    const barHeight = 8;
    const ratio = this.maxMP > 0 ? this.currentMP / this.maxMP : 0;

    this.mpBar.clear();

    // Background
    this.mpBar.roundRect(0, 0, barWidth, barHeight, 2);
    this.mpBar.fill({ color: 0x222222 });

    // Fill
    if (ratio > 0) {
      this.mpBar.roundRect(0, 0, barWidth * ratio, barHeight, 2);
      this.mpBar.fill({ color: 0x00ff00 });
    }

    // Border
    this.mpBar.roundRect(0, 0, barWidth, barHeight, 2);
    this.mpBar.stroke({ color: 0x444444, width: 1 });
  }

  /**
   * Update button states based on turn.
   */
  private updateButtonStates(): void {
    const passBg = this.passTurnButton.getChildByLabel("bg") as Graphics;

    if (this.isMyTurn) {
      passBg.clear();
      passBg.roundRect(0, 0, 60, 30, 4);
      passBg.fill({ color: 0x4444aa, alpha: 0.8 });
      passBg.stroke({ color: 0x000000, width: 1 });
      this.passTurnButton.alpha = 1;
    } else {
      passBg.clear();
      passBg.roundRect(0, 0, 60, 30, 4);
      passBg.fill({ color: 0x333333, alpha: 0.8 });
      passBg.stroke({ color: 0x000000, width: 1 });
      this.passTurnButton.alpha = 0.5;
    }
  }
}
