---
id: QA-037
title: Sept des huit panneaux HUD sont des maquettes statiques
severity: P0
domain: hud-panels
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-010, QA-013, QA-017]
files:
  - apps/electrobun/src/hud/panels/SpellsPanel.tsx
  - apps/electrobun/src/hud/panels/InventoryPanel.tsx
  - apps/electrobun/src/hud/panels/QuestsPanel.tsx
  - apps/electrobun/src/hud/panels/FriendsPanel.tsx
  - apps/electrobun/src/hud/panels/GuildPanel.tsx
  - apps/electrobun/src/hud/panels/MountPanel.tsx
  - apps/electrobun/src/hud/panels/ConquestPanel.tsx
---

## Symptôme

Aucun de ces fichiers ne contient de `useSyncExternalStore` ni d'abonnement à
un store :

| Panneau | Symptôme observé en session |
|---|---|
| `SpellsPanel.tsx` | 12 lignes vides générées par `[...Array(12)]`, « Points de boost : 0 » écrit en dur |
| `InventoryPanel.tsx` | `useState(1500000)` pour les kamas, `useState(450)` pour le poids, `maxWeight = 1000` |
| `QuestsPanel.tsx` | « Quêtes : 0 » en dur |
| `FriendsPanel.tsx` | deux listes générées par `[...Array(...)]` |
| `GuildPanel.tsx` | « Niveau 1 » en dur, sept onglets sans données |
| `MountPanel.tsx` | « Pas de monture » figé |
| `ConquestPanel.tsx` | liste générée |

Seul `StatsPanel.tsx` affiche du réel — et encore, parce que `HudOverlay` lui
passe `stats`, `name`, `level` et `classId` en props depuis `characterStore` ;
le panneau lui-même ne s'abonne à rien.

## Cause

C'est **la deuxième des trois causes racines** de la session, et elle explique
QA-010, QA-013 et QA-017. Les données arrivent bien du serveur et vivent dans
les stores — `spellsStore` reçoit ses entrées via `applySpellList` — mais aucun
panneau ne les lit. Le travail restant est du câblage, pas de la collecte.
