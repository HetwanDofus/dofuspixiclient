---
id: QA-082
title: Les icônes de caractéristique venaient du mauvais jeu d'assets
severity: P2
domain: hud-panels
type: bug
status: fixed
session: 5
opened: 2026-08-23
closed: 2026-08-23
fixed_in:
related: [QA-079, QA-081]
files:
  - apps/electrobun/src/hud/inventory/inventory-theme.ts
  - apps/electrobun/src/hud/inventory/ItemDetailPanel.tsx
---

## Symptôme

Sur la fiche d'un objet, l'icône posée à droite d'une ligne d'effet ne
correspondait pas à l'effet : « +2 à la chance » (caractéristique 13)
affichait une tête de profil blanche, « +20 en sagesse » (12) une tête de
profil verte. Les lignes de dommages n'avaient aucune icône.

## Cause

`CHARACTERISTIC_ICON` prenait ses fichiers dans
`themes/classic/assets/stats/effects/effect-<n>-*.svg`, en supposant que le
nombre du nom de fichier était l'identifiant de caractéristique. Une planche
de contact des 44 fichiers montre que non : `effect-6/7/8/9.svg` sont quatre
boucliers gris identiques, `effect-14-agility.svg` et
`effect-15-intelligence.svg` la même botte, `effect-1-ap.svg` un dé. Ce sont
des index de bibliothèque SWF, et ce jeu-là est celui des icônes d'*effet de
sort* du HUD de combat, pas celui des caractéristiques.

Les bonnes icônes étaient dans le dossier parent, `stats/icon-*.svg`, jamais
utilisé par l'inventaire.

## Attendu (1.29)

Recoupé icône par icône contre une encyclopédie 1.29 qui sert le jeu retail
(`dofusretrotools.com/encyclopedia`, 28 icônes de stat nommées) : les
`stats/icon-*.svg` du dépôt sont **le même dessin**, pas une ressemblance —
même bordure colorée, même silhouette. La sagesse y est bien la roue violette
de `screenshot-ui/inventaire.png`.

Le rapprochement suit l'appariement élément/caractéristique de Dofus, ce qui
explique qu'un seul fichier serve les deux :

| caractéristique | fichier |
|---|---|
| 10 Force | `icon-earth` |
| 15 Intelligence | `icon-fire` |
| 13 Chance | `icon-water` |
| 14 Agilité | `icon-air` |
| 11 Vitalité | `icon-vitality` |
| 12 Sagesse | `icon-wisdom` |
| 1 PA · 23 PM · 19 Portée | `icon-ap` · `icon-mp` · `icon-range` |
| 44 Initiative · 48 Prospection · 26 Invocations | `icon-initiative` · `icon-prospection` · `icon-summons` |
| 82 / 99 Vie | `icon-hp` |
| 30 Alignement | `icon-alignment` |
| 33-37 et 83-87 Résistances | `icon-<élément>-bonus` |

## Correctif

`CHARACTERISTIC_ICON` est réécrite sur `stats/icon-*.svg`. `characteristicIcon`
prend un second argument, l'élément : les lignes de dommages portent la
caractéristique 0 et rangent leur élément dans un champ à part
(`FormattedEffect.element`), donc elles sont maintenant badgées avec
`icon-<élément>-damage` comme en 1.29 — l'élément n'est qu'un repli, une
ligne de caractéristique garde son icône propre.

## Vérification

Testé à la main dans le client le 2026-08-23 : « +2 à la chance » porte la
goutte bleue, « +10 en initiative » la flèche violette, « Dommages : 4
(neutre) » le triangle neutre — chacun identique à l'icône de même nom sur
l'encyclopédie de référence.

Une planche de validation a été publiée pour faire confirmer l'ensemble ligne
par ligne (les 44 caractéristiques réellement portées par les
`item_templates` importés, avec leur nombre d'objets et l'icône proposée).

## Reste à faire

**Six lignes n'ont aucune icône dans le dépôt** — l'extraction SWF ne les a
jamais produites, alors que 1.29 les dessine :

| ligne | dessin retail |
|---|---|
| 18 coups critiques | enclume bleue |
| 49 soins | croix rouge |
| 80 / 17 dommages | épée dorée |
| 69 / 70 dommages aux pièges | gemme noire, éclair jaune |
| 96 poids portable | — |
| 29 énergie | — |

Elles tombent sur `null` et la ligne s'affiche sans icône. S'ajoutent les
lignes drapeau (`FLAG_EFFECT_LABELS`, « Lié au compte ») auxquelles 1.29 met
un anneau de bronze tressé, également absent, et l'effet 812
(« Résistance : x / y », 3 639 objets) qui n'a ni caractéristique ni élément.

Les récupérer demande de repasser l'extracteur sur les SWF retail, absents
du dépôt.
