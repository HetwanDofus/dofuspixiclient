---
id: QA-147
title: La récolte est muette
severity: P3
domain: audio
type: feature
status: fixed
session: 7
opened: 2026-09-03
closed:
fixed_in:
related: [QA-143, QA-145, QA-055]
files:
  - apps/electrobun/src/game/audio/harvest-sounds.ts
  - apps/electrobun/src/game/audio/harvest-sounds.spec.ts
  - apps/electrobun/src/game/audio/audio-manager.ts
  - apps/electrobun/src/game/network/handlers/map.handler.ts
  - apps/electrobun/src/game/scene/player/renderer.ts
---

## Symptôme

Couper un arbre ne produit aucun son : ni coup de hache pendant l'action, ni
bruit de chute à l'échéance. L'animation, elle, est correcte.

## Attendu (1.29)

**Il n'y a pas d'événement sonore de récolte en 1.29.** `GA;501` ne fait que
lancer l'animation de l'outil en boucle (`GameActionsEx.as:210-226`,
`setSpriteLoopAnim`) ; ce qu'on entend vient des clips eux-mêmes, qui appellent
`_root.SOMA.playSound(<linkname>)` sur la frame voulue.

Un seul métier a eu ce traitement : la pêche. Tous les coins de pêche (gfx
7529-7549, bundles `o4`/`o5`) jouent `flotteur` quand ils sont pris et
`fish_out` quand ils donnent, et le personnage joue `fish` sur `anim18End`.
L'animation de hache (`anim17`, portée par toutes les haches, pioches et faux)
ne porte aucun son, et aucun arbre non plus — les seuls `playSound` des tuiles
sont ceux des coins de pêche, plus `licrounch_arbre` (gfx 208/210) et `pic`
(gfx 25/26).

Le personnage, lui, sonne par animation : `anim13/14/16` → `epee_1m`,
`anim15` → `marteau_1m`, `anim113/114/116` → `epee_2m`, `anim0` → `punch`,
`hit` → `aie_normal_m`. Rien pour `anim17`.

## Correctif

Le client s'écarte donc volontairement de 1.29 ici, mais avec les sons de
1.29 : chaque métier de récolte reçoit une paire d'effets du bundle
(`hache_2m`/`cassage_bois`, `pic`/`impact_lourd`, `herbe`/`feuillage`,
`herbe`/`feuillage2`), et la pêche garde exactement la paire que les coins de
pêche jouent d'eux-mêmes (`flotteur`/`fish_out`).

- `AudioManager.playSound(linkname)` reproduit la fonction du client retail :
  le nom de symbole est plié en clé (`AUEC`) avant d'être joué. C'est la seule
  façon d'adresser un son comme les clips le font.
- Le métier est lu **sur la ressource** (`SK[skill].j` du bundle `skills`, via
  le gfx posé sur la cellule), pas sur l'outil du personnage : tout le monde
  sur la carte entend la même chose, y compris pour la récolte d'un autre.
- Le coup part sur la frame `applyEnd` de l'animation en boucle — la frame
  canonique où l'action porte — donc au moment où la hache mord, une fois par
  cycle. L'animation est l'horloge : quand elle s'arrête (déplacement,
  interruption), le son s'arrête avec elle.
- Le son de fin part sur `GDF` frame 3, le seul signal d'achèvement de la
  ressource sur le fil, et seulement pour une récolte annoncée par un `GA;501`
  reçu — sinon chaque arrivée sur une carte déclencherait la chute de tous les
  arbres déjà coupés. La frame 2 (la réservation, envoyée dans la même foulée
  que l'action) ne l'annule pas : elle fait partie de l'action.

**Le piège** : `defaultLoadLang` ne recopiait que `AUM`/`AUE`/`AUA` et jetait
`AUEC`, donc en jeu tout `playSound` se résolvait à rien alors que les tests,
qui injectent le bundle, passaient au vert. Les deux tests ajoutés depuis
attaquent le chargeur réel et les bundles publiés, pas une fixture.

## Vérification

- `bun test src/game/network/handlers/map.handler.spec.ts` — un cycle
  d'animation sonne une fois, la frame 3 sonne la fin, une ressource sans
  métier et les ressources déjà épuisées à l'arrivée restent muettes.
- `bun test src/game/audio/audio-manager.spec.ts` — `playSound` plie le
  linkname en clé et ignore un nom absent du bundle.
- `bun test src/game/audio/harvest-sounds.spec.ts` — chaque nom du tableau se
  résout à un mp3 publié, et le gfx du Frêne nomme bien le métier bûcheron par
  le chemin que le client emprunte (`IO.g` → `IO.d.sk` → `SK[].j`).
- En jeu, `dev/dev` : couper un Frêne. Un coup de hache par cycle d'animation,
  puis le craquement au moment où l'arbre tombe.
