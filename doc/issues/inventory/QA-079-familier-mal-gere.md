---
id: QA-079
title: Le familier était mal géré — jet sur des effets non aléatoires, #3 jamais transmis
severity: P1
domain: inventory
type: bug
status: fixed
session: 4
opened: 2026-08-23
closed: 2026-08-23
fixed_in:
related: [QA-013]
files:
  - apps/gameserver-ts/src/core/modules/inventory/item-effects.ts
  - apps/gameserver-ts/src/core/modules/inventory/inventory.frames.service.ts
  - apps/electrobun/src/hud/inventory/inventory-theme.ts
  - apps/electrobun/src/hud/inventory/ItemDetailPanel.tsx
  - apps/electrobun/src/game/lang/effects-lang.ts
---

## Symptôme

Trois défauts distincts sur la fiche d'un familier :

1. `rollItemEffects` tirait un nombre aléatoire dès que `param2 > param1`,
   sans vérifier que l'effet est un vrai jet. L'effet 800 ("Points de vie")
   porte `param1..param2` = `5..72` sur la plupart des familiers importés
   (une plage, pas un jet) : le Pioute bleu du seed se voyait attribuer un
   nombre aléatoire (18) à chaque re-seed, qui restait ensuite figé sans
   rapport avec le personnage.
2. `formatEffect` recevait `special: 0` en dur côté client, et le serveur
   envoyait `ItemEffectSchema.param3` (l'entier numérique substitué à
   `#3`) à `0` en dur aussi — alors que `player_items.effects` porte bien
   la valeur brute hexadécimale dans son propre `param3` (string). Toute
   ligne utilisant `#3` (« Points de vie : #3 », « Résistance : #2 / #3 »…)
   s'affichait sans valeur.
3. « A mangé le : 600 », « Corpulence : 0 », « Dernier repas : 0 » (effets
   808/806/807) sont l'état d'élevage vivant d'un familier ; ce serveur ne
   simule pas le nourrissage, donc ces lignes n'affichaient que les
   défauts figés du template, sans rapport avec un état réel.

## Attendu (1.29)

La capture `screenshot-ui/inventaire.png` (un Chienchien réel) montre
`Points de vie : 1`, `+20 en sagesse`, `Lié au compte` — trois lignes,
aucune ligne d'élevage.

## Cause

- `rollItemEffects` n'avait aucun moyen de distinguer un jet d'un simple
  écart de plage : `effects.json` marque `"j": true` sur les vrais jets,
  mais leur `param3` (la notation de dé, `1d7+0`) est déjà la donnée dont
  le serveur dispose — inutile de charger le bundle pour lire `j`.
- `ItemEffectSchema.param3` avait été laissé à `0` à la création du frame
  `ItemTemplates`/`ItemAdd`, jamais branché sur la valeur réelle.
- Aucune ligne d'élevage n'était filtrée avant cette passe.

En creusant plus loin sur l'effet 800 lui-même : son `param3` vaut la
chaîne constante `"a"` (hex 10) sur les **80** familiers importés qui le
portent, du Chienchien au Wabbit, quel que soit le niveau — ce n'est donc
pas une valeur par familier, mais un drapeau. Le vrai nombre de PV retail
affiche vient d'un état d'élevage vivant que ce serveur ne simule pas, au
même titre que 806/807/808. Le décoder aurait affiché « Points de vie :
10 » identiquement sur *tous* les familiers du jeu, un résultat pire que
l'absence de ligne.

## Correctif

`item-effects.ts` : `rollItemEffects` exige maintenant que `param3` soit
une notation de dé (`/^\d+d\d+[+-]\d+$/`) en plus de `param2 > param1`
avant de tirer — sinon l'effet est copié tel quel. `inventory.frames.
service.ts` : `ItemEffectSchema.param3` décode `player_items.effects[].
param3` comme un entier hexadécimal nu (`/^[0-9a-fA-F]+$/`) quand ce n'est
pas une notation de dé, sinon `0`. `ItemDetailPanel.tsx` passe
`special: effect.param3` à `formatEffect` au lieu de `0`. `inventory-
theme.ts` : `HIDDEN_EFFECT_IDS = {800, 806, 807, 808}` filtre les quatre
lignes d'élevage/PV-familier avant rendu — 800 y est pour la raison ci-
dessus, pas par simple analogie avec 806-808.

Deux corrections attrapées en testant en jeu, dans le même passage :
- `characteristicIcon` : le cœur (`effect-0-life.svg`) est maintenant
  gardé par `characteristic ∈ {82, 99}` plutôt que par un id d'effet en
  dur (110) — 99 est la caractéristique de l'effet 800 lui-même.
- `isStatCharacteristic` (couleur verte des lignes) était d'abord une
  liste blanche de 10 caractéristiques ; testé en jeu, « +10 en
  initiative » (caractéristique 44, absente de la liste) restait en texte
  plat. Remplacée par une liste noire de 2 valeurs (82, 99 — les seules
  « vie », pas des caractéristiques permanentes) : tout le reste devient
  vert, ce qui couvre les dizaines de caractéristiques réellement
  présentes dans le jeu d'objets importé sans toutes les nommer.

## Reste à faire

`formatEffect` neutralise `#2` dès que `param1 === param2`, une règle
pensée pour les motifs `{~1~2 à}` (éviter « 22 à 22 ») mais qui casse tout
motif utilisant `#2` hors d'un tel groupe — trouvé sur l'effet 812
(« Résistance : #2 / #3 », très fréquent : 3639 objets importés) qui
affiche « Résistance : / 1 » au lieu de « Résistance : 1 / 1 » quand les
deux valeurs sont égales. `formatEffect` est partagé avec le livre de
sorts ; le corriger sans risquer une régression y demande d'auditer si un
sort dépend de ce comportement. Pas fait dans cette passe.

## Vérification

`bun test src/core/modules/inventory/` (40 passent, dont les nouveaux cas
800/983/812 de `item-effects.spec.ts`). Testé à la main dans le client web
le 2026-08-23 après re-seed : le Pioute bleu conserve `param1=5,
param2=72` sur l'effet 800 après plusieurs re-seeds (avant : une valeur
aléatoire différente à chaque fois) ; sa fiche affiche uniquement « Lié au
compte » (800/806/807/808 filtrés) ; le Chienchien affiche uniquement
« +20 en sagesse » en vert (son template ne porte pas l'effet 983 — ce
n'est pas une régression de cette passe, la donnée retail bind ses objets
à la création, hors périmètre) ; « +10 en initiative » sur l'Épée de
l'initié est vert.
