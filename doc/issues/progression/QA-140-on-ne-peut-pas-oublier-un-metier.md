---
id: QA-140
title: On ne peut pas oublier un métier
severity: P2
domain: progression
type: feature
status: fixed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-130, QA-131, QA-133]
files:
  - proto/misc.proto
  - apps/gameserver-ts/src/core/modules/jobs
---

## Symptôme

`JobRemove` (`JR`) est typé et personne ne l'émet. Un métier appris l'est pour
toujours, ce qui rend les trois slots définitifs dès le premier essai.

## Attendu (1.29)

Une potion d'oubli du métier concerné, ou Gilles Caper à Incarnam pour les
métiers apprenables là-bas, retire le métier : niveau ramené à 1, pods du métier
perdus, `JR` envoyé au client. Réapprendre repart de zéro.

## Cause

Rien n'est engagé.

## Correctif

`JobsService.forget(playerId, jobId)`, et la branche d'objet qui l'appelle.

**La donnée existe déjà.** Les dix-sept « Potion d'oubli de métier » sont en
base depuis l'import du contenu, chacune avec l'effet **615** d'`effects.json`
(« Fait oublier le métier de #3 ») et **son job en hexadécimal dans `param3`** :
`2` pour Bûcheron, `18` pour Mineur (24), `1c` pour Paysan (28). Lu en décimal,
`18` donnerait Sculpteur de Bâtons — un vrai métier, et le mauvais : c'est
pourquoi un test pin l'encodage plutôt que de vérifier seulement que
l'identifiant se résout.

L'effet **603** (« Apprend le métier #3 ») est câblé du même geste et passe par
les mêmes règles d'emplacement que le PNJ (QA-130).

**Décision assumée** — oublier *supprime* la ligne de `player_jobs` plutôt que
de la remettre à 1. Les trois effets observables sont ceux de la fiche (le
métier disparaît, ses pods avec, `JR` part) et l'emplacement se libère, ce que
« réapprendre, c'est tout recommencer » implique.

Une potion qui ne s'applique pas — un métier qu'on n'a pas, un apprentissage
que les emplacements refusent — n'est **pas** consommée.

## Vérification

Apprendre un métier, le monter de quelques niveaux, l'oublier : le panneau ne
l'affiche plus, les pods maximum redescendent exactement de ce que le métier
avait donné, et un quatrième métier redevient possible.
