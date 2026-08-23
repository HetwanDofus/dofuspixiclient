---
id: QA-041
title: Un atlas GPU de 512 Mo est réalloué à chaque changement de zoom, et jamais utilisé
severity: P1
domain: camera-zoom
type: bug
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-025, QA-039]
files: [apps/electrobun/src/game/assets/character-sprite.ts:275]
---

## Symptôme

Relevé littéral de la console pendant la session :

```
[FrameAtlas] 16384x8192 atlas, slot=512,  512 slots, res=3.26
[FrameAtlas] 16384x8192 atlas, slot=1024, 128 slots, res=4.89
[FrameAtlas] 16384x8192 atlas, slot=1024, 128 slots, res=6.53
[FrameAtlas] 16384x8192 atlas, slot=1024, 128 slots, res=4.89
[FrameAtlas] 16384x8192 atlas, slot=512,  512 slots, res=3.26
[FrameAtlas] 16384x8192 atlas, slot=256, 2048 slots, res=1.63
```

Six textures 16384×8192 RGBA8 — 512 Mo de taille logique chacune — créées en
quelques crans de molette.

## Cause

`CharacterSpriteLoader.setZoom` en instancie une nouvelle sans libérer la
précédente, et `VelloRenderer::free_texture` n'est appelé nulle part dans le
client.

Pire : **l'atlas ne sert à rien.** Le compteur de l'overlay reste à `r:0 h:0`
(zéro rastérisation, zéro hit) pendant toute la session, parce que le rendu des
personnages passe en réalité par `renderAnimationStrip` ; `FrameAtlas.getFrame`
n'a aucun appelant. Seuls `tick()` et `flush()` sont appelés, à chaque frame,
sur une file toujours vide.

À noter aussi la dégradation de capacité : `2048` slots à zoom 1, `128` à
zoom 5, puisque la taille de slot passe de 256 à 1024 px.
