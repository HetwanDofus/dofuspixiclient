---
id: QA-081
title: Barre de défilement parasite sur la fenêtre d'inventaire, onglet « Conditions » débordant, description écrasée
severity: P2
domain: hud-panels
type: bug
status: fixed
session: 5
opened: 2026-08-23
closed: 2026-08-23
fixed_in:
related: [QA-078, QA-079]
files:
  - apps/electrobun/src/hud/inventory/InventoryWindow.tsx
  - apps/electrobun/src/hud/inventory/ItemDetailPanel.tsx
  - apps/electrobun/src/hud/inventory/inventory-theme.ts
---

## Symptôme

Trois écarts relevés sur `screenshot-ui/inventory-screenshot.png` face à
`screenshot-ui/inventaire.png` :

1. Une barre de défilement court sur toute la hauteur de la fenêtre
   « Ton inventaire », alors que rien n'y déborde visuellement.
2. Le libellé « Conditions » sort de son onglet : les deux onglets partagent
   une largeur fixe taillée pour « Effets ».
3. La zone de description ne montre que deux lignes et demie ; en 1.29 elle
   en montre quatre.

## Attendu (1.29)

Mesuré sur la capture (origine du contenu 552,100 px, zoom 47/22) :

| élément | capture | unités |
|---|---|---|
| onglet « Effets » | x 767…867 px | largeur 47 |
| onglet « Conditions » | x 868…1019 px | largeur 71 |
| boîte de description | y 831…949 px | 129,2 → 184,4 depuis le haut de `DETAIL_BOX`, soit 55 de haut |

La capture montre aussi que l'onglet **sélectionné** est le clair
(`#b3ac91`, dans la continuité de la liste de lignes) et le non-sélectionné
le brun sombre à texte blanc — le code faisait l'inverse.

## Cause

1. `InventoryWindow` dimensionnait son conteneur à
   `(WINDOW_METRICS.height - 22) * zoom`, en ne retirant que la barre de
   titre. `Panel` est en `box-sizing: border-box` : sa bordure de 3 unités
   est *dans* sa hauteur, donc la zone de contenu ne fait que 401 unités,
   pas 404. Les 3 unités d'écart suffisaient à armer le
   `overflow-y: auto` de `.dofus-panel__content` (mesuré en jeu :
   `clientHeight` 654, `scrollHeight` 659, à zoom 1,63).
2. `DETAIL_METRICS.tabWidth` était une largeur unique pour les deux onglets.
3. `ItemDetailPanel` calculait la hauteur de la description comme
   `DETAIL_BOX.height - descriptionTop - headerHeight`. `descriptionTop` est
   déjà mesuré depuis le haut de `DETAIL_BOX`, donc la hauteur de l'en-tête
   était retirée une seconde fois : 33 unités au lieu de 55.

## Correctif

1. Le conteneur passe en `width: 100%; height: 100%` — il remplit ce que
   `Panel` lui laisse au lieu de le recalculer. Les trois boîtes qu'il
   contient sont en position absolue et finissent toutes avant l'unité 401,
   donc rien n'est perdu.
2. `tabWidth` devient `tabPaddingX` : chaque onglet se dimensionne sur son
   propre libellé.
3. La hauteur de la description est `DETAIL_BOX.height - descriptionTop`, et
   sa taille de texte passe de 9 à 10 unités (interligne mesuré à 12,4 sur
   la capture). Sa barre de défilement propre est conservée : elle est bien
   présente en 1.29.

`detailTabActive` / `detailTabInactive` sont ré-échantillonnées sur la
capture et leur rôle rétabli.

## Vérification

Testé à la main dans le client web le 2026-08-23, Chienchien sélectionné :
plus de barre de défilement sur la fenêtre, les deux onglets contiennent
leur libellé, « Effets » est l'onglet clair et « Conditions » le sombre, la
description affiche trois lignes plus son ascenseur.

## Reste à faire

Deux écarts vus en re-mesurant la carte mais laissés de côté, hors du
périmètre signalé : la hauteur de ligne d'effet est de 20 unités en 1.29
contre 27 dans le code, et le fond de la liste de lignes est `#c8bfa1` et
non le `detailBody` de la colonne de gauche.
