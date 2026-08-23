---
id: QA-009
title: "Marqueur de position de la minimap = rectangle rouge plein"
severity: P2
domain: worldmap
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-030, QA-054]
files: [apps/electrobun/src/game/worldmap/minimap-renderer.ts]
---

## Symptôme

La position du joueur est un gros rectangle rouge opaque d'environ 30×15 px qui
masque le décor sous lui, au lieu du petit repère canonique.

La minimap reste par ailleurs vide tant que le personnage n'a pas bougé une
première fois.

## Attendu (1.29)

Un petit repère qui ne masque pas ce qu'il y a dessous.
