---
id: QA-014
title: "Inventaire : aperçu du personnage remplacé par une silhouette"
severity: P2
domain: hud-panels
type: gap
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-015]
files: [apps/electrobun/src/hud/panels/InventoryPanel.tsx]
---

## Symptôme

Le cadre de gauche montre une silhouette grise générique.

## Attendu (1.29)

Le personnage y est rendu habillé, mis à jour à chaque changement d'équipement.
