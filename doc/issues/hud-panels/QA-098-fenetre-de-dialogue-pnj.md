---
id: QA-098
title: Parler à un PNJ n'ouvre aucune fenêtre de dialogue
severity: P1
domain: hud-panels
type: feature
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-093, QA-097]
files:
  - proto/chat.proto
  - proto/client_messages.proto
  - apps/gameserver-ts/src/core/features/game/npc-dialog/npc-dialog.handler.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.session.ts
  - apps/electrobun/src/game/lang/dialog-lang.ts
  - apps/electrobun/src/game/network/handlers/npc-dialog.handler.ts
  - apps/electrobun/src/game/stores/npc-dialog-store.ts
  - apps/electrobun/src/hud/npc/NpcDialog.tsx
  - apps/electrobun/src/game/scene/battlefield/picking.ts
---

## Symptôme

Depuis [QA-093](../world-content/QA-093-pnj-importes-jamais-envoyes-au-client.md)
la bulle d'action s'ouvre au clic sur un PNJ, mais « Parler » est grisée comme
les sept autres entrées. Rien ne se passe : le PNJ le plus bavard d'Astrub est
muet.

## Attendu (1.29)

`NonPlayableCharacter.getActionFunction(3)` → `GameManager.startDialog` →
`DC<spriteId>`. Le serveur répond `DC`, le client ouvre `NpcDialog` : le grand
artwork du PNJ à gauche, son nom en barre de titre, puis `DQ` porte la question
et la liste des réponses. `DR<questionId>|<responseId>` renvoie le choix, `DV`
ferme.

`QuestionViewer.layoutContent` a une règle qui n'est pas une coquetterie : une
question **de suite** sans réponse reçoit une entrée unique synthétisée,
`CONTINUE_TO_SPEAK` = « Terminer la discussion. », id `-1`. La question
**d'ouverture** sans réponse n'en reçoit pas — un PNJ d'une seule réplique se
ferme à la croix, ce qui le fait lire comme une remarque et non comme une
conversation.

## Cause

Rien n'était implémenté. Le protobuf portait déjà `DialogCreate`,
`DialogQuestion`, `DialogLeave` et `DialogPause` (2700-2704), mais aucun
producteur ni consommateur, et il manquait les requêtes client `DC` et `DR`.

## Correctif

Trois champs manquaient au protocole. `DialogQuestion` n'avait pas les ids de
réponse alors que la trame canonique les porte (`DQ<qid>;<params>|<r1;r2>`,
`Dialog.onQuestion` les lit) ; ils sont ajoutés, avec
`unavailable_response_ids`, le sous-ensemble à griser. Et `DialogCreate` porte
maintenant le portrait : le client ne peut pas le déduire du sprite parce que
`custom_artwork` ne voyage pas dans `SpriteMovementEntry`.

Le serveur n'envoie que des ids, jamais de texte — le bundle `dialog.json` fait
1,5 Mo et le client l'a déjà.

Validation côté serveur, dans cet ordre : le sprite doit être un PNJ **de la map
courante du joueur** (c'est tout le contrôle d'accès), le joueur ne doit pas
être en combat, et une réponse est refusée si elle n'appartient pas à la
question réellement ouverte. Sans ce dernier point un client peut parcourir
l'arbre de l'extérieur, ce qui comptera le jour où une réponse fera autre chose
que naviguer.

Le portrait ne demandait aucun code neuf : `FighterPortraitRenderer.getCanvas`
lit déjà `artworks/big/<gfx>.dofasset` avec les zones de couleur, et 617 des 632
PNJ posés ont leur artwork. `CharacterPortrait` est monté tel quel.

Les sept actions de commerce restent grisées : elles supposent le protocole
d'échange complet, une UI de liste d'objets et les écritures kamas/inventaire.

## Vérification

`bun test src/core/features/game/npc-dialog/` — 11 cas, dont le refus d'une
réponse hors question, le refus en combat, et le fait qu'une réponse bloquée ne
ferme **pas** le dialogue (fermer se lirait comme « l'objet a été remis »).

`bun test src/hud/npc/` — 4 cas sur la synthèse de « Terminer la discussion. »,
dont l'asymétrie première question / question de suite.

En jeu, map 7365, *Kana Petch* : trois réponses, deux branches (2013 → 2394,
2011 → 1169) et une grisée (2037, action de type 988).
