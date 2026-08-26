---
id: QA-089
title: Après un changement de carte, cliquer un élément ouvre le menu d'un acteur de la carte précédente
severity: P1
domain: input
type: bug
status: fixed
session: 2
opened: 2026-08-26
closed:
fixed_in:
related: [QA-085, QA-050]
files:
  - apps/electrobun/src/game/scene/battlefield/picking.ts
  - apps/electrobun/src/game/scene/battlefield-scene.ts
---

## Symptôme

Au premier chargement, cliquer la porte d'une maison ouvre bien le menu
« Porte ». Après être sorti de la maison — ou après n'importe quel changement
de carte — le même clic ouvre le **menu joueur** : titre `Dev`, entrées
« Slap » et « Organize my shop ». La porte a pris l'identité du personnage.

## Attendu (1.29)

Le menu d'un élément interactif dépend de la cellule cliquée et du gfx qui s'y
trouve, jamais d'un état hérité de la carte précédente
(`DofusBattlefield.onObjectRelease`).

## Cause

Deux défauts qui se composent, tous deux dans `BattlefieldPicking`.

`clearTiles()` remettait `nextPickableId` à `1`. Or un identifiant de pickable
n'adresse pas que les tuiles : `pickableIdToPlayerId` et `callbacks` sont
indexés dans la même série. Repartir de `1` réattribue à une tuile de la
nouvelle carte l'identifiant qu'un acteur de l'ancienne détient encore.

Et il le détient encore parce que rien ne le retire. `prepareWorldActors()`
appelle `BattlefieldWorldActors.reset()`, qui détruit le renderer et tous ses
sprites (`world-actors.ts:init`) — mais `unregisterPlayerFromPicking` n'est
appelé que sur un message `REMOVE` par sprite, que le serveur n'envoie pas quand
le joueur quitte la carte. Les tables joueur survivent donc au changement.

`onObjectClick` (`picking.ts`) interroge `pickableIdToPlayerId` **avant** la
branche gfx : sur une collision, l'acteur fantôme gagne, et le menu joueur sort.

Défaut voisin, corrigé par la même passe : `clearTiles()` appelait
`PickingSystem.clear()`, qui vide *tous* les pickables, acteurs compris. C'est
sans effet au chargement d'une carte, où les acteurs arrivent après — mais le
rebuild de zoom (`BattlefieldZoom.onBeforeRebuild`) le déclenche alors que les
acteurs sont à l'écran, et les rendait injouables au clic jusqu'au prochain
changement de carte.

## Correctif

`nextPickableId` n'est plus jamais remis à zéro — un identifiant est unique pour
la durée de la session. `clearTiles()` désenregistre les pickables de tuiles un
par un, depuis un `tilePickableIds` tenu par `registerTile`, et laisse les
acteurs en place. Nouveau `clearPlayers()`, appelé depuis
`prepareWorldActors()` juste avant `reset()`, qui purge les tables joueur au
moment où le renderer qui les a produites est détruit.

## Vérification

`bun test src/game/scene/battlefield/picking.spec.ts` — trois cas, dont la
séquence exacte du symptôme : enregistrer l'acteur, changer de carte,
enregistrer la porte, cliquer. Le titre attendu est `Porte` ; sous l'ancien
code le test lit `Dev`.

En jeu : entrer dans la maison à gauche de la banque d'Astrub, ressortir,
recliquer la porte → menu « Porte » avec « Entrer ». Puis zoomer et cliquer son
propre personnage → le menu joueur répond toujours.
