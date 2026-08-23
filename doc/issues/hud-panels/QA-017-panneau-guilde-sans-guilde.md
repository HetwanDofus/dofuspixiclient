---
id: QA-017
title: Le panneau Guilde s'ouvre avec des données pour un personnage sans guilde
severity: P2
domain: hud-panels
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-037]
files: [apps/electrobun/src/hud/panels/GuildPanel.tsx]
---

## Symptôme

`G` ouvre un panneau complet (Membres / Infos / Bonus / Percepteurs / Enclos /
Maisons / Emblème) affichant « Niveau 1 » et une barre d'XP.

## Attendu (1.29)

Sans guilde, le panneau ne s'ouvre pas.

## Cause

Panneau non branché — voir QA-037.
