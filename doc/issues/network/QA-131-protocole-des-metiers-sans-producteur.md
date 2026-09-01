---
id: QA-131
title: Le protocole des métiers n'a aucun producteur, et JobSkillEntry se trompe de champs
severity: P1
domain: network
type: gap
status: fixed
session: 6
opened: 2026-08-31
closed: 2026-09-01
fixed_in:
related: [QA-123, QA-129, QA-125]
files:
  - proto/misc.proto
  - proto/items.proto
  - proto/server_messages.proto
  - apps/electrobun/src/game/network/handlers
---

## Symptôme

Les cinq messages du canal métier sont déclarés et câblés dans
`server_messages.proto` (2200 à 2204), et **aucun code du serveur n'en émet
un** ; symétriquement, aucun gestionnaire du client n'en écoute un.

| Message | Id | Producteur | Consommateur |
|---|---|---|---|
| `JobSkills` (`JS`) | 2200 | aucun | aucun |
| `JobXP` (`JX`) | 2201 | aucun | aucun |
| `JobLevel` (`JN`) | 2202 | aucun | aucun |
| `JobRemove` (`JR`) | 2203 | aucun | aucun |
| `JobOptions` (`JO`) | 2204 | aucun | aucun |
| `ItemTool` (`OT`) | items.proto | aucun | aucun |

Deuxième défaut, dans la forme du message. `JobSkillEntry` porte
`{skill_id, level, min_slots, max_slots, params}`. Le client décompilé du dépôt
dit autre chose : `dofus/aks/Job.as:onSkills` découpe
`JS<jobId>;<skillId>~<p1>~<p2>~<p3>~<p4>,…|…` et passe les quatre valeurs
telles quelles à `new Skill(nID, nParam1, nParam2, nParam3, nParam4)`
(`dofus/datacenter/Skill.as`). Il n'y a ni `level`, ni couple
`min_slots`/`max_slots` : **`param1` est le nombre de cases maximum** de la
compétence, et rien d'autre ne le lit —
`Job.getMaxSkillSlot()` en prend le maximum, `Job.initialize` filtre les
recettes sur `craft.itemsCount <= skill.param1`, et `Craft.difficulty` en
dérive la couleur de la ligne.

## Attendu (1.29)

À l'entrée en jeu, le serveur envoie `JS` puis `JX` pour les métiers du
personnage. Un gain d'expérience renvoie `JX`, un passage de niveau ajoute
`JN`, un oubli envoie `JR`. Équiper ou retirer un outil de métier envoie `OT`.

## Cause

La passe protocole a transcrit le canal sans implémentation, et `JobSkillEntry`
a été déduit du nom des champs plutôt que du client décompilé, qui n'était pas
encore au dépôt.

## Correctif

`modules/jobs/jobs.frames.service.ts` émet `JS`, `JX`, `JN` et `JR` ;
`InventoryService.equip`/`unequip` émettent `OT` quand l'objet concerné est un
outil de `job_tools`. `JS`/`JX` partent depuis la tranche `enter-game`.

`JobSkillEntry` devient `{skill_id, param1, param2, param3, param4}`. Les
numéros de champ ne bougent pas, mais la sémantique change : c'est un **bump
majeur** de `@dofus/proto` au sens de `doc/contracts.md`.

Côté client : `game/stores/jobs-store.ts` et
`game/network/handlers/jobs.handler.ts`, instancié dans `game-client.ts` à côté
de `InventoryHandler`.

## Vérification

Un test d'intégration websocket observe `JS` puis `JX` à l'entrée en jeu, puis
`JX` et `JN` après un gain d'expérience suffisant. `bun run --cwd packages/proto gen`
ne laisse aucun diff généré non commité.
