---
id: QA-090
title: Un changement d'équipement visible n'atteint aucun client avant le prochain changement de carte
severity: P1
domain: inventory
type: gap
status: fixed
session: 6
opened: 2026-08-27
closed:
fixed_in:
related: [QA-076, QA-079]
files:
  - apps/gameserver-ts/src/core/modules/player-presence/player-presence.look.service.ts
  - apps/gameserver-ts/src/core/features/game/item-move/item-move.handler.ts
  - apps/electrobun/src/game/scene/player/renderer.ts
  - apps/electrobun/src/game/scene/player/sprite-controller.ts
---

## Symptôme

Deux clients connectés sur la même carte, avec deux personnages. L'un équipe
ou retire une coiffe : son sprite ne change pas chez l'autre. Il ne change
pas non plus chez lui. La nouvelle apparence n'arrive qu'au changement de
carte, quand le serveur reconstruit les sprites depuis zéro.

## Attendu (1.29)

L'apparence est publique et immédiate : le serveur rediffuse le sprite du
personnage (`GM~`) à tout le monde sur la carte dès que la panoplie visible
bouge — arme, coiffe, cape, familier, bouclier.

## Cause

Deux moitiés manquantes, une de chaque côté.

Côté serveur, `AccessoriesService.buildPresence` n'était appelé qu'à un seul
endroit : `enter-game.handler.ts:78`. L'entrée de présence porte donc la
panoplie telle qu'elle était à l'arrivée sur la carte, et `item-move` ne
diffusait rien du tout après un équipement — seulement `As` (les chiffres de
la fiche), qui ne dit rien de l'apparence.

Côté client, la chaîne existait mais ne menait nulle part :
`BattlefieldScene.updateActorLook` → `BattlefieldWorldActors.updateLook` →
`PlayerRenderer.updatePlayer`, et `updatePlayer` ignorait purement et
simplement `data.look`. Personne n'appelait `updateActorLook`, et l'appel
aurait été sans effet. Une trame `GM` sur un acteur déjà présent retombe de
toute façon sur `updatePlayer` (`addPlayer` court-circuite sur un id connu) :
c'est ce chemin-là qu'il fallait rendre capable de changer d'apparence.

## Correctif

`PlayerLookService.refresh(characterId)` (nouveau, module `player-presence`) :
reconstruit la panoplie visible, la compare à celle que porte la présence, et
ne diffuse que si elle a bougé — un anneau ou une ceinture, qui n'ont pas de
slot d'apparence, ne produisent donc aucune trame. La diffusion est un `GM`
avec l'opération `UPDATE` vers **toutes** les sessions de la carte, soi-même
compris : le client local n'a pas d'autre source pour savoir à quoi ressemble
son propre équipement. Appelé depuis `item-move.handler.ts` après `sendStats`.

Pendant un combat la présence est mise à jour mais rien n'est envoyé : le
sprite d'un combattant est piloté par les trames de combat, et lui rejouer un
`GM` de jeu de rôle le ramènerait à sa cellule d'avant le combat.

Côté client, `PlayerRenderer.updatePlayer` traite désormais `look` (chaîne
complète : gfx, trois zones de couleur, cinq slots d'accessoire) et délègue à
`PlayerSpriteController.reload`, qui recharge l'animation courante — le cache
d'animations est indexé par `(gfxId, animName, look)`, donc la nouvelle
apparence est un miss — puis préchauffe les autres directions en tâche de
fond, sinon le premier pas après l'équipement part sur un chargement à froid.

Effet de bord corrigé au passage : `BattlefieldPicking.registerPlayer`
allouait un nouveau pickable à chaque ré-enregistrement du même acteur sans
retirer l'ancien. Sans `GM UPDATE` cela restait rare ; avec, c'était une fuite
par équipement. Il désenregistre maintenant l'acteur avant de le réinscrire.

## Vérification

`bun test src/core/modules/player-presence/` — quatre cas : la diffusion vers
la carte entière soi-même compris, le silence sur un objet sans slot
d'apparence, la présence mise à jour mais muette en combat, et le personnage
absent de toute carte.

En jeu, deux clients sur la même carte : équiper une coiffe sur l'un, la voir
apparaître sur les deux sans changer de carte, puis la retirer.
