import type { Application } from 'pixi.js';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Input } from '@pixi/ui';
import { WorldMapRenderer } from '../../world-map-renderer';
import { createBannerCircle, CIRCLE_INNER_CONTENT_RADIUS, type BannerCircle, CIRCLE_FILLABLE_OUTER_RADIUS } from './banner-circle';

const BANNER_ASSETS_PATH = '/assets/hud/banner';

interface AssetEntry {
  file: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

interface BannerManifest {
  version: string;
  scale: number;
  icons: Record<string, AssetEntry>;
  container: Record<string, AssetEntry>;
  compass: Record<string, AssetEntry>;
  clock: Record<string, AssetEntry>;
  chat: Record<string, AssetEntry>;
}

interface IconButton {
  container: Container;
  button: Sprite;
  icon: Sprite;
  isPressed: boolean;
}

interface ShortcutCell {
  container: Container;
  background: Sprite;
  border: Sprite;
  highlight: Sprite;
}

interface ChatButton {
  container: Container;
  icon: Sprite;
  hoverIcon?: Sprite;
  isPressed: boolean;
}

interface ChatFilter {
  container: Container;
  background: Graphics;
  checkmark: Graphics;
  isActive: boolean;
}

/**
 * Main Banner Component
 * Uses pre-rendered textures for all banner elements
 */
export class Banner {
  private app: Application;
  private container: Container;
  private background: Graphics;
  private whiteZoneBottomLeft: Graphics;
  private whiteZoneTopRight: Container;

  private manifest!: BannerManifest;
  private buttonUpTexture!: Texture;
  private buttonDownTexture!: Texture;
  private cellBackgroundTexture!: Texture;
  private cellBorderTexture!: Texture;
  private cellHighlightTexture!: Texture;

  private xpCircle!: BannerCircle;
  private heart!: Sprite;
  private heartDefaultFiller!: Sprite;
  private heartFiller!: Sprite;
  private heartFillerMask!: Graphics;
  private bannerContainer!: Sprite;
  private emotesPopup!: Sprite;

  // Icon buttons (button + icon as children) with their X positions relative to white zone
  private iconButtons: { button: IconButton; relativeX: number }[] = [];

  // Shortcut cells grid (2 rows × 7 columns = 14 cells)
  private shortcutCells: ShortcutCell[] = [];
  private shortcutsContainer!: Container;

  // Chat UI elements
  private chatContainer!: Container;
  private chatExpanded: boolean = false;
  private chatExpandButton!: ChatButton;
  private chatEmotesButton!: ChatButton;
  private chatSitButton!: ChatButton;
  private chatTextBackground!: Graphics;
  private chatFilters: ChatFilter[] = [];
  private chatInput!: Input;

  private currentZoom: number = 1;
  private currentWidth: number = 0;
  private displayHeight: number = 432;
  private loaded: boolean = false;
  private minimapContainer: Container;
  private minimapMask: Graphics;
  private minimapHitArea: Graphics;
  private worldMapRenderer: WorldMapRenderer | null = null;

  constructor(app: Application, displayHeight: number) {
    this.app = app;
    this.container = new Container();
    this.displayHeight = displayHeight;

    // Create background rectangle
    this.background = new Graphics();
    this.container.addChild(this.background);

    // Create white zones
    this.whiteZoneBottomLeft = new Graphics();
    this.whiteZoneTopRight = new Container();

    this.container.addChild(this.whiteZoneBottomLeft);
    this.container.addChild(this.whiteZoneTopRight);

    // Create minimap container and mask
    this.minimapContainer = new Container();
    this.minimapContainer.eventMode = 'none';
    this.minimapMask = new Graphics();
    this.minimapContainer.mask = this.minimapMask;

    // Create interactive hit area for minimap
    this.minimapHitArea = new Graphics();
    this.minimapHitArea.eventMode = 'static';
    this.minimapHitArea.cursor = 'pointer';

    // Setup hover events
    this.minimapHitArea.on('pointerover', () => this.expandMinimap());
    this.minimapHitArea.on('pointerout', () => this.collapseMinimap());

    // Load assets asynchronously
    this.loadAssets();
  }

  private createIconButton(iconTexturePath: string, iconData: AssetEntry): IconButton {
    const container = new Container();

    // Create button background
    const button = new Sprite(this.buttonUpTexture);
    button.anchor.set(0.5, 0.5);
    container.addChild(button);

    // Create icon on top
    const icon = Sprite.from(iconTexturePath);
    icon.anchor.set(0.5, 0.5);
    container.addChild(icon);

    // Calculate registration point offset (difference between texture center and Flash reg point)
    // Flash reg point is at (-offsetX, -offsetY), texture center is at (width/2, height/2)
    // We need to shift the icon so the Flash reg point aligns with button center
    const baseOffsetX = (iconData.width / 2 + iconData.offsetX) / this.manifest.scale;
    const baseOffsetY = (iconData.height / 2 + iconData.offsetY) / this.manifest.scale;

    // Store base offset for use in draw()
    (icon as any)._baseOffsetX = baseOffsetX;
    (icon as any)._baseOffsetY = baseOffsetY;

    // Make interactive
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const iconButton: IconButton = { container, button, icon, isPressed: false };

    // Click to toggle button state
    // Flash shifts icon by +0.5px when pressed (lines 41-44 in Button.as)
    container.on('pointerdown', () => {
      iconButton.isPressed = !iconButton.isPressed;
      button.texture = iconButton.isPressed ? this.buttonDownTexture : this.buttonUpTexture;

      // Update icon position with pressed shift
      const pressedShift = iconButton.isPressed ? 0.5 : 0;
      const s = this.currentZoom;
      icon.position.set(
        (baseOffsetX + pressedShift) * s,
        (baseOffsetY + pressedShift) * s
      );
    });

    return iconButton;
  }

  private createShortcutCell(): ShortcutCell {
    const container = new Container();

    // Create background (always visible)
    const background = new Sprite(this.cellBackgroundTexture);
    container.addChild(background);

    // Create border (always visible)
    const border = new Sprite(this.cellBorderTexture);
    container.addChild(border);

    // Create highlight (visible on hover)
    const highlight = new Sprite(this.cellHighlightTexture);
    highlight.visible = false;
    container.addChild(highlight);

    // Make interactive
    container.eventMode = 'static';
    container.cursor = 'pointer';

    // Hover to show highlight
    container.on('pointerover', () => {
      highlight.visible = true;
    });
    container.on('pointerout', () => {
      highlight.visible = false;
    });

    return { container, background, border, highlight };
  }

  private createChatButton(iconPath: string, hoverIconPath?: string): ChatButton {
    const container = new Container();

    // Create icon
    const icon = Sprite.from(iconPath);
    container.addChild(icon);

    // Create hover icon if provided
    let hoverIcon: Sprite | undefined;
    if (hoverIconPath) {
      hoverIcon = Sprite.from(hoverIconPath);
      hoverIcon.visible = false;
      container.addChild(hoverIcon);
    }

    // Make interactive
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const chatButton: ChatButton = { container, icon, hoverIcon, isPressed: false };

    // Hover effects
    container.on('pointerover', () => {
      if (hoverIcon) {
        icon.visible = false;
        hoverIcon.visible = true;
      }
    });
    container.on('pointerout', () => {
      if (hoverIcon) {
        icon.visible = true;
        hoverIcon.visible = false;
      }
    });

    // Click handler
    container.on('pointerdown', () => {
      chatButton.isPressed = !chatButton.isPressed;
    });

    return chatButton;
  }

  private createChatFilter(color: number, index: number): ChatFilter {
    const container = new Container();

    // Create background (12x12 checkbox)
    // Border color from ButtonToggle: #cccccc (gray)
    const background = new Graphics();
    background.rect(0, 0, 12, 12);
    background.stroke({ color: 0xcccccc, width: 1 });
    background.rect(1, 1, 10, 10);
    background.fill({ color: color });
    container.addChild(background);

    // Create checkmark (initially visible) - white color
    const checkmark = new Graphics();
    checkmark.moveTo(2, 6);
    checkmark.lineTo(5, 9);
    checkmark.lineTo(10, 3);
    checkmark.stroke({ color: 0xffffff, width: 2 });
    container.addChild(checkmark);

    // Make interactive
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const filter: ChatFilter = { container, background, checkmark, isActive: true };

    // Click to toggle
    container.on('pointerdown', () => {
      filter.isActive = !filter.isActive;
      checkmark.visible = filter.isActive;
    });

    return filter;
  }

  private async loadAssets(): Promise<void> {
    // Load manifest first
    this.manifest = await Assets.load(`${BANNER_ASSETS_PATH}/manifest.json`);

    // Build asset list from manifest
    const iconAssets = Object.values(this.manifest.icons).map(i => `${BANNER_ASSETS_PATH}/${i.file}`);
    const containerAssets = Object.values(this.manifest.container).map(c => `${BANNER_ASSETS_PATH}/${c.file}`);

    // Chat button assets (not in manifest, loaded separately)
    const chatAssets = [
      `${BANNER_ASSETS_PATH}/icons/expand.webp`,
      `${BANNER_ASSETS_PATH}/icons/reduce.webp`,
      `${BANNER_ASSETS_PATH}/icons/emotes.webp`,
      `${BANNER_ASSETS_PATH}/icons/emotes-hover.webp`,
      `${BANNER_ASSETS_PATH}/icons/sit.webp`,
      `${BANNER_ASSETS_PATH}/icons/sit-hover.webp`,
    ];

    // Load all textures
    await Assets.load([
      `${BANNER_ASSETS_PATH}/heart.webp`,
      `${BANNER_ASSETS_PATH}/heart-default-filler.webp`,
      `${BANNER_ASSETS_PATH}/heart-filler.webp`,
      `${BANNER_ASSETS_PATH}/container.webp`,
      `${BANNER_ASSETS_PATH}/emotes-popup.webp`,
      ...iconAssets,
      ...containerAssets,
      ...chatAssets
    ]);

    // Store button textures for reuse
    this.buttonUpTexture = Texture.from(`${BANNER_ASSETS_PATH}/${this.manifest.icons['button-up'].file}`);
    this.buttonDownTexture = Texture.from(`${BANNER_ASSETS_PATH}/${this.manifest.icons['button-down'].file}`);

    // Store container cell textures for reuse
    this.cellBackgroundTexture = Texture.from(`${BANNER_ASSETS_PATH}/${this.manifest.container.background.file}`);
    this.cellBorderTexture = Texture.from(`${BANNER_ASSETS_PATH}/${this.manifest.container.border.file}`);
    this.cellHighlightTexture = Texture.from(`${BANNER_ASSETS_PATH}/${this.manifest.container.highlight.file}`);

    // Create sprites after textures are loaded
    this.heart = Sprite.from(`${BANNER_ASSETS_PATH}/heart.webp`);
    this.heartDefaultFiller = Sprite.from(`${BANNER_ASSETS_PATH}/heart-default-filler.webp`);
    this.heartFiller = Sprite.from(`${BANNER_ASSETS_PATH}/heart-filler.webp`);
    this.bannerContainer = Sprite.from(`${BANNER_ASSETS_PATH}/container.webp`);
    this.emotesPopup = Sprite.from(`${BANNER_ASSETS_PATH}/emotes-popup.webp`);

    // Create icon buttons (button background + icon)
    // X positions from SVG relative to white zone (white zone starts at X=415, buttons at their X)
    const iconConfigs = [
      { key: 'stats', path: this.manifest.icons.stats.file, x: 476 - 415 },      // 61
      { key: 'spells', path: this.manifest.icons.spells.file, x: 505.25 - 415 }, // 90.25
      { key: 'inventory', path: this.manifest.icons.inventory.file, x: 534.5 - 415 }, // 119.5
      { key: 'quest', path: this.manifest.icons.quest.file, x: 563.75 - 415 },   // 148.75
      { key: 'map', path: this.manifest.icons.map.file, x: 593 - 415 },          // 178
      { key: 'friends', path: this.manifest.icons.friends.file, x: 622.25 - 415 }, // 207.25
      { key: 'guild', path: this.manifest.icons.guild.file, x: 651.5 - 415 },    // 236.5
      { key: 'mount', path: this.manifest.icons.mount.file, x: 680.75 - 415 },   // 265.75
      { key: 'pvp', path: this.manifest.icons.pvp.file, x: 710 - 415 },          // 295
    ];

    for (const config of iconConfigs) {
      const iconData = this.manifest.icons[config.key];
      const iconButton = this.createIconButton(`${BANNER_ASSETS_PATH}/${config.path}`, iconData);
      this.iconButtons.push({ button: iconButton, relativeX: config.x });
    }

    // Create shortcuts container and 14 cells (2 rows × 7 columns)
    this.shortcutsContainer = new Container();
    for (let i = 0; i < 14; i++) {
      const cell = this.createShortcutCell();
      this.shortcutCells.push(cell);
      this.shortcutsContainer.addChild(cell.container);
    }

    // Create chat container and UI elements
    this.chatContainer = new Container();

    // Chat text background (border lines around chat area)
    this.chatTextBackground = new Graphics();
    this.chatContainer.addChild(this.chatTextBackground);

    // Chat input at bottom using @pixi/ui Input
    const inputBg = new Graphics();
    inputBg.rect(0, 0, 430, 21);
    inputBg.fill({ color: 0xffffff });

    this.chatInput = new Input({
      bg: inputBg,
      placeholder: '',
      textStyle: {
        fontSize: 12,
        fill: 0x000000,
        fontFamily: 'Arial',
      },
      padding: { left: 5, right: 5, top: 3, bottom: 3 },
      addMask: true,
    });
    this.chatContainer.addChild(this.chatInput);

    // Create expand/reduce button (shows expand icon when collapsed, reduce when expanded)
    this.chatExpandButton = this.createChatButton(
      `${BANNER_ASSETS_PATH}/icons/expand.webp`
    );
    // Custom click handler for expand button
    this.chatExpandButton.container.off('pointerdown');
    this.chatExpandButton.container.on('pointerdown', () => {
      this.chatExpanded = !this.chatExpanded;
      // Swap icon based on state
      const expandTexture = Texture.from(`${BANNER_ASSETS_PATH}/icons/expand.webp`);
      const reduceTexture = Texture.from(`${BANNER_ASSETS_PATH}/icons/reduce.webp`);
      this.chatExpandButton.icon.texture = this.chatExpanded ? reduceTexture : expandTexture;
      this.draw(); // Redraw to update chat height
    });
    this.chatContainer.addChild(this.chatExpandButton.container);

    // Create emotes button
    this.chatEmotesButton = this.createChatButton(
      `${BANNER_ASSETS_PATH}/icons/emotes.webp`,
      `${BANNER_ASSETS_PATH}/icons/emotes-hover.webp`
    );
    // Custom click handler to toggle emotes popup
    this.chatEmotesButton.container.off('pointerdown');
    this.chatEmotesButton.container.on('pointerdown', () => {
      this.emotesPopup.visible = !this.emotesPopup.visible;
    });
    this.chatContainer.addChild(this.chatEmotesButton.container);

    // Create sit button
    this.chatSitButton = this.createChatButton(
      `${BANNER_ASSETS_PATH}/icons/sit.webp`,
      `${BANNER_ASSETS_PATH}/icons/sit-hover.webp`
    );
    this.chatContainer.addChild(this.chatSitButton.container);

    // Create chat filters based on Dofus Constants.as colors
    // Visible filters from SVG (filter 1 for errors and filter 9 for admin are hidden)
    // Filter index -> chat type mapping: 0=INFOS, 2=MESSAGES, 3=WISP, 4=GUILD, 5=PVP, 6=RECRUITMENT, 7=TRADE, 10=GAME_EVENTS
    const filterConfigs = [
      { index: 0, color: 0x009900 }, // Infos (green)
      { index: 2, color: 0x111111 }, // Messages (dark gray)
      { index: 3, color: 0x0066ff }, // Whisper (blue)
      { index: 4, color: 0x663399 }, // Guild (purple)
      { index: 5, color: 0xdd7700 }, // PvP (orange)
      { index: 6, color: 0x737373 }, // Recruitment (gray)
      { index: 7, color: 0x663300 }, // Trade (brown)
      { index: 10, color: 0xe4287c }, // Game Events (pinkish-red - COMMANDS_CHAT_COLOR)
    ];

    for (const config of filterConfigs) {
      const filter = this.createChatFilter(config.color, config.index);
      this.chatFilters.push(filter);
      this.chatContainer.addChild(filter.container);
    }

    // Hide emotes popup initially (will show on emotes button click)
    this.emotesPopup.visible = false;
    // Add emotes popup to chat container so it moves with chat
    this.chatContainer.addChild(this.emotesPopup);

    // Create mask for heart filler to show only 54% height
    this.heartFillerMask = new Graphics();
    this.heartFiller.mask = this.heartFillerMask;

    this.xpCircle = createBannerCircle({
      innerLayerContent: this.minimapContainer,
      fillableCircleValue: 34,
      fiillableCircleValueTooltip: '34 %',
      scale: this.currentZoom
    });

    // Add in correct z-order (background already added)
    this.container.addChild(this.chatContainer);
    this.container.addChild(this.bannerContainer);
    this.container.addChild(this.shortcutsContainer);
    this.container.addChild(this.xpCircle.container);
    this.container.addChild(this.minimapMask);
    // Heart layers: default filler (100%) -> filler (HP%) -> outline (100%)
    this.container.addChild(this.heartDefaultFiller);
    this.container.addChild(this.heartFiller);
    this.container.addChild(this.heartFillerMask);
    this.container.addChild(this.heart);
    // Add hit area on top of everything for interaction
    this.container.addChild(this.minimapHitArea);

    this.loaded = true;

    // Load minimap
    await this.loadMinimap();

    // Redraw if init was already called
    if (this.currentZoom > 0) {
      this.draw();
    }
  }

  private async loadMinimap(): Promise<void> {
    // Create WorldMapRenderer in minimap mode with 300% zoom
    this.worldMapRenderer = new WorldMapRenderer({
      app: this.app,
      minimapMode: true,
      minimapZoom: 300,
      centerOnCoordinates: { x: 4, y: -19 },
      parentContainer: this.minimapContainer,
    });

    // Load Amakna world map
    await this.worldMapRenderer.loadWorldMap(0);

    // Show the minimap
    this.worldMapRenderer.show();
  }

  /**
   * Initialize the banner with the given dimensions
   */
  public init(width: number, zoom: number): void {
    this.currentZoom = zoom;
    this.currentWidth = width;
    this.draw();
  }

  /**
   * Update the banner size when the canvas is resized
   */
  public resize(width: number, zoom: number): void {
    this.currentZoom = zoom;
    this.currentWidth = width;
    this.draw();
  }

  /**
   * Show or hide the level-up heart filler
   */
  public setLevelBadgeVisible(visible: boolean): void {
    this.heartDefaultFiller.visible = visible;
  }

  /**
   * Position and scale all banner elements
   */
  private draw(): void {
    const bannerOffsetY = Math.floor(this.displayHeight * this.currentZoom);
    const s = this.currentZoom;

    // Draw background rectangle
    this.background.clear();
    this.background.rect(0, bannerOffsetY, this.currentWidth, 125 * s);
    this.background.fill({ color: 0xd5cfaa });

    // Draw white zones
    // Bottom left white zone: SVG position (50.5, 172) → logical (-7.5, 104)
    this.whiteZoneBottomLeft.clear();
    this.whiteZoneBottomLeft.rect(-7.5 * s, bannerOffsetY + 104 * s, 430 * s, 21 * s);
    this.whiteZoneBottomLeft.fill({ color: 0xffffff });

    // Only position sprites if they're loaded
    if (!this.loaded) return;

    // Textures are rendered at 6x scale, so scale them down based on manifest
    const textureScale = s / this.manifest.scale;

    // Position the white zone container for icons
    // SVG position (473, 67.95) → logical (415, -0.05)
    this.whiteZoneTopRight.position.set(415 * s, bannerOffsetY - 0.05 * s);

    // Clear and rebuild children each frame
    this.whiteZoneTopRight.removeChildren();

    // Add white background rectangle
    const rectangle = new Graphics();
    rectangle.rect(0, 0, 327 * s, 40 * s);
    rectangle.fill({ color: 0xffffff });
    this.whiteZoneTopRight.addChild(rectangle);

    // Our button texture is 78px at 3x scale = 26px logical, center offset = 13
    // Y position: centered in white zone (height 40)
    const buttonLogicalWidth = this.manifest.icons['button-up'].width / this.manifest.scale; // 26
    const buttonCenterOffsetX = buttonLogicalWidth / 2; // 13
    const buttonCenterY = 20;

    // Add icon buttons at their exact SVG positions
    for (const { button: iconButton, relativeX } of this.iconButtons) {
      // Scale the button and icon
      iconButton.button.scale.set(textureScale);
      iconButton.icon.scale.set(textureScale);

      // Apply registration point offset (stored during creation)
      // Plus 0.5px shift when pressed (Flash Button.as lines 41-44)
      const baseOffsetX = (iconButton.icon as any)._baseOffsetX || 0;
      const baseOffsetY = (iconButton.icon as any)._baseOffsetY || 0;
      const pressedShift = iconButton.isPressed ? 0.5 : 0;
      iconButton.icon.position.set(
        (baseOffsetX + pressedShift) * s,
        (baseOffsetY + pressedShift) * s
      );

      // Position at exact X from SVG (relativeX is left edge, add center offset)
      // Y centered in white zone
      iconButton.container.position.set(
        (relativeX + buttonCenterOffsetX) * s,
        buttonCenterY * s
      );

      this.whiteZoneTopRight.addChild(iconButton.container);
    }

    // Navy circle center from SVG: (475, 133.4) → logical: (417, 65.4)
    const xpCircleCenterX = 417 * s;
    const xpCircleCenterY = bannerOffsetY + 65.4 * s;
    const minimapRadius = CIRCLE_INNER_CONTENT_RADIUS * s;

    // Draw circular mask for minimap
    this.minimapMask.clear();
    this.minimapMask.circle(xpCircleCenterX, xpCircleCenterY, minimapRadius);
    this.minimapMask.fill({ color: 0xffffff });

    // Draw hit area for minimap interaction (same as mask)
    this.minimapHitArea.clear();
    this.minimapHitArea.circle(xpCircleCenterX, xpCircleCenterY, minimapRadius);
    this.minimapHitArea.fill({ color: 0x000000, alpha: 0 });

    // Position and scale minimap container
    const minimapScale = (minimapRadius * 2) / 742;

    // Position container at circle center (WorldMapRenderer positions coordinate at 0,0)
    this.minimapContainer.position.set(0, 0);
    this.minimapContainer.scale.set(minimapScale);

    // XP Circle - positioned at center and redrawn at current scale
    this.xpCircle.container.position.set(xpCircleCenterX, xpCircleCenterY);
    this.xpCircle.redraw(s);

    // Heart Badge - positioned above XP circle
    // SVG viewBox was: 453 63 44 41
    // Origin in logical space: (453 - 58, 63 - 68) = (395, -5)

    this.heartDefaultFiller.position.set(395 * s, bannerOffsetY - 5 * s);
    this.heartDefaultFiller.scale.set(textureScale);

    this.heartFiller.position.set(395 * s, bannerOffsetY - 5 * s);
    this.heartFiller.scale.set(textureScale);

    // Draw mask to show only 54% of heart filler (from bottom)
    const heartHeight = 41; // SVG height
    const hpPercentage = 0.54;
    const visibleHeight = heartHeight * hpPercentage;
    const maskStartY = bannerOffsetY - 5 * s + (heartHeight - visibleHeight) * s;

    this.heartFillerMask.clear();
    this.heartFillerMask.rect(395 * s, maskStartY, 44 * s, visibleHeight * s);
    this.heartFillerMask.fill({ color: 0xffffff });

    this.heart.position.set(395 * s, bannerOffsetY - 5 * s);
    this.heart.scale.set(textureScale);

    // Spell Holder - positioned on right side
    // SVG viewBox was: 522 118 252 63
    // Origin in logical space: (522 - 58, 118 - 68) = (464, 50)
    this.bannerContainer.position.set(464 * s, bannerOffsetY + 50 * s);
    this.bannerContainer.scale.set(textureScale);

    // Shortcut cells grid - positioned on the spell holder
    // Cell dimensions and spacing from SVG
    const cellHeight = this.manifest.container.background.height / this.manifest.scale; // 25
    const cellSpacingX = 28;
    const cellSpacingY = 29;
    const containerHeight = 64; // spell holder height from SVG
    const gridHeight = cellSpacingY + cellHeight; // 29 + 25 = 54 (2 rows)
    const paddingY = (containerHeight - gridHeight) / 2; // (64 - 54) / 2 = 5

    const shortcutsStartX = 518.35;
    const shortcutsStartY = 50 + paddingY; // holder Y + padding

    this.shortcutsContainer.position.set(shortcutsStartX * s, bannerOffsetY + shortcutsStartY * s);

    for (let i = 0; i < this.shortcutCells.length; i++) {
      const cell = this.shortcutCells[i];
      const row = Math.floor(i / 7);
      const col = i % 7;

      // Position cell within grid
      cell.container.position.set(col * cellSpacingX * s, row * cellSpacingY * s);

      // Scale all cell sprites
      cell.background.scale.set(textureScale);
      cell.border.scale.set(textureScale);
      cell.highlight.scale.set(textureScale);
    }

    // Chat Container - positioned at left side of banner
    // The chat area structure:
    // - Chat message area is ABOVE the banner (expands upward)
    // - Chat buttons (expand, emotes, sit) are ON the banner at the top-left
    // - Chat filters are ON the banner, in a row at Y=10
    // - Chat input is at the FULL BOTTOM of the banner (Y=104 from banner top)

    // Chat text area height: 82 collapsed (from SVG _txtChat), expands by OPEN_OFFSET=350
    const chatTextHeight = this.chatExpanded ? 82 + 350 : 82;

    // Position chat container at banner top-left (buttons and filters are relative to this)
    this.chatContainer.position.set(0, bannerOffsetY);

    // Chat button icons scale (assets are at 3x scale, need to scale down)
    const chatButtonScale = s / 3;

    // Chat styled rectangles from ActionScript styles:
    // - WhiteChatStylizedRectangle: bgcolor=16777215 (0xFFFFFF), cornerradius={tl:0,tr:10,br:0,bl:0}
    // - BrownChatStylizedRectangle: bgcolor=9208680 (0x8C8368), cornerradius={tl:0,tr:10,br:0,bl:0}
    // From SVG: White rect at Y=0 (width 420), Brown rect at Y=6 (width 415)
    // The white bar is visible as the top 6px, then brown covers below it
    this.chatTextBackground.clear();

    // White bar at top (Y=0, height=6px visible before brown covers it)
    this.chatTextBackground.rect(0, 0, 420 * s, 6 * s);
    this.chatTextBackground.fill({ color: 0xffffff });

    // Brown bar (Y=6, height=10px visible before _mcChatBackground covers it at Y=16)
    this.chatTextBackground.rect(0, 6 * s, 415 * s, 10 * s);
    this.chatTextBackground.fill({ color: 0x8c8368 });

    // Position chat input at FULL BOTTOM of banner
    // From SVG: _mcBgTxtConsole at Y=104 from banner top
    // Position at X=0 to avoid clipping (whiteZoneBottomLeft provides visual background to X=-7.5)
    const inputY = 104; // At bottom of banner
    this.chatInput.position.set(0, inputY * s);
    this.chatInput.scale.set(s);

    // Position chat buttons at banner top-left
    // From SVG: _btnOpenClose at (0,0), _btnSmileys at (19,0), _btnSitDown at (41, 0.05)
    // These are relative to object-6 internal origin, positioned ON the banner

    // Position expand/reduce button (leftmost)
    this.chatExpandButton.icon.scale.set(chatButtonScale);
    this.chatExpandButton.container.position.set(0, 0);

    // Position emotes button (next to expand)
    this.chatEmotesButton.icon.scale.set(chatButtonScale);
    if (this.chatEmotesButton.hoverIcon) {
      this.chatEmotesButton.hoverIcon.scale.set(chatButtonScale);
    }
    this.chatEmotesButton.container.position.set(19 * s, 0);

    // Position sit button (next to emotes)
    this.chatSitButton.icon.scale.set(chatButtonScale);
    if (this.chatSitButton.hoverIcon) {
      this.chatSitButton.hoverIcon.scale.set(chatButtonScale);
    }
    this.chatSitButton.container.position.set(41 * s, 0.05 * s);

    // Position chat filters in a row
    // From SVG: filters at Y=10 (relative to object-6 internal origin at 67.95)
    // Spacing from loader.swf ChatFilters: exactly 14px apart (14.05, 28.05, 42.05, etc.)
    const filterStartX = 238;
    const filterSpacing = 14;
    const filterY = 10;

    for (let i = 0; i < this.chatFilters.length; i++) {
      const filter = this.chatFilters[i];
      const filterX = filterStartX + i * filterSpacing;

      filter.container.scale.set(s);
      filter.container.position.set(filterX * s, filterY * s);
    }

    // Position emotes popup (above the emotes button when visible)
    // From SVG: _sSmileys at X=19, Y=-67.95 (above chat origin)
    // sprite9 has internal offset Y=0.95, so actual position is -67.95 + 0.95 = -67
    this.emotesPopup.position.set(19 * s, -67 * s);
    this.emotesPopup.scale.set(textureScale);
  }

  /**
   * Expand minimap on hover
   */
  private expandMinimap(): void {
    if (!this.loaded) return;

    const s = this.currentZoom;
    const bannerOffsetY = Math.floor(this.displayHeight * this.currentZoom);
    const xpCircleCenterX = 417 * s;
    const xpCircleCenterY = bannerOffsetY + 65.4 * s;

    // Keep minimap scale constant to show more area
    const minimapScale = (CIRCLE_INNER_CONTENT_RADIUS * 2 * s) / 742;

    // Heart animation positions
    const heartStartY = bannerOffsetY - 5 * s;
    const heartEndY = bannerOffsetY - 35 * s;
    const heartDelta = heartEndY - heartStartY;

    this.xpCircle.expand((currentRadius) => {
      const scaledRadius = currentRadius * s;

      // Update minimap mask
      this.minimapMask.clear();
      this.minimapMask.circle(xpCircleCenterX, xpCircleCenterY, scaledRadius);
      this.minimapMask.fill({ color: 0xffffff });

      // Update hit area
      this.minimapHitArea.clear();
      this.minimapHitArea.circle(xpCircleCenterX, xpCircleCenterY, scaledRadius);
      this.minimapHitArea.fill({ color: 0x000000, alpha: 0 });

      // Keep minimap scale constant
      this.minimapContainer.scale.set(minimapScale);

      // Animate heart badges
      const progress = (currentRadius - CIRCLE_INNER_CONTENT_RADIUS) / (CIRCLE_FILLABLE_OUTER_RADIUS - CIRCLE_INNER_CONTENT_RADIUS);
      const currentHeartY = heartStartY + heartDelta * progress;
      this.heart.y = currentHeartY;
      this.heartDefaultFiller.y = currentHeartY;
      this.heartFiller.y = currentHeartY;
    });
  }

  /**
   * Collapse minimap when hover ends
   */
  private collapseMinimap(): void {
    if (!this.loaded) return;

    const s = this.currentZoom;
    const bannerOffsetY = Math.floor(this.displayHeight * this.currentZoom);
    const xpCircleCenterX = 417 * s;
    const xpCircleCenterY = bannerOffsetY + 65.4 * s;

    // Keep minimap scale constant during collapse
    const minimapScale = (CIRCLE_INNER_CONTENT_RADIUS * 2 * s) / 742;

    // Heart animation positions
    const heartStartY = bannerOffsetY - 35 * s;
    const heartEndY = bannerOffsetY - 5 * s;
    const heartDelta = heartEndY - heartStartY;

    this.xpCircle.collapse((currentRadius) => {
      const scaledRadius = currentRadius * s;

      // Update minimap mask
      this.minimapMask.clear();
      this.minimapMask.circle(xpCircleCenterX, xpCircleCenterY, scaledRadius);
      this.minimapMask.fill({ color: 0xffffff });

      // Update hit area
      this.minimapHitArea.clear();
      this.minimapHitArea.circle(xpCircleCenterX, xpCircleCenterY, scaledRadius);
      this.minimapHitArea.fill({ color: 0x000000, alpha: 0 });

      // Keep minimap scale constant
      this.minimapContainer.scale.set(minimapScale);

      // Animate heart badges
      const progress = (CIRCLE_FILLABLE_OUTER_RADIUS - currentRadius) / (CIRCLE_FILLABLE_OUTER_RADIUS - CIRCLE_INNER_CONTENT_RADIUS);
      const currentHeartY = heartStartY + heartDelta * progress;
      this.heart.y = currentHeartY;
      this.heartDefaultFiller.y = currentHeartY;
      this.heartFiller.y = currentHeartY;
    });
  }

  /**
   * Get the PixiJS Container with all banner elements
   */
  public getGraphics(): Container {
    return this.container;
  }

  /**
   * Destroy the banner and clean up resources
   */
  public destroy(): void {
    if (this.worldMapRenderer) {
      this.worldMapRenderer.destroy();
    }

    // Only destroy sprites if they were loaded
    if (this.loaded) {
      this.xpCircle.container.destroy({ children: true });
      this.heart.destroy({ texture: false });
      this.heartDefaultFiller.destroy({ texture: false });
      this.heartFiller.destroy({ texture: false });
      this.bannerContainer.destroy({ texture: false });
      this.emotesPopup.destroy({ texture: false });

      // Destroy icon buttons
      for (const { button: iconButton } of this.iconButtons) {
        iconButton.container.destroy({ children: true });
      }

      // Destroy shortcut cells
      for (const cell of this.shortcutCells) {
        cell.container.destroy({ children: true });
      }
      this.shortcutsContainer.destroy({ children: true });

      // Destroy chat elements
      this.chatExpandButton.container.destroy({ children: true });
      this.chatEmotesButton.container.destroy({ children: true });
      this.chatSitButton.container.destroy({ children: true });
      for (const filter of this.chatFilters) {
        filter.container.destroy({ children: true });
      }
      this.chatContainer.destroy({ children: true });
    }

    this.container.destroy({ children: true });
  }
}
