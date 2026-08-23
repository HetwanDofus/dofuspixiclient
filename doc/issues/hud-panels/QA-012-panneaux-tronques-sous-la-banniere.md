---
id: QA-012
title: Les panneaux débordent sous la bannière et sont tronqués
severity: P1
domain: hud-panels
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: []
files: [apps/electrobun/src/hud/HudOverlay.tsx:53-61]
---

## Symptôme

`panelWrapStyle` contraint la hauteur à `bannerTopPx`, mais les panneaux
Inventaire et Sorts dépassent : le bas de la grille d'inventaire et la zone
« Aucun objet sélectionné » passent derrière la bannière et deviennent
inaccessibles.
