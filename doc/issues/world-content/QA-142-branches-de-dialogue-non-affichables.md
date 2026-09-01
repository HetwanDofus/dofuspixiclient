---
id: QA-142
title: Des branches de dialogue mènent à des questions que le client 1.29 ne sait pas afficher
severity: P2
domain: world-content
type: data
status: confirmed
session: 7
opened: 2026-09-01
closed:
fixed_in:
related: [QA-097, QA-130]
files:
  - apps/gameserver-ts/scripts/import-starloco-content.ts
  - apps/electrobun/src/game/network/handlers/npc-dialog.handler.ts
---

## Symptôme

Emia Elliesol, à l'atelier paysan d'Astrub [7,-25], propose « Se renseigner
sur le métier de Paysan ». On clique, et la fenêtre affiche **un titre, un
corps vide, et une seule entrée : « Terminer la discussion. »** L'apprentissage
n'est jamais proposé.

Sa branche est pourtant intacte côté serveur :

```
question 2342 → réponse 1948 → question 9255 → réponse 9655 (action 6, Paysan)
```

Ce qui manque est le **texte** :

| Élément | Dans `dialog.json` (1.29) |
|---|---|
| question 2342 | oui |
| réponse 1948 | oui — « Se renseigner sur le métier de Paysan » |
| question 9255 | **non** |
| réponse 9655 | **non** |

`buildAnswers` jette toute réponse sans libellé (« has no bundle text —
dropping it ») parce qu'une entrée sans texte n'est pas affichable ; la
question, elle, s'affiche vide. Le joueur se retrouve dans un cul-de-sac.

## Cause

Le dump StarLoco est un serveur **1.39** et le bundle de langue est extrait du
client **1.29**. Le graphe importé contient donc des identifiants de dialogue
que le bundle ne connaît pas — 9255 et 9655 sont des ids hauts, postérieurs au
1.29. `import-starloco-content.ts` importe le graphe tel quel, sans le
confronter au bundle, alors que la règle affichée en tête des trois importeurs
est que **les bundles 1.29 gagnent partout où ils ont une entrée**.

## Portée

Relevé sur les 40 réponses « Apprendre le métier de … », en marchant l'arbre
de chaque PNJ et en n'empruntant que les questions et réponses réellement
affichables :

- **17 métiers sur 19 ont un maître joignable.** La liste est dans QA-130.
- **Alchimiste** : la question 631 porte l'apprentissage, elle a son texte, et
  **aucune réponse du jeu n'y navigue** ni aucun PNJ ne l'ouvre. Orpheline.
- **Pêcheur** : la réponse 1129 n'appartient à **aucune question**, et l'autre
  chemin (3186 → 3600) part d'une question 3597 qu'aucun PNJ n'ouvre.

Ce sont deux métiers de récolte : sans correctif, ils ne peuvent pas être
appris en jeu, quoi que fasse le système de métiers.

Le défaut n'est pas propre aux métiers — il touche potentiellement toute
branche du graphe — mais c'est là qu'il a été trouvé, parce que c'est là qu'on
a marché un arbre de bout en bout pour la première fois.

## Correctif

Deux pistes, la première étant celle qui suit la règle du dépôt :

1. **À l'import**, écarter les questions et les réponses absentes du bundle,
   et propager : une réponse qui ne navigue plus que vers une question écartée
   est elle-même à écarter. Emia dirait alors « Terminer la discussion. » dès
   la première bulle — honnête, plutôt qu'un cul-de-sac. Le décompte des
   rejets par raison dira l'ampleur exacte.
2. **Pour Alchimiste et Pêcheur**, rattacher l'apprentissage à un PNJ. Le 1.29
   les enseigne (le contremaître d'Incarnam, entre autres) ; le dump ne porte
   pas ce lien sous une forme exploitable.

## Vérification

- Un compte des questions et réponses importées sans texte dans le bundle,
  avant et après.
- En jeu : Emia Elliesol ne propose plus de branche morte ; Farle Ingalsse
  [5,6] enseigne toujours Paysan.
- Le script de marche d'arbre relève 19 métiers joignables sur 19.
