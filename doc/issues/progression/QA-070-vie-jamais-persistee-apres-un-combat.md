---
id: QA-070
title: Les PV restants ne sont jamais écrits en base après un combat
severity: P1
domain: progression
type: gap
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-063]
files:
  - apps/gameserver-ts/src/core/modules/fight/engine/fight.end.service.ts
  - apps/gameserver-ts/src/core/modules/players/players.repository.ts
---

## Symptôme

Trouvé en instrumentant QA-063 : `players.life` ne bouge jamais. Les deux
personnages de développement portent encore leur valeur de seed, quel que soit
le nombre de combats joués.

## Cause

`FightEndService.endFight()` distribue l'XP, téléporte les morts, nettoie les
buffs — et jette `fighter.lp`. Aucune requête du serveur n'écrit la colonne :
`grep 'updateTable("players")'` ne remonte que des mises à jour de position, de
points de caractéristique et d'expérience.

Les dégâts d'un combat ne quittent donc jamais la mémoire du processus.

## Portée — QA-063 en dépend

C'est le trou du dessous. Une régénération branchée sur une colonne qui ne
descend jamais n'a rien à régénérer : le symptôme rapporté (« la vie ne remonte
pas après un combat ») recouvre en réalité deux défauts superposés, et corriger
QA-063 seul n'aurait rien changé de visible.

## Correctif

Ajouter `PlayersRepository.setLife(playerId, life, lifeUpdatedAt)` et l'appeler
en fin de combat pour chaque joueur, dans la transaction des récompenses.

Les **deux camps**, pas seulement les vainqueurs : une équipe qui perd mais
survit — un abandon, un combat expiré — a pris de vrais dégâts. Un joueur mort
revient à 1 PV, convention 1.29, avant sa téléportation au point de sauvegarde.

L'horodatage repart de la fin du combat, sans quoi la régénération se
compterait depuis la dernière lecture des statistiques.

## Vérification

Voir le runbook du sprint 01, étape « Régénération ». En base :

```bash
just psql "select name, life, life_updated_at from players"
```

`life` doit avoir baissé après un combat perdu de justesse, et
`life_updated_at` porter l'heure de fin du combat.
