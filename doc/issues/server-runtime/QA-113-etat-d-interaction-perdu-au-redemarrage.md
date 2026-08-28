---
id: QA-113
title: Combats et dialogues ne survivent pas à un redémarrage du core, et rien ne le dit au client
severity: P2
domain: server-runtime
type: gap
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-066, QA-102, QA-112]
files:
  - apps/gameserver-ts/src/core/modules/fight/registry/fight.registry.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.session.ts
  - apps/gameserver-ts/src/core/shared/handoff/handoff.coordinator.ts
---

## Symptôme

Le transfert d'état bleu/vert ne connaît que cinq parties : `sessions`,
`player-presence.players`, `player-presence.pending-moves`, `chat.flood`,
`scheduler.jobs`. Ni `FightRegistryService` ni `NpcDialogSessionService` ne
portent `@HandoffPart()`.

Conséquence pour le dialogue : après un redémarrage du core, la fenêtre de
conversation reste ouverte côté client **sans aucun état serveur derrière**.
Répondre ne produit rien et rien ne le signale. Le core tourne en mode watch,
donc le cas se produit à chaque modification de fichier.

## Attendu

Soit l'état survit, soit il est fermé proprement — un `DV` pour le dialogue, un
`EV` pour un échange. Une fenêtre ouverte sur du vide est le pire des trois.

## Correctif

`ExchangeRegistryService` (QA-102) est écrit `@HandoffPart()` dès le départ et
sert de modèle : l'état d'une session est du JSON pur, `serialize`/`restore` sont
deux méthodes, et `onResume` ferme ce qui ne peut pas être restauré.

Le combat est un autre sujet — il porte des fonctions de rappel qui ne se
sérialisent pas — et il a déjà sa fiche, QA-066.

## Reste à faire

Non engagé pour le dialogue.
