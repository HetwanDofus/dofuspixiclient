import type { Sprite, Container } from 'pixi.js';

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function animateSprite(
  sprite: Sprite,
  targetX: number,
  targetY: number,
  duration: number,
  targetRotation = 0,
  onComplete?: () => void
): void {
  const startX = sprite.x;
  const startY = sprite.y;
  const startRotation = sprite.rotation;
  const targetRotationRad = (targetRotation * Math.PI) / 180;
  const startTime = performance.now();

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);

    sprite.x = startX + (targetX - startX) * eased;
    sprite.y = startY + (targetY - startY) * eased;
    sprite.rotation = startRotation + (targetRotationRad - startRotation) * eased;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onComplete?.();
    }
  };

  requestAnimationFrame(animate);
}

export function animateTileSurface(
  sprite: Sprite,
  targetY: number,
  duration = 200,
  checkVisible?: () => boolean
): void {
  const startY = sprite.y;
  const startTime = performance.now();

  const animate = (currentTime: number) => {
    if (checkVisible && !checkVisible()) {
      sprite.y = targetY;
      sprite.alpha = 1;
      return;
    }

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);

    sprite.y = startY + (targetY - startY) * eased;
    sprite.alpha = eased;

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };

  requestAnimationFrame(animate);
}

export function animateAlpha(
  target: Container,
  targetAlpha: number,
  duration: number,
  onComplete?: () => void
): void {
  const startAlpha = target.alpha;
  const startTime = performance.now();

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);

    target.alpha = startAlpha + (targetAlpha - startAlpha) * eased;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onComplete?.();
    }
  };

  requestAnimationFrame(animate);
}
