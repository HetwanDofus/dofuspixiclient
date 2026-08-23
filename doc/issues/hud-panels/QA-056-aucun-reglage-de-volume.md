---
id: QA-056
title: Aucun réglage de volume ni de coupure du son dans l'interface
severity: P2
domain: hud-panels
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-055]
files: [apps/electrobun/src/game/audio/]
---

## Symptôme

`AudioManager` gère trois canaux avec volumes et mutes (`music: 0.3`,
`environment: 0.3`, `effects: 0.5`) et expose `setVolume` / `setMuted`, mais
**aucun `.tsx` du HUD ne les appelle**.

Il n'existe par ailleurs aucun panneau d'options : `PanelName` se limite à
`stats`, `spells`, `inventory`, `quests`, `friends`, `guild`, `mount`,
`conquest`. Le joueur ne peut ni baisser ni couper le son.

## Attendu (1.29)

Un panneau d'options avec un curseur par canal.
