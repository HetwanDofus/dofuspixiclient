# QA — rapport de session

Journal des sessions de test exploratoire du client, tenues manette en main
(login → monde → interactions → combat). Ce fichier garde ce qui vaut pour la
session dans son ensemble : la synthèse, les causes racines, ce qui n'a pas pu
être testé et les pièges de méthode.

**Le détail entrée par entrée vit dans [issues/](issues/)** — une fiche par
défaut, classée par domaine, avec sa gravité et son statut. Voir
[issues/README.md](issues/README.md) pour le fonctionnement du suivi et l'index
à jour.

---

## Session 1 — 2026-08-20

**Environnement** : Chrome (WebGPU), Vite dev `:5173`, gateway/authd/gamed en
Docker, compte `dev`.

### Synthèse

57 entrées : 4 en P0, 15 en P1, 21 en P2, 14 en P3, plus trois vérifications
sans défaut. Le parcours login → serveur → personnage → monde fonctionne de
bout en bout, le rendu tient 72 fps en toutes circonstances, le changement de
map, le pathfinding et le déplacement sont solides, et le mode tactique est de
belle qualité.

Ce qui manque n'est presque jamais du moteur : c'est du **câblage** et des
**données**.

### Les trois causes racines

Elles expliquent la majorité des symptômes relevés.

1. **Les données de contenu ne sont pas importées.** `monster_templates`,
   `npc_templates` et `item_templates` étaient à zéro ligne, alors que `maps`
   (9 358) et `spell_levels` (10 632) sont peuplées. D'où : monde désert,
   inventaire structurellement vide, combat intestable.
   → [QA-034](issues/world-content/QA-034-aucun-monstre-sur-aucune-map.md),
   [QA-035](issues/world-content/QA-035-aucun-pnj-aucun-objet-en-base.md).
   *Traité depuis par `just import-content` ; les monstres se posent, les objets
   et PNJ attendent leur câblage côté serveur.*

2. **Les panneaux HUD sont des maquettes.** Sept panneaux sur huit ne s'abonnent
   à aucun store ; les données arrivent bien du serveur et vivent dans les
   stores, mais rien ne les lit.
   → [QA-037](issues/hud-panels/QA-037-panneaux-hud-sont-des-maquettes.md), et
   par ricochet QA-010, QA-013, QA-017.

3. **Le gateway restait bloqué en mode buffering** après toute reconnexion au
   core, ce qui gelait silencieusement la partie.
   → [QA-048](issues/session/QA-048-gateway-bloque-en-buffering.md),
   [QA-046](issues/session/QA-046-session-zombie-apres-redemarrage-core.md).
   *Corrigé le 2026-08-20 ; reste à repasser le parcours joueur pour clore.*

### Ce qui frappe le plus manette en main

Au-delà des bloquants, quatre absences se remarquent dans les dix premières
secondes de jeu : les personnages sont **totalement figés** (aucune animation
d'attente, QA-025), **rien ne réagit au survol** d'une cellule (QA-049), la
bannière **n'affiche ni PA ni PM** (QA-005), et un **overlay de debug FPS**
trône en permanence en haut de l'écran (QA-003).

### Fonctionnalités écrites mais livrées mortes

C'est le motif dominant du projet, et il porte son propre type dans le suivi
(`type: gap`). Le mode tactique (QA-043) est entièrement implémenté et rend très
bien quand on l'appelle à la main, mais aucun bouton ne l'active. Même schéma
pour le chat latéral, invisible sur la plupart des résolutions et sans
déclencheur (QA-022), pour les boutons utilitaires de la bannière (QA-052), et
pour les réglages audio que personne n'appelle (QA-056).

### Ce qui va bien

L'**audio** tourne de bout en bout — musique, ambiance et bruits aléatoires,
avec fondu (QA-055). Login (PBKDF2 compris) en ~1,6 s ; sélection serveur et
personnage sans accroc ; rendu à 72 fps au repos, grille affichée, zoom ×4 et
panneau ouvert ; cinq changements de map enchaînés sans erreur console ni
requête en échec ; pathfinding et orientation du sprite corrects ; marche/course
choisies sur la longueur du trajet, conformément au 1.29 ; carte du monde
lisible et complète ; minimap correctement rafraîchie ; interface traduite en
français à quelques chaînes près.

### Ce qui n'a pas pu être testé

**Le combat, entièrement** — le cœur de Dofus et la plus grosse lacune de la
session. Le détail des deux verrous, l'état de chacun et la marche à suivre pour
amorcer un premier combat sont dans
[QA-058](issues/fight/QA-058-combat-jamais-teste.md).

### Notes de méthode — deux faux positifs écartés

Consignés parce que le piège se retend facilement.

**FPS.** Les premières mesures de la session (7 à 23 fps) étaient **fausses** :
la fenêtre Chrome pilotée était en arrière-plan
(`document.visibilityState === "hidden"`), ce qui fait throttler
`requestAnimationFrame`. Toute mesure de framerate doit être précédée d'un
`Page.bringToFront` et d'une vérification de `document.visibilityState`. Après
correction, toutes les configurations testées tiennent le plafond d'affichage :

| Scénario | FPS |
|---|---|
| Repos, 1 acteur | 72 |
| Grille isométrique affichée | 72 |
| Zoom ×4 | 72 |
| Panneau Inventaire ouvert | 72 |

Le rendu n'est donc pas un problème sur cette charge — une map, un acteur, aucun
combat. À re-mesurer sous charge de combat (QA-058).

**Audio.** J'ai d'abord conclu à tort que rien ne jouait, sur la foi d'un
`document.querySelectorAll("audio")` vide — or `new Audio(url)` ne crée aucun
élément dans le DOM. Il faut instrumenter le constructeur `Audio`, et
l'installer **avant** le premier chargement de map.

### Note sur la sévérité de deux entrées

QA-047 (clic hors zone de map ignoré) et QA-054 (la boussole affiche bien un
extrait de carte) étaient étiquetées `P3` alors qu'elles ne constatent aucun
défaut. Elles sont désormais `severity: none` / `type: check` : des
vérifications faites, gardées parce qu'elles disent ce qui a déjà été regardé.
