---
id: QA-091
title: La vie régénérée ne remonte au client qu'à la prochaine lecture de stats
severity: P2
domain: progression
type: gap
status: fixed
session: 6
opened: 2026-08-27
closed:
fixed_in:
related: [QA-063, QA-070]
files:
  - apps/gameserver-ts/src/core/modules/stats/stats.service.ts
  - apps/electrobun/src/game/network/handlers/character.handler.ts
  - apps/electrobun/src/components/ui/main-banner.tsx
---

## Symptôme

Après un combat, le cœur de la bannière reste figé sur les PV de sortie de
combat. Rien ne bouge tant que le joueur ne fait pas quelque chose qui
redemande ses stats — déplacer un objet, dépenser un point de caractéristique.
Manette en main, cela se lit comme « la régénération ne marche pas ».

## Attendu (1.29)

Le cœur se remplit tout seul, en temps réel, proportionnellement à la vie
maximale.

## Cause

La régénération de QA-063 est **paresseuse** par construction : `players.
life_updated_at` porte la date du dernier calcul exact, et `LifeRegenService.
resolve` dérive les points dus à chaque lecture. C'est le bon choix — aucune
tâche de fond, la vie remonte même hors ligne — mais il n'a qu'un seul point
de sortie, `StatsService.sendStats`, appelé à sept endroits, tous déclenchés
par une action du joueur. Un joueur qui ne fait rien, précisément le cas où il
attend sa vie, ne déclenche rien.

Le message qui manquait existe pourtant dans le protocole depuis le début :
`InfoLifeRestoreTimer` (`IL`), jamais émis ni écouté.

## Correctif

`sendStats` émet désormais `IL` juste après `As` : `ILS` avec la période d'un
point de vie en millisecondes (`REGEN_MS_PER_LIFE_STANDING`) tant que la vie
est sous le plafond, `ILF` quand elle l'a atteint. Le client compte les points
lui-même à cette cadence (`CharacterHandler`), et comme chaque `As` est suivi
d'un `IL` qui redémarre le compteur, il ne dérive jamais de plus d'une période
de la valeur du serveur. C'est la réponse canonique 1.29 : le serveur annonce
la cadence, le client tient l'horloge.

Le compteur est **en pause**, pas arrêté, pendant tout un combat : la vie de
combat appartient au store de combat, et `GameEnd` est suivi d'un `As` + `IL`
frais.

Le remplissage du cœur, lui, était déjà proportionnel (`hp / max`) ; il est
maintenant borné (`max` vaut 0 avant la première trame `As`, et la vie peut
dépasser le plafond le temps que le serveur résolve un retrait d'objet
vitalité) et animé, pour que le niveau monte au lieu de sauter d'un cran.

## Vérification

`bun test src/core/modules/stats/` — deux cas ajoutés : un personnage sous son
plafond reçoit `ILS` avec la bonne période, un personnage au plafond reçoit
`ILF`.

En jeu : finir un combat blessé, poser la souris, et regarder le cœur monter
d'un point toutes les deux secondes sans rien toucher.
