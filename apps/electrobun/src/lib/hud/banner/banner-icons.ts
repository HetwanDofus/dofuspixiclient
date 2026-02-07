import { Container, Sprite, Texture } from 'pixi.js';
import type { AssetEntry, BannerManifest, IconButtonWithOffset } from '@/types/banner';
import { BANNER_ASSETS_PATH, ICON_BUTTON_CONFIGS } from '@/types/banner';

export function createIconButton(
  iconTexture: Texture,
  iconData: AssetEntry,
  manifest: BannerManifest,
  buttonUpTexture: Texture,
  buttonDownTexture: Texture
): IconButtonWithOffset {
  const container = new Container();

  const button = new Sprite(buttonUpTexture);
  button.anchor.set(0.5, 0.5);
  container.addChild(button);

  const icon = new Sprite(iconTexture);
  icon.anchor.set(0.5, 0.5);
  container.addChild(icon);

  const baseOffsetX = (iconData.width / 2 + iconData.offsetX) / manifest.iconScale;
  const baseOffsetY = (iconData.height / 2 + iconData.offsetY) / manifest.iconScale;

  container.eventMode = 'static';
  container.cursor = 'pointer';

  const iconButton: IconButtonWithOffset = {
    container,
    button,
    icon,
    isPressed: false,
    baseOffsetX,
    baseOffsetY,
    currentZoom: 1,
  };

  container.on('pointerdown', () => {
    iconButton.isPressed = !iconButton.isPressed;

    if (iconButton.isPressed) {
      button.texture = buttonDownTexture;
    } else {
      button.texture = buttonUpTexture;
    }

    // Flash shifts icon by +0.5px when pressed (Button.as lines 41-44)
    const pressedShift = iconButton.isPressed ? 0.5 : 0;
    const zoom = iconButton.currentZoom;

    icon.position.set(
      (baseOffsetX + pressedShift) * zoom,
      (baseOffsetY + pressedShift) * zoom
    );
  });

  return iconButton;
}

export function createAllIconButtons(
  manifest: BannerManifest,
  buttonUpTexture: Texture,
  buttonDownTexture: Texture,
  getIconTexture: (path: string) => Texture
): Array<{ button: IconButtonWithOffset; relativeX: number }> {
  const buttons: Array<{ button: IconButtonWithOffset; relativeX: number }> = [];

  for (const config of ICON_BUTTON_CONFIGS) {
    const iconData = manifest.icons[config.key];
    const iconPath = `${BANNER_ASSETS_PATH}/${iconData.file}`;

    const iconButton = createIconButton(
      getIconTexture(iconPath),
      iconData,
      manifest,
      buttonUpTexture,
      buttonDownTexture
    );

    buttons.push({ button: iconButton, relativeX: config.x });
  }

  return buttons;
}

export function updateIconButtonPosition(
  iconButton: IconButtonWithOffset,
  relativeX: number,
  buttonCenterOffsetX: number,
  buttonCenterY: number,
  textureScale: number,
  zoom: number
): void {
  iconButton.button.scale.set(textureScale);
  iconButton.icon.scale.set(textureScale);

  // Store zoom for use in click handler
  iconButton.currentZoom = zoom;

  let pressedShift = 0;
  if (iconButton.isPressed) {
    pressedShift = 0.5;
  }

  iconButton.icon.position.set(
    (iconButton.baseOffsetX + pressedShift) * zoom,
    (iconButton.baseOffsetY + pressedShift) * zoom
  );

  iconButton.container.position.set(
    (relativeX + buttonCenterOffsetX) * zoom,
    buttonCenterY * zoom
  );
}
