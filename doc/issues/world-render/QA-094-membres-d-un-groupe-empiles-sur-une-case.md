---
id: QA-094
title: Les membres d'un groupe de monstres sont empilés sur une seule case
severity: P2
domain: world-render
type: bug
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-096, QA-095]
files:
  - apps/electrobun/src/game/scene/battlefield/world-actors.ts
  - apps/electrobun/src/game/scene/player/renderer.ts
  - apps/electrobun/src/game/scene/player/types.ts
  - apps/electrobun/src/hud/world/MonsterGroupTooltip.tsx
---

## Symptôme

Un groupe de huit monstres se lit comme trois ou quatre sprites : on n'arrive
pas à compter les monstres à l'écran, et le compte ne correspond pas à celui du
combat.

Le panneau de survol ne permet pas de recouper : sur un groupe de trois pious
(deux violets, un bleu) il affichait **deux lignes**, `Piou Violet (2)` puis
`Piou Bleu`.

## Attendu (1.29)

Sous l'option `ViewAllMonsterInGroup`, chaque membre non-leader est un
**sprite lié** posé sur une **case adjacente** à celle du groupe —
`addLinkedSprite(id, parent, childIndex, data)` puis
`Pathfinding.getArroundCellNum(cellNum, direction, childIndex)`
(`GameIn.as:232-274`, `SpriteHandler.as:114-122`). Les huit `childIndex`
couvrent les huit cases autour du groupe, donc un groupe plein ne se recouvre
jamais.

## Cause

Deux causes indépendantes pour un seul symptôme, « je ne sais pas combien il y
en a ».

**Le panneau.** Il dédupliquait les membres par nom et suffixait un compte.
Or en 1.29 le nombre entre parenthèses est **le niveau**, pas un compte
(`MonsterGroup.getName` : `name + " (" + level + ")"`, une ligne par membre,
tri par niveau décroissant). `Piou Violet (2)` se lisait donc « un piou violet
de niveau 2 », et un groupe de trois passait pour un groupe de deux.

**Les sprites.** `spawnGroupSiblings` peignait chaque membre sur **la case du leader** avec un
décalage en pixels de ±16 à ±40 px, pour une empreinte de sprite d'environ
50 px : les monstres se recouvraient à ~70 %.

Trois défauts annexes du même code :

- le look d'un enfant lié était construit sans les couleurs
  (`look: \`${child.gfxId}\``), ce qui, combiné à [QA-096](../world-content/QA-096-couleurs-des-monstres-importees-en-decimal.md),
  rendait tous les membres identiques ;
- `pixelOffset` n'était pas conservé sur `ActivePlayer`, donc n'importe quel
  téléport ou `GM UPDATE` ramenait toute la pile sur un seul point ;
- les ids d'enfants étaient dérivés du parent (`leaderId * 10000 - i`) alors que
  `nextGroupId` est un compteur global jamais remis à zéro : au millième groupe
  d'une session, ces ids tombaient dans l'espace des combattants monstres
  (à partir de -1 000 000) et `addPlayer` fondait silencieusement deux sprites
  en un.

## Correctif

Le panneau revient au canonique : une ligne par membre, `Nom (niveau)`, triée
par niveau décroissant. Compter les lignes redevient la façon de compter le
groupe.

Pour les sprites, le mécanisme canonique existait déjà côté client et n'était utilisé par personne
— `PlayerRenderer.loadWithLinkedChildren` et `PlayerMovement.aroundCell`, dont
la table `[2,6,4,0,3,5,1,7]` est la transcription exacte de l'AS2. Les membres
d'un groupe passent par lui ; `spawnGroupSiblings` et `pixelOffset` disparaissent.

Les enfants liés transportent désormais leur triplet de couleurs, et leurs ids
viennent d'un compteur privé au renderer, sous tout ce que le serveur peut
émettre.

Le leader est aussi devenu déterministe : `buildMembers` trie les membres par
niveau décroissant, si bien que le sprite mis en avant est celui que le panneau
de survol nomme en premier (il triait déjà ainsi, d'après
`MonsterGroup.getName`).

## Vérification

Vérifié en session sur un groupe de trois pious : trois sprites sur trois cases
distinctes (deux violets rendus violets, un bleu), et le panneau affiche
`Piou Violet (4)` / `Piou Violet (1)` / `Piou Bleu (1)` — trois lignes, dont les
niveaux somment au « Niveau 6 » du titre.
