---
id: QA-144
title: Les ressources de récolte partagent un même sprite — la variante n'est jamais résolue à l'extraction
severity: P2
domain: world-render
type: bug
status: fixed
session: 7
opened: 2026-09-01
closed:
fixed_in:
related: [QA-129, QA-143]
files:
  - .gitignore
  - tools/assets-exporter/src/Command/ExtractTileCommand.php
  - tools/assets-exporter/src/Swf/VariantFrameResolver.php
  - tools/assets-exporter/src/Swf/VariantFrameModifier.php
  - tools/assets-exporter/src/Swf/ClipVariables.php
  - apps/electrobun/src/game/assets/resource-tile-variants.spec.ts
  - apps/electrobun/public/assets/spritesheets/tiles/objects
---

## Symptôme

Sur la map, toutes les essences d'arbre se ressemblent : Frêne, Châtaignier,
Noyer, Chêne, Érable, If, Merisier, Ébène et Charme affichent le même arbre.
L'Orme, lui, est distinct.

Le référentiel n'est pas en cause : `interactive-objects.json` donne bien un
gfx par essence (Frêne 7500 … Charme 7508, Orme 7509), et la sélection client
est correcte — `LayerBuilder.tileKeyFor()` compose `objects_<gfxId>` à partir
de `cell.layer2`, sans repli ni alias
(`apps/electrobun/src/game/scene/tiles/layer-builder.ts:119`).

Ce sont les assets publiés qui étaient identiques :

- les `atlas.svg` de 7500 à 7508 avaient tous le md5 `2046cdc5…` ;
- les `manifest.json` ne différaient que par `spriteId` — mêmes bornes
  (238×313, offset −153.6 / −271.75) ;
- `7500.dofasset` et `7501.dofasset`, 390 580 octets chacun, différaient sur
  **2 octets**, l'identifiant.

Sur les 56 modèles de gfx portés par les objets interactifs de type 1
(Gathering/Resource), on ne comptait que **29 rendus distincts** — les neuf
arbres, les neuf minerais, six céréales, quatre plantes et les points de pêche
collapsés en un seul visuel par famille.

## Attendu (1.29)

Chaque essence, chaque minerai et chaque céréale a son propre visuel : c'est ce
qui permet de reconnaître une ressource sur la map sans la survoler.

## Cause

Elle n'est **pas** dans une extraction ancienne qui aurait recopié une tuile de
référence : le SWF retail rend lui aussi la même image pour les neuf arbres
tant qu'on le lit naïvement. Le 1.29 décline une seule pièce d'art en toute une
famille de ressources, et la déclinaison est portée par de l'ActionScript que
l'extraction ne rejouait pas.

Le symbole exporté est une enveloppe dont la frame 0 pose un numéro de
variante, puis le clip qui porte les variantes saute à la frame correspondante.
Dans `o4.swf`, le symbole 7500 (character 221) fait

```
stop(); n_arbre = 1;
```

et 7501 (character 220) pose `n_arbre = 2` — les deux enveloppent **le même**
character 209. Le saut se fait de deux façons selon la famille :

- depuis la frame 0 du clip de variantes lui-même,
  `gotoAndStop(_parent._parent.n_arbre + 1)` — arbres (characters 170, 189,
  206) et minerais ;
- depuis un `onClipEvent` accroché au `PlaceObject2` qui pose le clip,
  `this.gotoAndStop(_parent._parent.n + 1)` — céréales (character 83) et
  plantes. Ce second cas ne vit pas dans un `DoAction` : il est stocké sur la
  balise de placement, ce qui explique qu'il ait été manqué au premier examen.

`ExtractTileCommand` rendait la frame 0 de tout l'arbre de characters sans
évaluer ce saut, donc publiait pour chaque membre de la famille la variante par
défaut — la frame 0 du clip de variantes, identique à sa frame 1. Le clip 170
porte bien onze frames toutes différentes : les neuf essences étaient là depuis
le début, jamais sélectionnées.

## Correctif

Rejouer la sélection à l'extraction, en trois pièces sous
`tools/assets-exporter/src/Swf/` :

- `ClipVariables` lit les variables entières posées par la frame 0 de
  l'enveloppe, via l'AVM d'arakne-swf ;
- `VariantFrameResolver` parcourt l'arbre de balises brutes et évalue les deux
  formes de saut, dans un scope où `_parent` est auto-référentiel et `this` est
  un enregistreur de `gotoAndStop`. Il ne retient qu'un saut ayant **réellement
  lu** une des variables de l'enveloppe, de sorte qu'un `gotoAndPlay` constant
  ne déplace rien ;
- `VariantFrameModifier` épingle chaque character résolu sur sa seule timeline
  (`maxDepth: 1`), pour que les animations imbriquées gardent leurs frames.

Les SWF sources manquaient au dépôt, et pas par choix : la ligne `*.sw?` de
`.gitignore` — du boilerplate destiné aux fichiers d'échange vim — avalait
aussi `*.swf`. Silencieusement : `git add` ne faisait rien et `git status`
restait propre, ce qui explique que **aucun** `.swf` ne soit suivi, pas même
les 903 de `clips/sprites`. Le motif est passé à `*.swp` / `*.swo`, et
`assets/sources/clips/gfx/` a été alimenté depuis le client retail décrit dans
`doc/retail-client.md`. Reste à trancher si ~100 Mo de SWF doivent entrer en
git-lfs.

La mécanique de variante ne touche que **36 tuiles objet sur 5 031**, et
aucune tuile de sol (`g*.swf` : 0 sur 623). Sur les 56 modèles de ressource,
**52 rendus distincts** au lieu de 29. Les paires restantes sont des points de
pêche (7529/7544, 7531/7532, 7537/7538, 7539/7540) — leur clip ne pose aucune
variable de variante, le client 1.29 y dessine bien la même chose.

Seules ces 36 tuiles ont été republiées. Un `publish tiles.objects` complet
réécrit les 4 997, parce que le pipeline d'aujourd'hui ne produit plus les
mêmes octets que celui qui avait généré les assets commités — passage du format
`.dofasset` v1 à v2 (le runtime Rust lit les deux, `format.rs:314`), mais aussi
géométrie différente sur des tuiles sans rapport avec les variantes. Ce delta-là
n'a pas été vérifié visuellement, donc il n'a pas été embarqué ici.

Relevé au passage, hors périmètre : l'extraction produit une tuile 3630 que la
publication commitée ne contient pas, et 83 tuiles publiées (dont 6583–6612 et
10000–10002) n'existent dans aucun `o*.swf`.

## Vérification

```bash
cd apps/electrobun
bun test src/game/assets/resource-tile-variants.spec.ts
```

Le test hache la géométrie publiée de chaque gfx de récolte — toutes les
sections du `.dofasset` sauf `Extras`, qui porte l'identifiant et ferait passer
deux tuiles identiques pour distinctes — et compare l'ensemble des groupes de
géométries partagées à une liste de référence. Il échoue dans les deux sens :
sur une duplication nouvelle, et sur un groupe qui rétrécit — ce qui force la
mise à jour de la liste plutôt que de la laisser mentir. Vérifié contre les
assets d'avant correctif : le hachage regroupe bien 7500/7501/7502/7508,
7513/7514, 7520/7521 et 7529/7544.

Il vise le `.dofasset`, seul fichier que le client charge réellement
(`atlas-loader.ts` reconstruit le manifeste depuis la section Extras). Les
dossiers `objects/<id>/atlas.svg` encore présents sous `public/assets` sont un
reliquat de l'ancien pipeline SVG : plus republiés, donc désormais périmés.

Manette en main : poser un personnage sur une map d'Astrub portant plusieurs
essences et vérifier que Frêne et Châtaignier ne sont pas superposables.
