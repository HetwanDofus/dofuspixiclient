import { BitmapText, Container, Graphics } from 'pixi.js';

export type BannerCircleProps = {
    outerLayerContent?: Graphics | Container,
    innerLayerContent?: Graphics | Container,
    fillableCircleValue?: number;
    fiillableCircleValueTooltip?: string;
    scale?: number;
}

export const CIRCLE_OUTER_RADIUS = 60;
export const CIRCLE_FILLABLE_OUTER_RADIUS = 56;
export const CIRCLE_INNER_WHITE_RADIUS = 40;
export const CIRCLE_INNER_CONTENT_RADIUS = 37;
export const CIRCLE_EXPANDED_RADIUS = 56;

export type BannerCircle = {
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
    fiillableCircleValueTooltip,
    scale = 1
}: BannerCircleProps): BannerCircle {
  const container = new Container();
  const graphics = new Graphics();
  container.addChild(graphics);

  const centerX = 0;
  const centerY = 0;
  let currentScale = scale;

  // Function to draw static elements
  const drawStaticElements = (s: number) => {
    graphics.clear();

    const circleRadius = CIRCLE_OUTER_RADIUS * s;
    const ellipseRadiusX = 65 * s;
    const ellipseRadiusY = CIRCLE_OUTER_RADIUS * s;

    // Draw outer ellipse (black at 20% opacity)
    graphics.ellipse(centerX, centerY, ellipseRadiusX, ellipseRadiusY);
    graphics.fill({ color: 0x000000, alpha: 0.2 });

    // Draw outer white circle (radius 60)
    graphics.circle(centerX, centerY, circleRadius);
    graphics.fill({ color: 0xffffff, alpha: 1.0 });

    // If outerLayerContent is provided, use it instead of the default dark brown circle
    if (outerLayerContent) {
      outerLayerContent.position.set(centerX, centerY);
      outerLayerContent.scale.set(s);
    } else {
      // Draw dark brown circle
      graphics.circle(centerX, centerY, CIRCLE_FILLABLE_OUTER_RADIUS * s);
      graphics.fill({ color: 0x514a3c, alpha: 1.0 });
    }

    // Draw inner white circle
    graphics.circle(centerX, centerY, CIRCLE_INNER_WHITE_RADIUS * s);
    graphics.fill({ color: 0xffffff, alpha: 1.0 });

    // Draw inner dark navy circle if no custom content
    if (!innerLayerContent) {
      graphics.circle(centerX, centerY, CIRCLE_INNER_CONTENT_RADIUS * s);
      graphics.fill({ color: 0x202f3e, alpha: 1.0 });
    }
  };

  // Add outerLayerContent if provided
  if (outerLayerContent) {
    outerLayerContent.position.set(centerX, centerY);
    container.addChild(outerLayerContent);
  }

  // Initial draw
  drawStaticElements(scale);

  // Draw division lines and fillable sections between first and second white circles (8 sections)
  const divisions = 8;
  const angleStep = (Math.PI * 2) / divisions;

  // Create fillable graphics layer (will be updated dynamically)
  const fillableGraphics = new Graphics();
  container.addChild(fillableGraphics);

  // Function to draw fillable sections
  const drawFillableSections = (value: number, targetRadius: number, s: number) => {
    fillableGraphics.clear();

    if (value > 0) {
      const innerRadius = CIRCLE_INNER_WHITE_RADIUS * s;
      const scaledTargetRadius = targetRadius * s;

      const fillPercentage = Math.max(0, Math.min(100, value)) / 100;
      const filledDivisions = Math.ceil(fillPercentage * divisions);

      for (let i = 0; i < filledDivisions; i++) {
        const startAngle = i * angleStep - Math.PI / 2; // Start from top
        const endAngle = startAngle + angleStep;

        // Draw filled arc segment as a ring sector
        // Start at inner radius
        fillableGraphics.moveTo(
          centerX + Math.cos(startAngle) * innerRadius,
          centerY + Math.sin(startAngle) * innerRadius
        );
        // Arc along target outer radius (changes when expanded)
        fillableGraphics.arc(centerX, centerY, scaledTargetRadius, startAngle, endAngle);
        // Line back to inner radius
        fillableGraphics.lineTo(
          centerX + Math.cos(endAngle) * innerRadius,
          centerY + Math.sin(endAngle) * innerRadius
        );
        // Arc back along inner radius (reverse direction)
        fillableGraphics.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
        // Close the path
        fillableGraphics.closePath();
        fillableGraphics.fill({ color: 0x7D9EA4, alpha: 1 }); // Xp fill
      }
    }
  };

  // Create division lines graphics layer (rendered on top of fillable sections)
  const divisionLinesGraphics = new Graphics();

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

  // Add division lines after fillable graphics to render on top
  container.addChild(divisionLinesGraphics);

  // Initial draw
  drawDivisionLines(scale);
  if (fillableCircleValue !== undefined) {
    drawFillableSections(fillableCircleValue, CIRCLE_FILLABLE_OUTER_RADIUS, scale);
  }

  // If innerLayerContent is provided, add it
  if (innerLayerContent) {
    innerLayerContent.position.set(centerX, centerY);
    container.addChild(innerLayerContent);
  }

  // Create interactive hit area for tooltip (ring between inner and outer white circles)
  // Added AFTER innerLayerContent to have higher z-index
  let hitArea: Graphics | null = null;
  let tooltipContainer: Container | null = null;

  const updateTooltipHitArea = (s: number) => {
    if (fiillableCircleValueTooltip && hitArea) {
      const innerRadius = CIRCLE_INNER_WHITE_RADIUS * s;
      const outerRadius = CIRCLE_OUTER_RADIUS * s;

      hitArea.clear();
      hitArea.circle(centerX, centerY, outerRadius);
      hitArea.circle(centerX, centerY, innerRadius);
      hitArea.fill({ color: 0x000000, alpha: 0 });
    }
  };

  if (fiillableCircleValueTooltip) {
    hitArea = new Graphics();
    updateTooltipHitArea(scale);

    hitArea.eventMode = 'static';
    hitArea.cursor = 'pointer';
    container.addChild(hitArea);

    // Create tooltip container
    tooltipContainer = new Container();
    tooltipContainer.visible = false;
    container.addChild(tooltipContainer);

    // Create tooltip background
    const tooltipBg = new Graphics();
    tooltipContainer.addChild(tooltipBg);

    const tooltipText = new BitmapText({
      text: fiillableCircleValueTooltip,
      style: {
        fontFamily: 'bitmini6',
        fontSize: 8,
      }
    });
    tooltipText.anchor.set(0.5, 0.5);
    tooltipContainer.addChild(tooltipText);

    // Draw background box based on text size
    const padding = 2;
    const bgWidth = tooltipText.width + padding * 2;
    const bgHeight = tooltipText.height + padding * 2;
    tooltipBg.rect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);
    tooltipBg.fill({ color: 0x000000, alpha: 0.5 });

    // Setup hover events
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

  // Animation state
  let isExpanded = false;
  let isAnimating = false;
  let currentFillableValue = fillableCircleValue ?? 0;

  // Expand animation
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
      const eased = 1 - (1 - progress) ** 3; // Ease out cubic

      const currentRadius = startRadius + (endRadius - startRadius) * eased;

      onUpdate(currentRadius);

      // Update fillable sections to expand to outer circle when expanded
      if (currentFillableValue > 0) {
        const fillTargetRadius = CIRCLE_FILLABLE_OUTER_RADIUS + (CIRCLE_OUTER_RADIUS - CIRCLE_FILLABLE_OUTER_RADIUS) * eased;

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

  // Collapse animation
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

      // Update fillable sections to collapse back to fillable radius
      if (currentFillableValue > 0) {
        const fillTargetRadius = CIRCLE_OUTER_RADIUS - (CIRCLE_OUTER_RADIUS - CIRCLE_FILLABLE_OUTER_RADIUS) * eased;
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

  // Set fillable value dynamically
  const setFillableValue = (value: number) => {
    currentFillableValue = value;
    const targetRadius = isExpanded ? CIRCLE_OUTER_RADIUS : CIRCLE_FILLABLE_OUTER_RADIUS;

    drawFillableSections(value, targetRadius, currentScale);
  };

  // Redraw everything at a new scale
  const redraw = (s: number) => {
    currentScale = s;

    drawStaticElements(s);
    drawDivisionLines(s);
    updateTooltipHitArea(s);

    const targetRadius = isExpanded ? CIRCLE_OUTER_RADIUS : CIRCLE_FILLABLE_OUTER_RADIUS;

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
