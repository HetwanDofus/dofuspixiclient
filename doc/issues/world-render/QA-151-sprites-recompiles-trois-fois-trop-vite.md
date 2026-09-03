---
id: QA-151
title: Un sprite recompilé joue toutes ses animations trois fois trop vite
severity: P1
domain: world-render
type: bug
status: fixed
session: 7
opened: 2026-09-03
closed:
fixed_in:
related: [QA-148, QA-149]
files:
  - tools/asset-pipeline/src/stages/compile/sprites.ts
  - tools/asset-pipeline/src/stages/extract/manifest-bounds.ts
---

## Symptôme

Après le premier passage de `pipeline compile sprites --id 80` (fait pour
QA-148 / QA-149), la marche du Iop est saccadée et l'animation de fauchage se
répète beaucoup trop vite. Le contenu des frames est correct — la faux et les
cheveux sont là.

Relevé sur les deux binaires :

| animation | publié avant | recompilé |
|---|---|---|
| `walkR`   | 39 frames @ 60 fps → 0,650 s | 13 frames @ 60 fps → 0,217 s |
| `anim17R` | 45 frames @ 60 fps → 0,750 s | 15 frames @ 60 fps → 0,250 s |
| `dieR`    | 60 frames @ 60 fps → 1,000 s | 20 frames @ 60 fps → 0,333 s |

Exactement trois fois trop vite, sur les 124 animations.

## Cause

Le SWF tourne à **20 fps** et `walkR` y compte 13 `ShowFrame` — c'est ce que
`sprites:extract` publie, une image par frame. L'étage `atlas`, retiré depuis,
rééchantillonnait cette liste à 60 fps en écrivant chaque image trois fois :
39 images à 60 fps, la même durée.

`compileSprites` compile désormais les SVG par frame sans passer par cet
étage, mais gardait le `fps: opts.fps ?? 60` hérité de la sortie de l'atlas —
un 60 posé sur une liste non rééchantillonnée. Le défaut était latent : aucune
planche de classe n'avait été recompilée depuis le retrait de l'étage `atlas`,
donc toutes celles publiées venaient encore de l'ancien chemin.

## Correctif

Estampiller la cadence propre du SWF, que `ExtractSpriteCommand::saveManifest`
écrit déjà par sprite (`fps`) et que `loadFlashBoundsManifest` expose
maintenant. Le repli sur 60 subsiste pour un manifeste antérieur au champ,
mais il journalise un avertissement — il n'est juste que pour une liste
rééchantillonnée.

## Vérification

Durée par animation, ancien binaire contre recompilé :

```
walkR      39@60    0.650 |    13@20    0.650
runR       30@60    0.500 |    10@20    0.500
anim17R    45@60    0.750 |    15@20    0.750
dieR       60@60    1.000 |    20@20    1.000
```

À rejouer en jeu : marcher, courir, faucher — la cadence doit être celle
d'avant la recompilation.
