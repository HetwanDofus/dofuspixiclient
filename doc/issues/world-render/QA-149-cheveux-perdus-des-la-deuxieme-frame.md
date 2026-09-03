---
id: QA-149
title: Les cheveux du Iop disparaissent dès la deuxième frame d'animation
severity: P2
domain: world-render
type: bug
status: fixed
session: 7
opened: 2026-09-03
closed:
fixed_in:
related: [QA-148]
files:
  - tools/assets-exporter/src/Swf/BodyPartVariantModifier.php
  - tools/assets-exporter/src/Command/ExtractSpriteCommand.php
  - apps/electrobun/public/assets/spritesheets/sprites/80.dofasset
---

## Symptôme

`dev2` (Iop mâle, gfx 80) porte sa crête orange à l'arrêt. Dès qu'il s'anime
— marche comme fauchage — la crête disparaît et la tête passe à une coupe
courte. Le retour à `static` la fait réapparaître.

Visible sur la planche publiée : `walkR` frame 0 utilise la tête `d51`
(cheveux longs), frames 1 à 12 la tête `d77` (cheveux courts). Idem sur
`anim17R` et sur toutes les animations à plusieurs frames.

## Attendu (1.29)

Sans chapeau, la tête reste sur sa première frame pendant toute l'animation.
La deuxième frame est la variante « coupe courte », celle sur laquelle
`GAC.applyAccessory(this, 1, "R_tete", _parent)` fait sauter la tête quand un
chapeau est effectivement posé — c'est à ça que sert le quatrième argument.

## Cause

Une pièce de corps d'un sprite de classe est une image fixe : la pose vit sur
la timeline interne de l'animation, chaque pièce y est placée avec sa matrice
et n'a qu'une frame. Celles qui en ont plusieurs ne s'animent pas, ce sont des
variantes que l'ActionScript choisit — et la seule des SWF de classe est la
tête (`sprite 63` pour gfx 80, un exemplaire par direction : 63, 135, 305,
352, 379).

Rien ne rejoue cet ActionScript à l'extraction, et `Converter::toSvg` rend
chaque clip imbriqué à l'index de frame du parent. À partir de la frame 1 de
n'importe quelle animation, la tête était donc rendue sur sa frame 2.

Le contournement historique `applyHairToggle`
(`tools/svg-spritesheet/src/cli.ts`) réinjectait la chevelure de la frame 0
dans les autres frames, mais n'y copiait que la sous-définition la plus
différente (`d50`) et non le groupe de tête complet (`d51` = `d46 + d47 + d49
+ d50`) : la crête réapparaissait en contour sans aplats, donc invisible. Ce
chemin est de toute façon mort — la compilation actuelle lit les SVG par
frame et ne passe plus par `svg-spritesheet`.

## Correctif

`BodyPartVariantModifier` épingle sur sa première frame toute pièce imbriquée
qui a plusieurs frames **et** appelle `GAC.applyColor` — ce qui la désigne
comme pièce dessinée et teintée. Les ancrages d'accessoires (5, 9, 16, 28
frames, une par étiquette de direction) et les vrais sous-clips animés (le
flash de dégât, l'étoile de niveau) n'appellent pas `applyColor` et gardent
toutes leurs frames.

Appliqué dans `ExtractSpriteCommand` avant la lecture de la timeline, donc à
toutes les planches.

## Vérification

Rendu direct du binaire compilé, avant / après :

```bash
dofasset-renderer apps/electrobun/public/assets/spritesheets/sprites/80.dofasset \
  --animation walkR --frame 3 --resolution 4 --output walk3.png
```

La crête orange est présente sur `walkR` frame 3 et sur `anim17R` frame 6.

À rejouer en jeu : `dev2/dev2`, marcher puis faucher — la coupe ne doit plus
changer.
