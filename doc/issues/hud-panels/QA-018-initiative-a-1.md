---
id: QA-018
title: Initiative à 1 dans le panneau Caractéristiques
severity: P2
domain: hud-panels
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-005]
files: [apps/electrobun/src/hud/panels/StatsPanel.tsx]
---

## Symptôme

`PV 55/55, PA 6, PM 3, Initiative 1, Prospection 100`. Les PA/PM/PV/prospection
sont conformes au niveau 1. Le champ « Énergie » est affiché sans valeur.

## Attendu (1.29)

L'initiative de base se situe autour de 100 — la valeur `1` suggère une formule
non implémentée.
