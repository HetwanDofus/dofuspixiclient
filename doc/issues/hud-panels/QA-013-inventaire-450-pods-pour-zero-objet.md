---
id: QA-013
title: "Inventaire : 450/1000 pods pour zéro objet"
severity: P2
domain: hud-panels
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-037, QA-035]
files: [apps/electrobun/src/hud/panels/InventoryPanel.tsx]
---

## Symptôme

L'inventaire est vide (aucun objet, aucun équipement) mais la jauge de pods
affiche `450/1000`.

## Cause

`useState(450)` pour le poids et `maxWeight = 1000` sont écrits en dur dans le
panneau (QA-037). Le calcul de poids ne dérive pas du contenu réel.
