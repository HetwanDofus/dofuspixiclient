---
id: QA-132
title: GDF n'est jamais émis — un objet interactif n'a aucun état
severity: P2
domain: network
type: gap
status: in-progress
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-085, QA-123]
files:
  - proto/game.proto
  - apps/gameserver-ts/src/core/modules/maps/maps.cells-codec.ts
  - apps/electrobun/src/game/network/handlers/map.handler.ts
---

## Symptôme

`GameFrameObject2` (`GDF`, `{cell_id, frame, interactive}`) est typé depuis
QA-085 et n'est **jamais émis par le serveur ni traité par le client**. Un objet
interactif n'a donc aucun état : un arbre coupé reste dessiné debout et reste
cliquable, un atelier occupé ne se distingue pas d'un atelier libre.

L'état est pourtant la seule chose qui rend une ressource exclusive : sans lui,
deux joueurs voient la même occurrence disponible.

## Attendu (1.29)

Le serveur diffuse `GDF` à tous les clients de la carte quand un élément change
d'état, et le client change la frame de la tuile et la retire du picking tant
qu'elle est épuisée. Les états sont ceux que `Skills.lua` de StarLoco commente
d'après le serveur officiel : verrouillé (2), en cours d'usage (3), en train de
revenir (5).

## Cause

QA-085 s'est arrêté au transport de l'action et à la validation du modèle. La
frame d'un élément suppose un état côté serveur, qui n'existait pas : les objets
interactifs sont aujourd'hui dérivés à la volée des cellules d'une carte
immuable.

## Correctif

`gatherable_cell_states` (QA-123) porte l'état ; `HarvestService` diffuse `GDF`
à `presence.sessionsOnMap(mapId)` à l'épuisement et à la réapparition. Les
valeurs exactes des frames se confirment dans
`assets/sources/client-code/dofus/graphics/gapi/Battlefield.as` avant d'être
figées en constantes nommées.

Côté client, `network/handlers/map.handler.ts` traite `frameObject2` et
`battlefield-scene.ts` retire la tuile du picking tant qu'elle est épuisée.

## Vérification

Deux clients sur la même carte : quand le premier récolte, le second voit
l'élément changer de frame, ne peut plus le cliquer, et le voit revenir à
l'échéance.
