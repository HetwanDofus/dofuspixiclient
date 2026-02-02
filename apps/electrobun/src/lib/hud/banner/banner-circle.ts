import { BitmapText, Container, Graphics, Sprite, Texture } from 'pixi.js';

const TEXTURE_SIZE = 256;
const FEATHER_SIZE = 2;
const VISIBLE_RADIUS = TEXTURE_SIZE / 2 - FEATHER_SIZE;

function createSoftCircleTexture(color: number, alpha: number = 1): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  const centerX = TEXTURE_SIZE / 2;
  const centerY = TEXTURE_SIZE / 2;
  const radius = TEXTURE_SIZE / 2 - FEATHER_SIZE;

  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  const gradient = ctx.createRadialGradient(
    centerX,
    centerY,
    radius - FEATHER_SIZE,
    centerX,
    centerY,
    radius + FEATHER_SIZE
  );

  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + FEATHER_SIZE, 0, Math.PI * 2);
  ctx.fill();

  return Texture.from(canvas);
}

export interface BannerCircleProps {
  outerLayerContent?: Graphics | Container;
  innerLayerContent?: Graphics | Container;
  fillableCircleValue?: number;
  fillableCircleValueTooltip?: string;
  scale?: number;
}

export const CIRCLE_OUTER_RADIUS = 60;
export const CIRCLE_FILLABLE_OUTER_RADIUS = 56;
export const CIRCLE_INNER_WHITE_RADIUS = 40;
export const CIRCLE_INNER_CONTENT_RADIUS = 37;
export const CIRCLE_EXPANDED_RADIUS = 56;

export interface BannerCircle {
  container: Container;
  expand: (onUpdate: (radius: number) => void) => void;
  collapse: (onUpdate: (radius: number) => void) => void;
  isExpanded: () => boolean;
  isAnimating: () => boolean;
  setFillableValue: (value: number) => void;
  redraw: (scale: number) => void;
}

export function createBannerCircle({
  outerLayerContent,
  innerLayerContent,
  fillableCircleValue,
  fillableCircleValueTooltip,
  scale = 1,
}: BannerCircleProps): BannerCircle {
  const container = new Container();

  const whiteTexture = createSoftCircleTexture(0xffffff);
  const shadowTexture = createSoftCircleTexture(0x000000, 0.2);
  const brownTexture = createSoftCircleTexture(0x514a3c);
  const darkBlueTexture = createSoftCircleTexture(0x202f3e);

  const shadowSprite = new Sprite(shadowTexture);
  shadowSprite.anchor.set(0.5, 0.5);
  container.addChild(shadowSprite);

  const outerWhiteSprite = new Sprite(whiteTexture);
  outerWhiteSprite.anchor.set(0.5, 0.5);
  container.addChild(outerWhiteSprite);

  let brownSprite: Sprite | null = null;
  if (!outerLayerContent) {
    brownSprite = new Sprite(brownTexture);
    brownSprite.anchor.set(0.5, 0.5);
    container.addChild(brownSprite);
  }

  const innerWhiteSprite = new Sprite(whiteTexture);
  innerWhiteSprite.anchor.set(0.5, 0.5);
  container.addChild(innerWhiteSprite);

  let innerDarkSprite: Sprite | null = null;
  if (!innerLayerContent) {
    innerDarkSprite = new Sprite(darkBlueTexture);
    innerDarkSprite.anchor.set(0.5, 0.5);
    container.addChild(innerDarkSprite);
  }

  const centerX = 0;
  const centerY = 0;
  let currentScale = scale;

  const textureToScreenScale = (radius: number, s: number) => {
    return (radius * s) / VISIBLE_RADIUS;
  };

  const drawStaticElements = (s: number) => {
    const shadowScaleX = textureToScreenScale(65, s);
    const shadowScaleY = textureToScreenScale(CIRCLE_OUTER_RADIUS, s);
    shadowSprite.scale.set(shadowScaleX, shadowScaleY);

    const outerScale = textureToScreenScale(CIRCLE_OUTER_RADIUS, s);
    outerWhiteSprite.scale.set(outerScale);

    if (brownSprite) {
      const brownScale = textureToScreenScale(CIRCLE_FILLABLE_OUTER_RADIUS, s);
      brownSprite.scale.set(brownScale);
    }

    const innerWhiteScale = textureToScreenScale(CIRCLE_INNER_WHITE_RADIUS, s);
    innerWhiteSprite.scale.set(innerWhiteScale);

    if (innerDarkSprite) {
      const innerDarkScale = textureToScreenScale(CIRCLE_INNER_CONTENT_RADIUS, s);
      innerDarkSprite.scale.set(innerDarkScale);
    }

    if (outerLayerContent) {
      outerLayerContent.position.set(centerX, centerY);
      outerLayerContent.scale.set(s);
    }
  };

  if (outerLayerContent) {
    outerLayerContent.position.set(centerX, centerY);
    container.addChild(outerLayerContent);
  }

  drawStaticElements(scale);

  const divisions = 8;
  const angleStep = (Math.PI * 2) / divisions;

  const fillableGraphics = new Graphics();
  container.addChild(fillableGraphics);

  const drawFillableSections = (value: number, targetRadius: number, s: number) => {
    fillableGraphics.clear();

    if (value <= 0) {
      return;
    }

    const innerRadius = CIRCLE_INNER_WHITE_RADIUS * s;
    const scaledTargetRadius = (targetRadius + 1) * s;

    const fillPercentage = Math.max(0, Math.min(100, value)) / 100;
    const filledDivisions = Math.ceil(fillPercentage * divisions);

    for (let i = 0; i < filledDivisions; i++) {
      const startAngle = i * angleStep - Math.PI / 2;
      const endAngle = startAngle + angleStep;

      fillableGraphics.moveTo(
        centerX + Math.cos(startAngle) * innerRadius,
        centerY + Math.sin(startAngle) * innerRadius
      );

      fillableGraphics.arc(centerX, centerY, scaledTargetRadius, startAngle, endAngle);

      fillableGraphics.lineTo(
        centerX + Math.cos(endAngle) * innerRadius,
        centerY + Math.sin(endAngle) * innerRadius
      );

      fillableGraphics.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);

      fillableGraphics.closePath();
      fillableGraphics.fill({ color: 0x7d9ea4, alpha: 1 });
    }
  };

  const divisionLinesGraphics = new Graphics();
  container.addChild(divisionLinesGraphics);

  const drawDivisionLines = (s: number) => {
    divisionLinesGraphics.clear();

    const innerRadius = CIRCLE_INNER_WHITE_RADIUS * s;
    const outerRadius = CIRCLE_OUTER_RADIUS * s;

    for (let i = 0; i < divisions; i++) {
      const angle = i * angleStep;

      const startX = centerX + Math.cos(angle) * innerRadius;
      const startY = centerY + Math.sin(angle) * innerRadius;
      const endX = centerX + Math.cos(angle) * outerRadius;
      const endY = centerY + Math.sin(angle) * outerRadius;

      divisionLinesGraphics.moveTo(startX, startY);
      divisionLinesGraphics.lineTo(endX, endY);
    }

    divisionLinesGraphics.stroke({ color: 0xffffff, width: s });
  };

  drawDivisionLines(scale);

  if (fillableCircleValue !== undefined) {
    drawFillableSections(fillableCircleValue, CIRCLE_FILLABLE_OUTER_RADIUS, scale);
  }

  if (innerLayerContent) {
    innerLayerContent.position.set(centerX, centerY);
    container.addChild(innerLayerContent);
  }

  let hitArea: Graphics | null = null;
  let tooltipContainer: Container | null = null;

  const updateTooltipHitArea = (s: number) => {
    if (!fillableCircleValueTooltip || !hitArea) {
      return;
    }

    const innerRadius = CIRCLE_INNER_WHITE_RADIUS * s;
    const outerRadius = CIRCLE_OUTER_RADIUS * s;

    hitArea.clear();
    hitArea.circle(centerX, centerY, outerRadius);
    hitArea.circle(centerX, centerY, innerRadius);
    hitArea.fill({ color: 0x000000, alpha: 0 });
  };

  if (fillableCircleValueTooltip) {
    hitArea = new Graphics();
    updateTooltipHitArea(scale);

    hitArea.eventMode = 'static';
    hitArea.cursor = 'pointer';
    container.addChild(hitArea);

    tooltipContainer = new Container();
    tooltipContainer.visible = false;
    container.addChild(tooltipContainer);

    const tooltipBg = new Graphics();
    tooltipContainer.addChild(tooltipBg);

    const tooltipText = new BitmapText({
      text: fillableCircleValueTooltip,
      style: {
        fontFamily: 'bitmini6',
        fontSize: 8,
      },
    });
    tooltipText.anchor.set(0.5, 0.5);
    tooltipContainer.addChild(tooltipText);

    const padding = 2;
    const bgWidth = tooltipText.width + padding * 2;
    const bgHeight = tooltipText.height + padding * 2;

    tooltipBg.rect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);
    tooltipBg.fill({ color: 0x000000, alpha: 0.5 });

    hitArea.on('pointerover', () => {
      if (!tooltipContainer) {
        return;
      }

      tooltipContainer.visible = true;
    });

    hitArea.on('pointerout', () => {
      if (!tooltipContainer) {
        return;
      }

      tooltipContainer.visible = false;
    });

    hitArea.on('pointermove', (event) => {
      if (!tooltipContainer) {
        return;
      }

      const localPos = event.getLocalPosition(container);
      tooltipContainer.position.set(localPos.x, localPos.y - 15);
    });
  }

  let isExpanded = false;
  let isAnimating = false;
  let currentFillableValue = fillableCircleValue ?? 0;

  const expand = (onUpdate: (radius: number) => void) => {
    if (isExpanded || isAnimating) {
      return;
    }

    isExpanded = true;
    isAnimating = true;

    const startRadius = CIRCLE_INNER_CONTENT_RADIUS;
    const endRadius = CIRCLE_EXPANDED_RADIUS;

    const startTime = Date.now();
    const duration = 200;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) ** 3;

      const currentRadius = startRadius + (endRadius - startRadius) * eased;

      onUpdate(currentRadius);

      if (currentFillableValue > 0) {
        const fillTargetRadius =
          CIRCLE_FILLABLE_OUTER_RADIUS +
          (CIRCLE_OUTER_RADIUS - CIRCLE_FILLABLE_OUTER_RADIUS) * eased;

        drawFillableSections(currentFillableValue, fillTargetRadius, currentScale);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        isAnimating = false;
      }
    };

    animate();
  };

  const collapse = (onUpdate: (radius: number) => void) => {
    if (!isExpanded || isAnimating) {
      return;
    }

    isExpanded = false;
    isAnimating = true;

    const startRadius = CIRCLE_EXPANDED_RADIUS;
    const endRadius = CIRCLE_INNER_CONTENT_RADIUS;

    const startTime = Date.now();
    const duration = 200;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) ** 3;

      const currentRadius = startRadius + (endRadius - startRadius) * eased;

      onUpdate(currentRadius);

      if (currentFillableValue > 0) {
        const fillTargetRadius =
          CIRCLE_OUTER_RADIUS -
          (CIRCLE_OUTER_RADIUS - CIRCLE_FILLABLE_OUTER_RADIUS) * eased;

        drawFillableSections(currentFillableValue, fillTargetRadius, currentScale);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        isAnimating = false;
      }
    };

    animate();
  };

  const setFillableValue = (value: number) => {
    currentFillableValue = value;

    let targetRadius = CIRCLE_FILLABLE_OUTER_RADIUS;
    if (isExpanded) {
      targetRadius = CIRCLE_OUTER_RADIUS;
    }

    drawFillableSections(value, targetRadius, currentScale);
  };

  const redraw = (s: number) => {
    currentScale = s;

    drawStaticElements(s);
    drawDivisionLines(s);
    updateTooltipHitArea(s);

    let targetRadius = CIRCLE_FILLABLE_OUTER_RADIUS;
    if (isExpanded) {
      targetRadius = CIRCLE_OUTER_RADIUS;
    }

    if (currentFillableValue > 0) {
      drawFillableSections(currentFillableValue, targetRadius, s);
    }
  };

  return {
    container,
    expand,
    collapse,
    isExpanded: () => isExpanded,
    isAnimating: () => isAnimating,
    setFillableValue,
    redraw,
  };
}
