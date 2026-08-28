---
id: QA-100
title: Les vendeurs d'hôtel de vente sont invisibles — leur sprite ne contient qu'une pièce sur quatorze
severity: P1
domain: world-render
type: bug
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-093, QA-097]
files:
  - tools/assets-exporter/src/Command/ExtractSpriteCommand.php
  - tools/assets-exporter/src/Command/ExtractSpriteMetadataCommand.php
  - apps/electrobun/public/assets/spritesheets/sprites/9073.dofasset
---

## Symptôme

Sur une map d'hôtel de vente, le vendeur n'apparaît pas. Relevé sur la map
**7289** (Astrub), où la base pose deux PNJ : `Leon Edehcub` (gfx 9045,
cellule 400) s'affiche normalement, `Vendeur Bûcheron d'Astrub` (gfx 9073,
cellule 295) ne s'affiche pas.

La donnée n'est pas en cause : les 803 placements de `scripted_npcs`
résolvent tous un `npc_templates`, et les **55 placements de gfx 9073** —
c'est-à-dire *tous* les vendeurs d'hôtel de vente du jeu, plus les deux
milices — sont bien en base et bien envoyés par le serveur.

C'est le sprite publié qui est amputé. En comparant chaque `.dofasset`
publié aux bornes calculées depuis le SWF 1.29 correspondant :

| gfx | placements | animation | dofasset | SWF 1.29 | |
|---|---|---|---|---|---|
| **9073** | **55** | `staticR` | **5,2 × 5,4** | **14,1 × 39,8** | **14 %** |
| 9075 (Berthawa) | 10 | `staticR` | 16,8 × 8,4 | 23,6 × 40,3 | 21 % |
| 9005 (Oshima) | 2 | `staticL` | 20,0 × 10,0 | 18,9 × 47,7 | 21 % |
| 9097 (Garde Montay) | 2 | `staticL_Back` | 17,3 × 8,6 | 46,1 × 80,4 | 11 % |
| 1273 (Bulbig) | 1 | `staticR` | 3,5 × 1,0 | 45,5 × 77,2 | 1 % |
| 1265 (Iturik) | 1 | `staticR` | 4,4 × 1,3 | 37,8 × 35,4 | 4 % |
| 9222 / 9223 (Force Étrange) | 2 | — | *aucun `.dofasset`* | — | — |

Un vendeur mesure donc environ **cinq pixels** au lieu de quarante : à
l'écran c'est un point, et sa boîte de sélection est trop petite pour être
cliquée. Les 158 autres gfx de PNJ posés reproduisent les bornes du SWF au
dixième près (ex. gfx 9024 : 24,6 × 32,2 des deux côtés), donc le pipeline
est correct dans le cas général.

## Attendu (1.29)

Le vendeur d'hôtel de vente est un personnage de taille normale, debout sur
sa cellule. `clips/sprites/sprites.xml` le nomme
`<sprite id="9073" name="vendeur Hotel de vente" />`, et le SWF de retail
donne à son `staticR` des bornes de **14,1 × 39,8 px**, du même ordre que
n'importe quel PNJ humanoïde.

## Cause

`ExtractSpriteMetadataCommand::extractAnimationData`
(`tools/assets-exporter/src/Command/ExtractSpriteMetadataCommand.php:213`) :

```php
$wrapperObj = reset($objects);
$innerSprite = $this->getChildObject($wrapperObj);
```

Le clip exporté d'une animation est *supposé* poser un unique enfant —
l'enveloppe — dont les enfants sont les pièces du corps. `reset($objects)`
prend donc le premier objet posé et descend dedans, sans jamais vérifier
qu'il est bien seul.

C'est vrai pour un sprite sain : `9045/staticR` pose **1** enfant (sprite
77), qui contient 21 pièces, et la métadonnée publiée en liste bien 21.

Ce n'est pas vrai pour 9073 : son `staticR` pose ses **14 pièces
directement**, aux profondeurs 1, 11, 13, 14, 17, 19, 22, 29, 30, 34, 35,
37, 56, 57 — il n'y a pas d'enveloppe. L'extracteur prend la pièce de
profondeur 1 pour l'enveloppe, descend dedans, et publie son unique enfant
comme *la* liste des pièces. La métadonnée livrée le dit noir sur blanc :

```json
"animations": { "staticR": [ { "accessories": [], "parts": [ { "depth": 9 } ] } ] }
```

Une pièce, à une profondeur qui n'existe même pas au niveau de
l'animation. Les treize autres sont perdues, et le `.dofasset` compilé ne
porte plus qu'un fragment — la forme rendue est un bout de manche.

La même signature « une seule pièce » se retrouve sur les autres gfx du
tableau, y compris quand une *autre* animation du même sprite est correcte :
`9075/staticR` → 1 pièce, alors que `9075/staticL` en a 18 et `9075/walkR`
20. Un PNJ orienté vers une direction saine s'affiche, le même orienté vers
la direction cassée disparaît.

## Correctif

Le même défaut se trouve dans les **deux** extracteurs, qui naviguent le SWF
chacun de leur côté :

- `ExtractSpriteMetadataCommand::extractAnimation` — la liste des pièces ;
- `ExtractSpriteCommand::extractSprites` (`$spriteToUse`) — le rendu SVG,
  qui produisait un dessin de 5,15 × 5,45 alors que le SWF en donne
  14,1 × 39,8. Corriger la seule métadonnée n'aurait donc rien changé à
  l'image.

Le nombre d'objets ne suffit pas à trancher : `1072/bonusR` pose une
enveloppe **et** un second clip, et ses 7 vraies pièces sont bien un cran
plus bas. Les deux lectures sont donc construites et **la plus riche
gagne** — une enveloppe porte toujours plus de pièces que le peu d'objets
posés à côté d'elle, et une pose à plat en porte toujours plus que l'unique
enfant de sa première pièce. La règle est écrite une fois par extracteur,
`resolveBodyPartFrames()` d'un côté, la boucle de détection d'enveloppe de
l'autre, et les deux commentaires se renvoient l'un à l'autre.

Mesuré sur les 865 sprites, en comparant la sortie de l'ancien code à celle
du nouveau : **88 sprites changent, aucune animation ne perd de pièce, et
10 648 pièces sont récupérées.**

Regénérés et republiés (`run` + `compile` + `publish`, plus
`extract-sprite-metadata` pour la métadonnée publiée, que le pipeline ne
mirroir pas) : **9073, 9075, 9005, 9097, 1265, 1273** — les six gfx de PNJ
posés du tableau. Le `.dofasset` de 9073 passe de 3,3 ko à 17 ko et rend un
personnage complet, chapeau brun et tablier bleu, registre à la main.

Les ~82 autres sprites que le correctif améliore (surtout les poses
`emoteStatic*` des seize sprites de classe) ne sont **pas** republiés ici :
la comparaison montre que les fichiers publiés ont dérivé d'une version
antérieure d'`arakne/swf` — 741 des 865 sprites diffèrent de ce que le code
actuel produit, indépendamment de ce correctif. Les republier reviendrait à
faire passer une refonte de toute la bibliothèque sous couvert d'une
correction de PNJ. Cela relève d'une passe `just sprites-build` complète et
assumée.

Hors de portée, inchangé : **9222 / 9223**. Les deux SWF n'existent pas dans
le client de retail, les deux placements de « Force Étrange » restent sans
sprite.

Prérequis machine, absents au moment du diagnostic : `php` et `composer`
(installés via brew), `composer install` dans `tools/assets-exporter`, et
les SWF de sprites liés dans `assets/sources/clips/sprites/` (`*.swf` est
ignoré par git) depuis le client de retail — cf. `doc/retail-client.md`.

## Vérification

La mesure se refait depuis les deux fichiers : les bornes de chaque pose
`static*` / `walk*` du SWF doivent se retrouver dans le `.dofasset`
publié. Après correctif, les six gfx sont à **100 %** (9073 : 14,1 × 39,8
des deux côtés), et les témoins non touchés le restent (9024 :
24,6 × 32,2). Plus aucun gfx de PNJ posé n'est sous-extrait, à l'exception
de 9222 / 9223 qui n'ont pas de SWF.

En jeu, sur la map **7289** : le `Vendeur Bûcheron d'Astrub` doit se tenir
sur la cellule 295, à la même échelle que `Leon Edehcub` cellule 400, et
répondre au clic (sa bulle d'action propose « Parler », « Acheter » et
« Vendre », ces deux dernières grisées — cf. QA-097).
