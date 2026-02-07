import { Container, Graphics, Sprite, Texture } from 'pixi.js';
// import { Input } from '@pixi/ui'; // TODO: Re-enable when @pixi/ui is compatible with latest pixi.js
import type { ChatButton, ChatFilter } from '@/types/banner';
import { CHAT_FILTER_CONFIGS } from '@/types/banner';

export function createChatButton(
  iconTexture: Texture,
  hoverIconTexture?: Texture
): ChatButton {
  const container = new Container();

  const icon = new Sprite(iconTexture);
  container.addChild(icon);

  let hoverIcon: Sprite | undefined;

  if (hoverIconTexture) {
    hoverIcon = new Sprite(hoverIconTexture);
    hoverIcon.visible = false;
    container.addChild(hoverIcon);
  }

  container.eventMode = 'static';
  container.cursor = 'pointer';

  const chatButton: ChatButton = {
    container,
    icon,
    hoverIcon,
    isPressed: false,
  };

  container.on('pointerover', () => {
    if (!hoverIcon) {
      return;
    }

    icon.visible = false;
    hoverIcon.visible = true;
  });

  container.on('pointerout', () => {
    if (!hoverIcon) {
      return;
    }

    icon.visible = true;
    hoverIcon.visible = false;
  });

  container.on('pointerdown', () => {
    chatButton.isPressed = !chatButton.isPressed;
  });

  return chatButton;
}

export function createChatFilter(color: number): ChatFilter {
  const container = new Container();

  const background = new Graphics();
  background.rect(0, 0, 12, 12);
  background.stroke({ color: 0xcccccc, width: 1 });
  background.rect(1, 1, 10, 10);
  background.fill({ color });
  container.addChild(background);

  const checkmark = new Graphics();
  checkmark.moveTo(2, 6);
  checkmark.lineTo(5, 9);
  checkmark.lineTo(10, 3);
  checkmark.stroke({ color: 0xffffff, width: 2 });
  container.addChild(checkmark);

  container.eventMode = 'static';
  container.cursor = 'pointer';

  const filter: ChatFilter = {
    container,
    background,
    checkmark,
    isActive: true,
  };

  container.on('pointerdown', () => {
    filter.isActive = !filter.isActive;
    checkmark.visible = filter.isActive;
  });

  return filter;
}

export function createAllChatFilters(): ChatFilter[] {
  return CHAT_FILTER_CONFIGS.map((config) => createChatFilter(config.color));
}

// TODO: Re-enable Input when @pixi/ui is compatible with latest pixi.js
export function createChatInput(): Container {
  const container = new Container();

  const inputBg = new Graphics();
  inputBg.rect(0, 0, 430, 21);
  inputBg.fill({ color: 0xffffff });
  container.addChild(inputBg);

  return container;
}

export interface ChatUI {
  container: Container;
  input: Container; // TODO: Change back to Input when @pixi/ui is compatible
  expandButton: ChatButton;
  emotesButton: ChatButton;
  sitButton: ChatButton;
  filters: ChatFilter[];
  textBackground: Graphics;
  isExpanded: boolean;
}

export interface ChatIconTextures {
  expand: Texture;
  emotes: Texture;
  emotesHover: Texture;
  sit: Texture;
  sitHover: Texture;
}

export function createChatUI(
  emotesPopup: Sprite,
  iconTextures: ChatIconTextures
): ChatUI {
  const container = new Container();

  const textBackground = new Graphics();
  container.addChild(textBackground);

  const input = createChatInput();
  container.addChild(input);

  const expandButton = createChatButton(iconTextures.expand);
  container.addChild(expandButton.container);

  const emotesButton = createChatButton(iconTextures.emotes, iconTextures.emotesHover);
  container.addChild(emotesButton.container);

  const sitButton = createChatButton(iconTextures.sit, iconTextures.sitHover);
  container.addChild(sitButton.container);

  const filters = createAllChatFilters();

  for (const filter of filters) {
    container.addChild(filter.container);
  }

  emotesPopup.visible = false;
  container.addChild(emotesPopup);

  return {
    container,
    input,
    expandButton,
    emotesButton,
    sitButton,
    filters,
    textBackground,
    isExpanded: false,
  };
}

export function updateChatPositions(
  chatUI: ChatUI,
  zoom: number,
  bannerOffsetY: number,
  textureScale: number,
  iconTextureScale: number,
  emotesPopup: Sprite,
  onExpandToggle: () => void
): void {
  const chatButtonScale = iconTextureScale;

  chatUI.container.position.set(0, bannerOffsetY);

  chatUI.textBackground.clear();
  chatUI.textBackground.rect(0, 0, 420 * zoom, 6 * zoom);
  chatUI.textBackground.fill({ color: 0xffffff });
  chatUI.textBackground.rect(0, 6 * zoom, 415 * zoom, 10 * zoom);
  chatUI.textBackground.fill({ color: 0x8c8368 });

  chatUI.input.position.set(0, 104 * zoom);
  chatUI.input.scale.set(zoom);

  chatUI.expandButton.icon.scale.set(chatButtonScale);
  chatUI.expandButton.container.position.set(0, 0);

  chatUI.emotesButton.icon.scale.set(chatButtonScale);

  if (chatUI.emotesButton.hoverIcon) {
    chatUI.emotesButton.hoverIcon.scale.set(chatButtonScale);
  }

  chatUI.emotesButton.container.position.set(19 * zoom, 0);

  chatUI.sitButton.icon.scale.set(chatButtonScale);

  if (chatUI.sitButton.hoverIcon) {
    chatUI.sitButton.hoverIcon.scale.set(chatButtonScale);
  }

  chatUI.sitButton.container.position.set(41 * zoom, 0.05 * zoom);

  const filterStartX = 238;
  const filterSpacing = 14;
  const filterY = 10;

  for (let i = 0; i < chatUI.filters.length; i++) {
    const filter = chatUI.filters[i];

    filter.container.scale.set(zoom);
    filter.container.position.set(
      (filterStartX + i * filterSpacing) * zoom,
      filterY * zoom
    );
  }

  emotesPopup.position.set(19 * zoom, -67 * zoom);
  emotesPopup.scale.set(textureScale);
}
