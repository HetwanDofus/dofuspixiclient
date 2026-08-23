---
id: QA-033
title: Cliquer une case de la carte du monde ne fait rien
severity: P2
domain: worldmap
type: gap
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: []
files: [apps/electrobun/src/hud/worldmap/WorldMapPanel.tsx:49]
---

## Symptôme

Le callback `onTeleport` se contente d'un
`console.log("World map teleport:", mapId)`.

## Attendu (1.29)

Ce n'est pas un manque en soi — le 1.29 ne téléporte pas non plus au clic. Mais
le survol n'affiche pas davantage le nom de la zone / sous-zone, qui est
l'usage principal de cet écran.
