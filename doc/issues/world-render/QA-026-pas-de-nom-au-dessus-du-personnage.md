---
id: QA-026
title: Pas de nom au-dessus du personnage
severity: P2
domain: world-render
type: gap
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: []
files: [apps/electrobun/src/hud/world/player-nameplate-store.ts]
---

## Symptôme

Aucun `TextOverHead` ne s'affiche, ni en permanence ni au survol.

## Cause

Le store `hud/world/player-nameplate-store.ts` et le composant
`PlayerNameplate` existent et sont montés, mais aucune entrée n'y est poussée
pour le joueur local pendant la session.
