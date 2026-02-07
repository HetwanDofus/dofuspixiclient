import type { Application } from 'pixi.js';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { MinimapRenderer } from '@/ank/gapi/worldmap/minimap-renderer';
import {
  createBannerCircle,
  CIRCLE_INNER_CONTENT_RADIUS,
  CIRCLE_FILLABLE_OUTER_RADIUS,
  type BannerCircle,
} from './banner-circle';
import { createAllIconButtons, updateIconButtonPosition } from './banner-icons';
import { createShortcutGrid, updateShortcutGridPositions } from './banner-shortcuts';
import {
  createChatUI,
  updateChatPositions,
  type ChatUI,
  type ChatIconTextures,
} from './banner-chat';
import type { BannerManifest, IconButtonWithOffset, ShortcutCell } from '@/types/banner';
import { BANNER_ASSETS_PATH, ICON_BUTTON_CONFIGS } from '@/types/banner';

const MASK_TEXTURE_SIZE = 256;
const MASK_FEATHER_SIZE = 2;
const MASK_VISIBLE_RADIUS = MASK_TEXTURE_SIZE / 2 - MASK_FEATHER_SIZE;

function createSoftCircleMaskTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = MASK_TEXTURE_SIZE;
  canvas.height = MASK_TEXTURE_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  const centerX = MASK_TEXTURE_SIZE / 2;
  const centerY = MASK_TEXTURE_SIZE / 2;
  const radius = MASK_TEXTURE_SIZE / 2 - MASK_FEATHER_SIZE;

  const gradient = ctx.createRadialGradient(
    centerX,
    centerY,
    radius - MASK_FEATHER_SIZE,
    centerX,
    centerY,
    radius + MASK_FEATHER_SIZE
  );

  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + MASK_FEATHER_SIZE, 0, Math.PI * 2);
  ctx.fill();

  return Texture.from(canvas);
}

export class Banner {
  private app: Application;
  private container: Container;
  private background: Graphics;
  private whiteZoneBottomLeft: Graphics;
  private whiteZoneTopRight: Container;

  private manifest!: BannerManifest;
  private buttonUpTexture!: Texture;
  private buttonDownTexture!: Texture;

  private xpCircle!: BannerCircle;
  private heart!: Sprite;
  private heartDefaultFiller!: Sprite;
  private heartFiller!: Sprite;
  private heartFillerMask!: Graphics;
  private bannerContainer!: Sprite;
  private emotesPopup!: Sprite;

  private iconButtons: Array<{ button: IconButtonWithOffset; relativeX: number }> = [];
  private shortcutCells: ShortcutCell[] = [];
  private shortcutsContainer!: Container;
  private chatUI!: ChatUI;

  private currentZoom = 1;
  private currentWidth = 0;
  private displayHeight = 432;
  private loaded = false;

  /** All SVG icon paths for zoom-dependent reloading */
  private allIconSvgPaths: string[] = [];
  /** Current resolution at which icon SVGs are rasterized */
  private currentIconResolution = 0;
  /** Cached icon textures keyed by original path */
  private iconTextures = new Map<string, Texture>();
  /** PixiJS Assets aliases for icon textures (for cleanup) */
  private iconAssetAliases = new Set<string>();

  private minimapContainer: Container;
  private minimapMask!: Sprite;
  private minimapMaskTexture!: Texture;
  private minimapHitArea: Graphics;
  private minimapRenderer: MinimapRenderer | null = null;

  constructor(app: Application, displayHeight: number) {
    this.app = app;
    this.container = new Container();
    this.displayHeight = displayHeight;

    this.background = new Graphics();
    this.container.addChild(this.background);

    this.whiteZoneBottomLeft = new Graphics();
    this.whiteZoneTopRight = new Container();
    this.container.addChild(this.whiteZoneBottomLeft);
    this.container.addChild(this.whiteZoneTopRight);

    this.minimapContainer = new Container();
    this.minimapContainer.eventMode = 'none';

    this.minimapHitArea = new Graphics();
    this.minimapHitArea.eventMode = 'static';
    this.minimapHitArea.cursor = 'pointer';

    this.minimapHitArea.on('pointerover', () => {
      this.expandMinimap();
    });

    this.minimapHitArea.on('pointerout', () => {
      this.collapseMinimap();
    });

    this.loadAssets();
  }

  private async loadAssets(): Promise<void> {
    this.manifest = await Assets.load(`${BANNER_ASSETS_PATH}/manifest.json`);

    // Collect all SVG icon paths for zoom-dependent loading
    this.allIconSvgPaths = [
      ...Object.values(this.manifest.icons).map((i) => `${BANNER_ASSETS_PATH}/${i.file}`),
      `${BANNER_ASSETS_PATH}/icons/expand.svg`,
      `${BANNER_ASSETS_PATH}/icons/reduce.svg`,
      `${BANNER_ASSETS_PATH}/icons/emotes.svg`,
      `${BANNER_ASSETS_PATH}/icons/emotes-hover.svg`,
      `${BANNER_ASSETS_PATH}/icons/sit.svg`,
      `${BANNER_ASSETS_PATH}/icons/sit-hover.svg`,
    ];

    // Load icon SVGs at initial resolution (dpr * zoom)
    await this.loadIconTextures();

    const containerAssets = Object.values(this.manifest.container).map(
      (c) => `${BANNER_ASSETS_PATH}/${c.file}`
    );

    const loadedTextures = await Assets.load([
      `${BANNER_ASSETS_PATH}/heart.webp`,
      `${BANNER_ASSETS_PATH}/heart-default-filler.webp`,
      `${BANNER_ASSETS_PATH}/heart-filler.webp`,
      `${BANNER_ASSETS_PATH}/container.webp`,
      `${BANNER_ASSETS_PATH}/emotes-popup.webp`,
      ...containerAssets,
    ]);

    // Enable mipmaps on loaded textures for smooth downscaling
    for (const texture of Object.values(loadedTextures)) {
      if (texture?.source) {
        texture.source.autoGenerateMipmaps = true;
        texture.source.updateMipmaps();
      }
    }

    this.buttonUpTexture = this.getIconTexture(
      `${BANNER_ASSETS_PATH}/${this.manifest.icons['button-up'].file}`
    );

    this.buttonDownTexture = this.getIconTexture(
      `${BANNER_ASSETS_PATH}/${this.manifest.icons['button-down'].file}`
    );

    const cellBgTexture = Texture.from(
      `${BANNER_ASSETS_PATH}/${this.manifest.container.background.file}`
    );

    const cellBorderTexture = Texture.from(
      `${BANNER_ASSETS_PATH}/${this.manifest.container.border.file}`
    );

    const cellHighlightTexture = Texture.from(
      `${BANNER_ASSETS_PATH}/${this.manifest.container.highlight.file}`
    );

    this.heart = Sprite.from(`${BANNER_ASSETS_PATH}/heart.webp`);
    this.heartDefaultFiller = Sprite.from(`${BANNER_ASSETS_PATH}/heart-default-filler.webp`);
    this.heartFiller = Sprite.from(`${BANNER_ASSETS_PATH}/heart-filler.webp`);
    this.bannerContainer = Sprite.from(`${BANNER_ASSETS_PATH}/container.webp`);
    this.emotesPopup = Sprite.from(`${BANNER_ASSETS_PATH}/emotes-popup.webp`);

    this.iconButtons = createAllIconButtons(
      this.manifest,
      this.buttonUpTexture,
      this.buttonDownTexture,
      (path) => this.getIconTexture(path)
    );

    this.shortcutsContainer = new Container();
    this.shortcutCells = createShortcutGrid(
      cellBgTexture,
      cellBorderTexture,
      cellHighlightTexture
    );

    for (const cell of this.shortcutCells) {
      this.shortcutsContainer.addChild(cell.container);
    }

    const chatIconTextures: ChatIconTextures = {
      expand: this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/expand.svg`),
      emotes: this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/emotes.svg`),
      emotesHover: this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/emotes-hover.svg`),
      sit: this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/sit.svg`),
      sitHover: this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/sit-hover.svg`),
    };
    this.chatUI = createChatUI(this.emotesPopup, chatIconTextures);
    this.setupChatHandlers();

    this.heartFillerMask = new Graphics();
    this.heartFiller.mask = this.heartFillerMask;

    this.minimapMaskTexture = createSoftCircleMaskTexture();
    this.minimapMask = new Sprite(this.minimapMaskTexture);
    this.minimapMask.anchor.set(0.5, 0.5);
    this.minimapContainer.mask = this.minimapMask;

    this.xpCircle = createBannerCircle({
      innerLayerContent: this.minimapContainer,
      fillableCircleValue: 34,
      fillableCircleValueTooltip: '34 %',
      scale: this.currentZoom,
    });

    this.container.addChild(this.chatUI.container);
    this.container.addChild(this.bannerContainer);
    this.container.addChild(this.shortcutsContainer);
    this.container.addChild(this.xpCircle.container);
    this.container.addChild(this.minimapMask);
    this.container.addChild(this.heartDefaultFiller);
    this.container.addChild(this.heartFiller);
    this.container.addChild(this.heartFillerMask);
    this.container.addChild(this.heart);
    this.container.addChild(this.minimapHitArea);

    this.loaded = true;

    await this.loadMinimap();

    if (this.currentZoom > 0) {
      this.draw();
    }
  }

  private getTargetIconResolution(): number {
    const raw = Math.max(window.devicePixelRatio, 1.1) * this.currentZoom;
    return Math.round(raw * 100) / 100;
  }

  private getIconTexture(path: string): Texture {
    return this.iconTextures.get(path) ?? Texture.EMPTY;
  }

  /**
   * Load all icon SVGs at the current zoom-dependent resolution.
   * Uses unique aliases and query params for cache busting (same pattern as AtlasLoader).
   */
  private async loadIconTextures(): Promise<void> {
    const resolution = this.getTargetIconResolution();
    this.currentIconResolution = resolution;

    const prevAliases = new Set(this.iconAssetAliases);
    this.iconAssetAliases.clear();

    const assets = this.allIconSvgPaths.map((path) => {
      const alias = `banner-icon:${path}:${resolution}`;
      this.iconAssetAliases.add(alias);
      return {
        alias,
        src: `${path}?r=${resolution}`,
        data: { resolution },
      };
    });

    const loadedTextures = await Assets.load(assets);

    // Map textures by original path
    for (let i = 0; i < this.allIconSvgPaths.length; i++) {
      const alias = `banner-icon:${this.allIconSvgPaths[i]}:${resolution}`;
      this.iconTextures.set(this.allIconSvgPaths[i], loadedTextures[alias]);
    }

    // Unload previous resolution textures
    for (const alias of prevAliases) {
      if (!this.iconAssetAliases.has(alias)) {
        Assets.unload(alias);
      }
    }
  }

  /**
   * Reload icon SVGs if the zoom-dependent resolution has changed.
   * Updates all sprite textures after loading.
   */
  private async reloadIconTextures(): Promise<void> {
    const targetResolution = this.getTargetIconResolution();
    if (targetResolution === this.currentIconResolution) {
      return;
    }

    await this.loadIconTextures();

    // Update button-up/down textures
    this.buttonUpTexture = this.getIconTexture(
      `${BANNER_ASSETS_PATH}/${this.manifest.icons['button-up'].file}`
    );
    this.buttonDownTexture = this.getIconTexture(
      `${BANNER_ASSETS_PATH}/${this.manifest.icons['button-down'].file}`
    );

    // Update toolbar icon button sprites
    const configs = ICON_BUTTON_CONFIGS;
    for (let i = 0; i < configs.length; i++) {
      const iconData = this.manifest.icons[configs[i].key];
      const iconPath = `${BANNER_ASSETS_PATH}/${iconData.file}`;
      const ib = this.iconButtons[i].button;
      ib.icon.texture = this.getIconTexture(iconPath);
      ib.button.texture = ib.isPressed ? this.buttonDownTexture : this.buttonUpTexture;
    }

    // Update chat button sprites
    this.chatUI.expandButton.icon.texture = this.chatUI.isExpanded
      ? this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/reduce.svg`)
      : this.getIconTexture(`${BANNER_ASSETS_PATH}/icons/expand.svg`);

    this.chatUI.emotesButton.icon.texture = this.getIconTexture(
      `${BANNER_ASSETS_PATH}/icons/emotes.svg`
    );
    if (this.chatUI.emotesButton.hoverIcon) {
      this.chatUI.emotesButton.hoverIcon.texture = this.getIconTexture(
        `${BANNER_ASSETS_PATH}/icons/emotes-hover.svg`
      );
    }

    this.chatUI.sitButton.icon.texture = this.getIconTexture(
      `${BANNER_ASSETS_PATH}/icons/sit.svg`
    );
    if (this.chatUI.sitButton.hoverIcon) {
      this.chatUI.sitButton.hoverIcon.texture = this.getIconTexture(
        `${BANNER_ASSETS_PATH}/icons/sit-hover.svg`
      );
    }

    this.draw();
  }

  private setupChatHandlers(): void {
    this.chatUI.expandButton.container.off('pointerdown');

    this.chatUI.expandButton.container.on('pointerdown', () => {
      this.chatUI.isExpanded = !this.chatUI.isExpanded;

      if (this.chatUI.isExpanded) {
        this.chatUI.expandButton.icon.texture = this.getIconTexture(
          `${BANNER_ASSETS_PATH}/icons/reduce.svg`
        );
      } else {
        this.chatUI.expandButton.icon.texture = this.getIconTexture(
          `${BANNER_ASSETS_PATH}/icons/expand.svg`
        );
      }

      this.draw();
    });

    this.chatUI.emotesButton.container.off('pointerdown');

    this.chatUI.emotesButton.container.on('pointerdown', () => {
      this.emotesPopup.visible = !this.emotesPopup.visible;
    });
  }

  private async loadMinimap(): Promise<void> {
    this.minimapRenderer = new MinimapRenderer({
      app: this.app,
      zoom: 300,
      centerOnCoordinates: { x: 4, y: -19 },
      parentContainer: this.minimapContainer,
    });

    await this.minimapRenderer.loadWorldMap(0);
    this.minimapRenderer.show();
  }

  public init(width: number, zoom: number): void {
    this.currentZoom = zoom;
    this.currentWidth = width;
    this.draw();
  }

  public resize(width: number, zoom: number): void {
    this.currentZoom = zoom;
    this.currentWidth = width;
    this.draw();
    this.reloadIconTextures();
  }

  public setLevelBadgeVisible(visible: boolean): void {
    this.heartDefaultFiller.visible = visible;
  }

  private draw(): void {
    const bannerOffsetY = Math.floor(this.displayHeight * this.currentZoom);
    const s = this.currentZoom;

    this.background.clear();
    this.background.rect(0, bannerOffsetY, this.currentWidth, 125 * s);
    this.background.fill({ color: 0xd5cfaa });

    this.whiteZoneBottomLeft.clear();
    this.whiteZoneBottomLeft.rect(-7.5 * s, bannerOffsetY + 104 * s, 430 * s, 21 * s);
    this.whiteZoneBottomLeft.fill({ color: 0xffffff });

    if (!this.loaded) {
      return;
    }

    const textureScale = s / this.manifest.scale;
    const iconTextureScale = s / this.manifest.iconScale;

    this.whiteZoneTopRight.position.set(415 * s, bannerOffsetY - 0.05 * s);
    this.whiteZoneTopRight.removeChildren();

    const rectangle = new Graphics();
    rectangle.rect(0, 0, 327 * s, 40 * s);
    rectangle.fill({ color: 0xffffff });
    this.whiteZoneTopRight.addChild(rectangle);

    const buttonLogicalWidth = this.manifest.icons['button-up'].width / this.manifest.iconScale;
    const buttonCenterOffsetX = buttonLogicalWidth / 2;
    const buttonCenterY = 20;

    for (const { button: iconButton, relativeX } of this.iconButtons) {
      updateIconButtonPosition(
        iconButton,
        relativeX,
        buttonCenterOffsetX,
        buttonCenterY,
        iconTextureScale,
        s
      );
      this.whiteZoneTopRight.addChild(iconButton.container);
    }

    const xpCircleCenterX = 417 * s;
    const xpCircleCenterY = bannerOffsetY + 65.4 * s;
    const minimapRadius = CIRCLE_INNER_CONTENT_RADIUS * s;

    const maskScale = minimapRadius / MASK_VISIBLE_RADIUS;
    this.minimapMask.position.set(xpCircleCenterX, xpCircleCenterY);
    this.minimapMask.scale.set(maskScale);

    this.minimapHitArea.clear();
    this.minimapHitArea.circle(xpCircleCenterX, xpCircleCenterY, minimapRadius);
    this.minimapHitArea.fill({ color: 0x000000, alpha: 0 });

    const minimapScale = (minimapRadius * 2) / 742;
    this.minimapContainer.position.set(0, 0);
    this.minimapContainer.scale.set(minimapScale);

    this.xpCircle.container.position.set(xpCircleCenterX, xpCircleCenterY);
    this.xpCircle.redraw(s);

    this.heartDefaultFiller.position.set(395 * s, bannerOffsetY - 5 * s);
    this.heartDefaultFiller.scale.set(textureScale);

    this.heartFiller.position.set(395 * s, bannerOffsetY - 5 * s);
    this.heartFiller.scale.set(textureScale);

    const heartHeight = 41;
    const hpPercentage = 0.54;
    const visibleHeight = heartHeight * hpPercentage;
    const maskStartY = bannerOffsetY - 5 * s + (heartHeight - visibleHeight) * s;

    this.heartFillerMask.clear();
    this.heartFillerMask.rect(395 * s, maskStartY, 44 * s, visibleHeight * s);
    this.heartFillerMask.fill({ color: 0xffffff });

    this.heart.position.set(395 * s, bannerOffsetY - 5 * s);
    this.heart.scale.set(textureScale);

    this.bannerContainer.position.set(464 * s, bannerOffsetY + 50 * s);
    this.bannerContainer.scale.set(textureScale);

    const cellHeight = this.manifest.container.background.height / this.manifest.scale;
    const cellSpacingX = 28;
    const cellSpacingY = 29;
    const containerHeight = 64;
    const gridHeight = cellSpacingY + cellHeight;
    const paddingY = (containerHeight - gridHeight) / 2;
    const shortcutsStartX = 518.35;
    const shortcutsStartY = 50 + paddingY;

    updateShortcutGridPositions(
      this.shortcutCells,
      this.shortcutsContainer,
      shortcutsStartX,
      shortcutsStartY,
      cellSpacingX,
      cellSpacingY,
      textureScale,
      s,
      bannerOffsetY
    );

    updateChatPositions(
      this.chatUI,
      s,
      bannerOffsetY,
      textureScale,
      iconTextureScale,
      this.emotesPopup,
      () => this.draw()
    );
  }

  private expandMinimap(): void {
    if (!this.loaded) {
      return;
    }

    const s = this.currentZoom;
    const bannerOffsetY = Math.floor(this.displayHeight * this.currentZoom);
    const xpCircleCenterX = 417 * s;
    const xpCircleCenterY = bannerOffsetY + 65.4 * s;
    const minimapScale = (CIRCLE_INNER_CONTENT_RADIUS * 2 * s) / 742;

    const heartStartY = bannerOffsetY - 5 * s;
    const heartEndY = bannerOffsetY - 35 * s;
    const heartDelta = heartEndY - heartStartY;

    this.xpCircle.expand((currentRadius) => {
      const scaledRadius = currentRadius * s;

      const maskScale = scaledRadius / MASK_VISIBLE_RADIUS;
      this.minimapMask.position.set(xpCircleCenterX, xpCircleCenterY);
      this.minimapMask.scale.set(maskScale);

      this.minimapHitArea.clear();
      this.minimapHitArea.circle(xpCircleCenterX, xpCircleCenterY, scaledRadius);
      this.minimapHitArea.fill({ color: 0x000000, alpha: 0 });

      this.minimapContainer.scale.set(minimapScale);

      const progress =
        (currentRadius - CIRCLE_INNER_CONTENT_RADIUS) /
        (CIRCLE_FILLABLE_OUTER_RADIUS - CIRCLE_INNER_CONTENT_RADIUS);

      const currentHeartY = heartStartY + heartDelta * progress;

      this.heart.y = currentHeartY;
      this.heartDefaultFiller.y = currentHeartY;
      this.heartFiller.y = currentHeartY;
    });
  }

  private collapseMinimap(): void {
    if (!this.loaded) {
      return;
    }

    const s = this.currentZoom;
    const bannerOffsetY = Math.floor(this.displayHeight * this.currentZoom);
    const xpCircleCenterX = 417 * s;
    const xpCircleCenterY = bannerOffsetY + 65.4 * s;
    const minimapScale = (CIRCLE_INNER_CONTENT_RADIUS * 2 * s) / 742;

    const heartStartY = bannerOffsetY - 35 * s;
    const heartEndY = bannerOffsetY - 5 * s;
    const heartDelta = heartEndY - heartStartY;

    this.xpCircle.collapse((currentRadius) => {
      const scaledRadius = currentRadius * s;

      const maskScale = scaledRadius / MASK_VISIBLE_RADIUS;
      this.minimapMask.position.set(xpCircleCenterX, xpCircleCenterY);
      this.minimapMask.scale.set(maskScale);

      this.minimapHitArea.clear();
      this.minimapHitArea.circle(xpCircleCenterX, xpCircleCenterY, scaledRadius);
      this.minimapHitArea.fill({ color: 0x000000, alpha: 0 });

      this.minimapContainer.scale.set(minimapScale);

      const progress =
        (CIRCLE_FILLABLE_OUTER_RADIUS - currentRadius) /
        (CIRCLE_FILLABLE_OUTER_RADIUS - CIRCLE_INNER_CONTENT_RADIUS);

      const currentHeartY = heartStartY + heartDelta * progress;

      this.heart.y = currentHeartY;
      this.heartDefaultFiller.y = currentHeartY;
      this.heartFiller.y = currentHeartY;
    });
  }

  public getGraphics(): Container {
    return this.container;
  }

  public destroy(): void {
    if (this.minimapRenderer) {
      this.minimapRenderer.destroy();
    }

    if (this.loaded) {
      this.xpCircle.container.destroy({ children: true });
      this.heart.destroy({ texture: false });
      this.heartDefaultFiller.destroy({ texture: false });
      this.heartFiller.destroy({ texture: false });
      this.bannerContainer.destroy({ texture: false });
      this.emotesPopup.destroy({ texture: false });

      for (const { button: iconButton } of this.iconButtons) {
        iconButton.container.destroy({ children: true });
      }

      for (const cell of this.shortcutCells) {
        cell.container.destroy({ children: true });
      }

      this.shortcutsContainer.destroy({ children: true });
      this.chatUI.container.destroy({ children: true });
    }

    this.container.destroy({ children: true });
  }
}
