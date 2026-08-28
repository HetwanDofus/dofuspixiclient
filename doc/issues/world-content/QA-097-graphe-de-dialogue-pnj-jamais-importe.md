---
id: QA-097
title: Le graphe de dialogue des PNJ est dans le dump mais rien ne l'importe
severity: P1
domain: world-content
type: gap
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-035, QA-093, QA-098]
files:
  - apps/gameserver-ts/migrations/0052_npc_dialog_graph.ts
  - apps/gameserver-ts/scripts/import-starloco-content.ts
  - apps/gameserver-ts/src/core/shared/db/schema.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.repository.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.service.ts
---

## Symptôme

`npc_dialog_questions` et `npc_dialog_responses` sont vides — 0 ligne — alors
que `game.sql` porte l'arbre complet : `npc_questions` (5 668 lignes) et
`npc_reponses_actions` (5 326). 636 des 763 templates ont un `initQuestion`, et
562 des 632 PNJ posés sur une map ont donc quelque chose à dire que personne ne
lit.

## Attendu (1.29)

Le serveur envoie `DQ<questionId>;<params>|<r1;r2>` et le client résout les
textes contre son propre bundle `dialog` — l'id de question *est* la clé
(`Question.initialize` → `api.lang.getDialogQuestionText(id)`,
`dofus/datacenter/Question.as:24-40`). Il faut donc les ids et les liens, pas le
texte.

## Cause

Deux choses distinctes.

L'importeur ne lisait aucune des deux tables du dump.

Et le schéma posé par la migration 0002 ne pouvait pas les accueillir : il
datait d'avant la lecture du dump. `npc_dialog_responses.action` est une colonne
unique alors que `npc_reponses_actions` a une clé `(ID, type)` et que **181
réponses portent plusieurs actions** ; les deux tables portaient un `text_id`
distinct de `id` qui ne désigne rien ; et une réponse n'a aucun attribut propre
au-delà de ses actions, son texte étant dans le bundle.

## Correctif

Migration 0052 : les deux tables sont remplacées (elles étaient vides, rien à
migrer) par `npc_dialog_questions (id, response_ids, parameters, cond,
if_false)` et `npc_dialog_response_actions (response_id, type, args)` en clé
composite. `cond` et `if_false` sont importés mais pas évalués — 55 questions
portent une condition sur un état de guilde ou de quête que ce serveur ne
modélise pas encore.

`NpcDialogService` charge les deux tables une fois : c'est du contenu statique,
écrit par `just import-content` et par rien d'autre.

La règle de classement d'une réponse est stricte et vaut d'être notée. Le type 1
est 92 % de la table, et son `args` est soit un id de question (858 lignes) soit
le littéral `DV` (4 046 lignes, « terminer la discussion »). Une réponse n'est
suivie que si la navigation est **tout** ce qu'elle fait : une réponse qui
branche *et* donne un objet est bloquée, parce que la suivre sauterait
silencieusement l'objet.

Corrigé au passage : `initialQuestion` passait par `Math.max(0, num())`, qui
rend 0 sur les 17 templates dont l'`initQuestion` est une liste de racines
candidates. On prend maintenant le premier id.

## Ce que le dump contient réellement

À noter avant de conclure à un bug d'affichage : **la plupart des conversations
de ce dump font un seul échange**. Sur les 561 PNJ posés qui ont un arbre :

| | PNJ |
|---|---|
| branchent (deux échanges ou plus) | 219 |
| une réplique, puis des réponses qui **ferment** | 99 |
| une réplique, aucune réponse | 243 |

Le cas typique est *Snori Nairb* (map 7411, question 6169) : sa réponse 6023
s'intitule « Demander comment redevenir Neutre. » mais la ligne du dump est
`(6023, 1, 'DV', ...)` — le libellé annonce une suite que StarLoco n'a jamais
câblée. Fermer est le comportement fidèle ; le trou est dans la donnée.

*Kana Petch* (map 7365, question 2391) est le contre-exemple : deux de ses
réponses branchent réellement.

Autre trou : **44 des 901 réponses atteignables n'ont aucun texte dans le
bundle** — l'id 23016 de Snori Nairb n'a ni texte ni ligne d'action. Le client
les retire au lieu de les griser : une ligne illisible ne propose pas un choix,
elle en simule un.

## Vérification

```
select count(*) from npc_dialog_questions;         -- 5667
select count(*) from npc_dialog_response_actions;  -- 5326
select count(*) from npc_templates where initial_question > 0;  -- 636
```

`bun test src/core/modules/npcs/npc-dialog.service.spec.ts` — six cas de
classement, écrits sur des lignes réelles du dump (Kana Petch 2013/2037,
Unkouy Nak 191).
