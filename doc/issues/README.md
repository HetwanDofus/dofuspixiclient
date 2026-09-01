# Suivi des issues

Une issue = **un fichier**. Le dossier porte le **domaine**, le frontmatter porte
la **gravité** et le **statut**. Le domaine ne change presque jamais, la gravité
et le statut changent tout le temps : c'est pourquoi seuls les seconds vivent
dans le frontmatter — refermer un bug ou le re-trier ne déplace aucun fichier et
ne casse aucun lien.

Tout ce qui suit le marqueur plus bas est **généré** par `just issues` depuis les
frontmatter. Ne pas l'éditer à la main.

## Cycle de vie

```
open ──▶ confirmed ──▶ in-progress ──▶ fixed ──▶ closed
  reproduit           correctif        correctif   vérifié
  avec preuve         engagé           livré       manette en main
        │
        └──▶ wontfix (raison en fiche)
```

`fixed` ≠ `closed` : un correctif livré et couvert par des tests reste `fixed`
tant que le parcours joueur n'a pas été rejoué. C'est exactement l'état de
QA-046, QA-048 et QA-057.

## Ouvrir une entrée

```bash
cp doc/issues/_template.md doc/issues/<domaine>/QA-0NN-<slug>.md
$EDITOR doc/issues/<domaine>/QA-0NN-<slug>.md
just issues            # régénère l'index de ce fichier
```

Le numéro suit la séquence unique `QA-0NN`, sans repartir de zéro par type — les
commits existants référencent déjà QA-046, QA-048 et QA-057. Le champ `type`
distingue un défaut d'une fonctionnalité.

## Champs

| Champ | Valeurs | Rôle |
|---|---|---|
| `id` | `QA-0NN` | unique, immuable, cité dans les messages de commit |
| `severity` | `P0` `P1` `P2` `P3` `none` | `none` pour une vérification sans défaut |
| `domain` | = nom du dossier | vérifié par `just issues-check` |
| `type` | `bug` `gap` `feature` `data` `test-gap` `check` | voir ci-dessous |
| `status` | voir le cycle de vie | |
| `session` | numéro de session de test | d'où vient l'observation |
| `opened` / `closed` | `AAAA-MM-JJ` | `closed` obligatoire si `closed`/`wontfix` |
| `fixed_in` | sha de commit ou n° de PR | |
| `related` | `[QA-0NN, …]` | les ids doivent exister |
| `files` | chemins, `fichier.ts:ligne` accepté | où regarder |

**`gap` plutôt que `bug`** quand le code existe et n'est branché à rien : mode
tactique sans bouton (QA-043), chat de bannière sans `onChange` (QA-020),
`AudioManager` que personne n'appelle (QA-056). C'est la catégorie la plus
peuplée du projet, et elle appelle un travail très différent d'un vrai défaut —
du câblage, pas du débogage.

**`check`** est une vérification faite qui n'a rien trouvé (QA-047, QA-054,
QA-055). On les garde : elles disent ce qui a déjà été regardé.

## Corps de fiche

`## Symptôme` (le relevé, pas la théorie) · `## Attendu (1.29)` ·
`## Cause` · `## Correctif` · `## Vérification`. On omet les sections vides.

Les sections optionnelles vues à l'usage : `## Portée`, `## Décision à prendre`,
`## Hors périmètre`, `## Reste à faire`.

Règle héritée de la session 1 : **on note ce qui a été observé, pas ce que le
code laisse supposer.** Un comptage, un log littéral ou une mesure valent mieux
qu'une description.

## Outillage

```bash
just issues         # régénère l'index de ce fichier
just issues-check   # valide sans écrire — ids uniques, enums légaux,
                    # domain == dossier, related résolus, index à jour
```

`issues-check` sort en code 1 : utilisable en CI ou en pre-commit.

## Contexte

Ces 58 entrées viennent de la session de test exploratoire du 2026-08-20,
racontée dans [qa-findings.md](../qa-findings.md) — qui garde la synthèse, les
causes racines et les notes de méthode, mais plus le détail par entrée.

<!-- issues:start -->

_Généré par `just issues` — ne pas éditer à la main entre les marqueurs._

**142 entrées**, dont **138 encore ouvertes**.

## Par gravité

| Gravité | Restantes | Total |
|---|---|---|
| P0 — bloque la session (crash, impossible d'avancer) | 4 | 4 |
| P1 — fonctionnalité cassée ou absente sur un flux principal | 58 | 58 |
| P2 — comportement divergent du 1.29 canonique, contournable | 54 | 54 |
| P3 — finition, confort, cosmétique | 22 | 23 |
| Sans gravité — vérifications sans défaut | 0 | 3 |

## Par statut

| Statut | Entrées |
|---|---|
| `open` — observé, non reproduit méthodiquement | 45 |
| `confirmed` — reproduit, preuve au dossier | 19 |
| `in-progress` — correctif engagé | 19 |
| `fixed` — correctif livré, reste à revérifier manette en main | 55 |
| `closed` — vérifié, clos | 3 |
| `wontfix` — écarté, avec la raison en fiche | 1 |

## Par domaine

| Domaine | Restantes | Total |
|---|---|---|
| [`audio/`](audio/) | 0 | 1 |
| [`auth/`](auth/) | 3 | 3 |
| [`camera-zoom/`](camera-zoom/) | 3 | 3 |
| [`chat/`](chat/) | 5 | 5 |
| [`exchange/`](exchange/) | 20 | 20 |
| [`fight/`](fight/) | 14 | 14 |
| [`hud-banner/`](hud-banner/) | 9 | 9 |
| [`hud-panels/`](hud-panels/) | 17 | 18 |
| [`input/`](input/) | 4 | 5 |
| [`inventory/`](inventory/) | 4 | 4 |
| [`network/`](network/) | 9 | 9 |
| [`progression/`](progression/) | 10 | 10 |
| [`server-runtime/`](server-runtime/) | 8 | 8 |
| [`session/`](session/) | 3 | 3 |
| [`world-content/`](world-content/) | 11 | 11 |
| [`world-render/`](world-render/) | 10 | 10 |
| [`worldmap/`](worldmap/) | 8 | 9 |

## P0 — bloque la session (crash, impossible d'avancer)

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-034](world-content/QA-034-aucun-monstre-sur-aucune-map.md) | P0 | world-content | data | fixed | Aucun monstre ne se pose sur aucune map |
| [QA-035](world-content/QA-035-aucun-pnj-aucun-objet-en-base.md) | P0 | world-content | data | in-progress | Aucun PNJ, aucun objet en base |
| [QA-037](hud-panels/QA-037-panneaux-hud-sont-des-maquettes.md) | P0 | hud-panels | gap | confirmed | Sept des huit panneaux HUD sont des maquettes statiques |
| [QA-048](session/QA-048-gateway-bloque-en-buffering.md) | P0 | session | bug | fixed | Le gateway ne sort jamais du mode buffering après une reconnexion au core |

## P1 — fonctionnalité cassée ou absente sur un flux principal

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-003](hud-banner/QA-003-overlay-fps-debug-permanent.md) | P1 | hud-banner | bug | open | Overlay FPS de debug affiché en permanence, sans toggle |
| [QA-005](hud-banner/QA-005-pa-pm-absents-de-la-banniere.md) | P1 | hud-banner | gap | open | PA / PM absents de la bannière |
| [QA-010](hud-panels/QA-010-personnage-sans-sort.md) | P1 | hud-panels | gap | open | Le personnage n'a aucun sort |
| [QA-012](hud-panels/QA-012-panneaux-tronques-sous-la-banniere.md) | P1 | hud-panels | bug | open | Les panneaux débordent sous la bannière et sont tronqués |
| [QA-020](chat/QA-020-champ-de-chat-de-la-banniere-mort.md) | P1 | chat | gap | confirmed | Le champ de chat de la bannière n'est branché à rien |
| [QA-022](chat/QA-022-chat-lateral-invisible.md) | P1 | chat | bug | open | Le chat latéral est invisible sur la plupart des résolutions |
| [QA-025](world-render/QA-025-aucune-animation-d-attente.md) | P1 | world-render | gap | confirmed | Les personnages n'ont aucune animation d'attente |
| [QA-036](world-content/QA-036-personnage-possede-tous-les-sorts.md) | P1 | world-content | data | fixed | Le personnage possède les 2 091 sorts du jeu |
| [QA-041](camera-zoom/QA-041-atlas-gpu-512mo-realloue-a-chaque-zoom.md) | P1 | camera-zoom | bug | confirmed | Un atlas GPU de 512 Mo est réalloué à chaque changement de zoom, et jamais utilisé |
| [QA-043](fight/QA-043-mode-tactique-sans-declencheur.md) | P1 | fight | gap | confirmed | Le mode tactique n'a aucun déclencheur dans l'interface |
| [QA-046](session/QA-046-session-zombie-apres-redemarrage-core.md) | P1 | session | bug | fixed | Session zombie après un redémarrage du core : aucun retour utilisateur |
| [QA-049](world-render/QA-049-aucun-retour-visuel-au-survol.md) | P1 | world-render | gap | confirmed | Aucun retour visuel au survol d'une cellule |
| [QA-050](world-render/QA-050-objets-interactifs-non-cliquables.md) | P1 | world-render | gap | fixed | 194 objets interactifs chargés sur la map, aucun n'est cliquable |
| [QA-057](session/QA-057-double-connexion-du-meme-compte.md) | P1 | session | bug | fixed | Un même compte pouvait ouvrir autant de fenêtres qu'il voulait |
| [QA-058](fight/QA-058-combat-jamais-teste.md) | P1 | fight | test-gap | in-progress | Le combat est jouable mais non finalisé |
| [QA-059](fight/QA-059-aucun-xp-ni-kamas-en-fin-de-combat.md) | P1 | fight | bug | in-progress | XP et kamas toujours nuls en fin de combat |
| [QA-060](fight/QA-060-aucun-butin-d-objets-en-fin-de-combat.md) | P1 | fight | gap | in-progress | Aucun butin d'objets en fin de combat |
| [QA-061](fight/QA-061-glyphes-ne-touchent-que-la-case-centrale.md) | P1 | fight | bug | in-progress | Les glyphes ne touchent que leur case centrale, la zone est ignorée |
| [QA-062](fight/QA-062-glyphes-et-pieges-degats-neutres.md) | P1 | fight | bug | in-progress | Glyphes et pièges : dégâts neutres, calculés sur l'effet enveloppe |
| [QA-063](progression/QA-063-aucune-regeneration-de-vie-hors-combat.md) | P1 | progression | gap | in-progress | Aucune régénération de vie hors combat |
| [QA-064](server-runtime/QA-064-aucune-limitation-de-debit.md) | P1 | server-runtime | gap | confirmed | Aucune limitation de débit sur les messages entrants |
| [QA-065](network/QA-065-vitesse-de-deplacement-non-verifiee.md) | P1 | network | gap | confirmed | La vitesse de déplacement n'est pas vérifiée côté serveur |
| [QA-066](server-runtime/QA-066-combats-perdus-au-redemarrage-du-core.md) | P1 | server-runtime | gap | confirmed | Combats et groupes de monstres sont perdus à chaque redémarrage du core |
| [QA-068](network/QA-068-aucune-resynchronisation-d-etat-de-map.md) | P1 | network | gap | confirmed | Aucune resynchronisation d'état de map — une trame perdue est définitive |
| [QA-069](fight/QA-069-combattant-fantome-a-la-deconnexion.md) | P1 | fight | bug | confirmed | Une session qui se ferme en plein combat laisse un combattant fantôme |
| [QA-070](progression/QA-070-vie-jamais-persistee-apres-un-combat.md) | P1 | progression | gap | in-progress | Les PV restants ne sont jamais écrits en base après un combat |
| [QA-076](inventory/QA-076-positions-equipement-fausses.md) | P1 | inventory | bug | fixed | La table des positions d'équipement était fausse, dans trois fichiers différents |
| [QA-079](inventory/QA-079-familier-mal-gere.md) | P1 | inventory | bug | fixed | Le familier était mal géré — jet sur des effets non aléatoires, #3 jamais transmis |
| [QA-080](world-render/QA-080-viewbox-des-svg-hors-cadre.md) | P1 | world-render | bug | fixed | Le recadrage de l'extracteur coupe tout dessin miroir ou pivoté hors de son viewBox |
| [QA-083](progression/QA-083-aucun-sort-appris-en-montant-de-niveau.md) | P1 | progression | gap | fixed | Aucun sort n'est appris en montant de niveau, et un combat ne fait gagner qu'un seul niveau |
| [QA-084](world-content/QA-084-cellules-scriptees-jamais-importees.md) | P1 | world-content | data | fixed | Aucune cellule scriptée n'est importée — banque, boutiques et donjons inaccessibles |
| [QA-085](network/QA-085-aucun-protocole-d-objet-interactif.md) | P1 | network | gap | fixed | Aucun protocole d'utilisation d'objet interactif — portes, zaaps et coffres inertes |
| [QA-088](world-render/QA-088-largeur-de-carte-perimee-apres-changement.md) | P1 | world-render | bug | fixed | Les acteurs ignorent le recentrage de la carte — décalés hors du décor sur toute carte non 15x17 |
| [QA-089](input/QA-089-identifiants-de-picking-recycles-apres-changement-de-carte.md) | P1 | input | bug | fixed | Après un changement de carte, cliquer un élément ouvre le menu d'un acteur de la carte précédente |
| [QA-090](inventory/QA-090-equipement-visible-non-diffuse.md) | P1 | inventory | gap | fixed | Un changement d'équipement visible n'atteint aucun client avant le prochain changement de carte |
| [QA-093](world-content/QA-093-pnj-importes-jamais-envoyes-au-client.md) | P1 | world-content | gap | fixed | Les PNJ sont en base mais aucun ne parvient au client |
| [QA-095](fight/QA-095-combattants-sans-case-quand-le-bloc-de-placement-est-trop-petit.md) | P1 | fight | bug | fixed | Des combattants restent sans case quand le bloc de placement est plus petit que le groupe |
| [QA-096](world-content/QA-096-couleurs-des-monstres-importees-en-decimal.md) | P1 | world-content | data | fixed | Les couleurs des monstres sont lues en décimal alors que le dump les écrit en hexadécimal |
| [QA-097](world-content/QA-097-graphe-de-dialogue-pnj-jamais-importe.md) | P1 | world-content | gap | fixed | Le graphe de dialogue des PNJ est dans le dump mais rien ne l'importe |
| [QA-098](hud-panels/QA-098-fenetre-de-dialogue-pnj.md) | P1 | hud-panels | feature | fixed | Parler à un PNJ n'ouvre aucune fenêtre de dialogue |
| [QA-100](world-render/QA-100-vendeurs-hdv-reduits-a-un-fragment.md) | P1 | world-render | bug | fixed | Les vendeurs d'hôtel de vente sont invisibles — leur sprite ne contient qu'une pièce sur quatorze |
| [QA-101](exchange/QA-101-modele-d-objet-polymorphe.md) | P1 | exchange | feature | fixed | Un objet change d'identité à chaque déplacement — quatre tables de contenants, quatre séquences |
| [QA-102](exchange/QA-102-noyau-de-session-d-echange.md) | P1 | exchange | feature | fixed | Aucun noyau de session d'échange — ni état, ni verrou d'occupation, ni survie au redémarrage |
| [QA-107](exchange/QA-107-echange-entre-joueurs.md) | P1 | exchange | feature | fixed | Aucun échange entre joueurs |
| [QA-108](exchange/QA-108-hotel-de-vente.md) | P1 | exchange | feature | fixed | Hôtel de vente — les vendeurs sont posés, la table des lots ne correspond pas au protocole et n'est jamais alimentée |
| [QA-115](exchange/QA-115-aucun-test-anti-dupe.md) | P1 | exchange | test-gap | fixed | Aucun test ne couvre la duplication d'objets ni les courses sur un solde |
| [QA-116](exchange/QA-116-tableau-js-vers-jsonb.md) | P1 | exchange | bug | fixed | Un tableau JS passé à une colonne jsonb est encodé comme un tableau Postgres — les objets créés se dédoublent au lieu de se cumuler |
| [QA-117](exchange/QA-117-kamas-de-coffre-de-maison.md) | P1 | exchange | bug | fixed | Les kamas d'un coffre de maison ne se transfèrent pas — seuls le joueur et la banque étaient reconnus |
| [QA-118](exchange/QA-118-consulter-son-coffre-grise.md) | P1 | exchange | gap | fixed | « Consulter son coffre personnel » est grisé — une réponse ne pouvait porter qu'une navigation |
| [QA-123](progression/QA-123-boucle-de-recolte-inexistante.md) | P1 | progression | gap | fixed | La boucle de récolte n'existe pas de bout en bout |
| [QA-126](auth/QA-126-api-admin-de-provisionnement-de-comptes-absente.md) | P1 | auth | feature | fixed | L'API admin ne permet pas de provisionner un compte et son premier personnage |
| [QA-127](server-runtime/QA-127-planificateur-declenche-les-taches-lointaines-immediatement.md) | P1 | server-runtime | bug | fixed | Le planificateur déclenche immédiatement toute tâche à plus de 24,8 jours |
| [QA-129](progression/QA-129-referentiel-des-metiers-jamais-importe.md) | P1 | progression | data | fixed | Le référentiel des métiers n'est jamais importé — cinq tables vides depuis la migration 0011 |
| [QA-130](world-content/QA-130-aucun-pnj-n-enseigne-de-metier.md) | P1 | world-content | gap | in-progress | Aucun PNJ n'enseigne de métier — l'action de réponse 6 n'a pas de branche |
| [QA-131](network/QA-131-protocole-des-metiers-sans-producteur.md) | P1 | network | gap | in-progress | Le protocole des métiers n'a aucun producteur, et JobSkillEntry se trompe de champs |
| [QA-135](exchange/QA-135-aucun-atelier.md) | P1 | exchange | feature | fixed | Aucun atelier — l'échange de type 3 est refusé |
| [QA-136](progression/QA-136-cases-taux-et-xp-d-artisanat.md) | P1 | progression | gap | fixed | Cases de craft, taux de réussite et expérience d'artisanat n'existent pas |
| [QA-137](hud-panels/QA-137-pas-de-fenetre-d-atelier.md) | P1 | hud-panels | gap | in-progress | Pas de fenêtre d'atelier |

## P2 — comportement divergent du 1.29 canonique, contournable

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-001](auth/QA-001-ecran-login-hors-charte.md) | P2 | auth | bug | open | Écran de login générique, hors charte 1.29 et non traduit |
| [QA-006](hud-banner/QA-006-ni-xp-ni-pods-ni-energie.md) | P2 | hud-banner | gap | open | Ni barre d'XP, ni pods, ni énergie, ni nom/niveau en bannière |
| [QA-007](hud-banner/QA-007-slots-de-raccourcis-vides-et-inertes.md) | P2 | hud-banner | gap | fixed | Les 14 slots de raccourcis sont vides et inertes |
| [QA-009](worldmap/QA-009-marqueur-minimap-rectangle-rouge.md) | P2 | worldmap | bug | open | Marqueur de position de la minimap = rectangle rouge plein |
| [QA-013](hud-panels/QA-013-inventaire-450-pods-pour-zero-objet.md) | P2 | hud-panels | bug | fixed | Inventaire : 450/1000 pods pour zéro objet |
| [QA-014](hud-panels/QA-014-apercu-personnage-remplace-par-silhouette.md) | P2 | hud-panels | gap | open | Inventaire : aperçu du personnage remplacé par une silhouette |
| [QA-017](hud-panels/QA-017-panneau-guilde-sans-guilde.md) | P2 | hud-panels | bug | open | Le panneau Guilde s'ouvre avec des données pour un personnage sans guilde |
| [QA-018](hud-panels/QA-018-initiative-a-1.md) | P2 | hud-panels | bug | open | Initiative à 1 dans le panneau Caractéristiques |
| [QA-019](network/QA-019-game-actions-non-geres.md) | P2 | network | gap | open | Messages `gameActionsStart` / `gameActionsFinish` non gérés |
| [QA-021](chat/QA-021-deux-chats-concurrents.md) | P2 | chat | bug | open | Deux chats concurrents, dont un factice |
| [QA-026](world-render/QA-026-pas-de-nom-au-dessus-du-personnage.md) | P2 | world-render | gap | open | Pas de nom au-dessus du personnage |
| [QA-027](input/QA-027-menu-contextuel-en-anglais-non-conforme.md) | P2 | input | bug | open | Menu contextuel en anglais et non conforme |
| [QA-030](worldmap/QA-030-marqueur-carte-du-monde-rectangle-rouge.md) | P2 | worldmap | bug | open | Marqueur de position = rectangle rouge plein, sur la carte du monde aussi |
| [QA-033](worldmap/QA-033-clic-sur-la-carte-du-monde-sans-effet.md) | P2 | worldmap | gap | open | Cliquer une case de la carte du monde ne fait rien |
| [QA-038](input/QA-038-menu-contextuel-ne-se-ferme-jamais.md) | P2 | input | bug | open | Le menu contextuel ne se ferme jamais |
| [QA-039](camera-zoom/QA-039-zoom-molette-hors-1-29-et-trop-ample.md) | P2 | camera-zoom | bug | open | Le zoom molette n'existe pas dans le 1.29 et va beaucoup trop loin |
| [QA-040](camera-zoom/QA-040-camera-ne-suit-jamais-le-personnage.md) | P2 | camera-zoom | gap | confirmed | La caméra ne suit jamais le personnage |
| [QA-045](network/QA-045-double-clic-envoie-deux-ordres.md) | P2 | network | bug | confirmed | Le double-clic envoie deux ordres de déplacement identiques |
| [QA-051](hud-banner/QA-051-secteurs-de-la-boussole-inertes.md) | P2 | hud-banner | gap | confirmed | Les quatre secteurs de la boussole sont inertes |
| [QA-052](hud-banner/QA-052-boutons-utilitaires-inertes.md) | P2 | hud-banner | gap | confirmed | Les quatre boutons utilitaires de la bannière sont inertes |
| [QA-056](hud-panels/QA-056-aucun-reglage-de-volume.md) | P2 | hud-panels | gap | confirmed | Aucun réglage de volume ni de coupure du son dans l'interface |
| [QA-067](server-runtime/QA-067-cache-de-maps-sans-eviction.md) | P2 | server-runtime | bug | confirmed | Le cache de maps ne libère jamais rien |
| [QA-071](fight/QA-071-glyphe-declenche-a-chaque-tour.md) | P2 | fight | bug | in-progress | Un glyphe se déclenche au début du tour de chaque combattant |
| [QA-072](fight/QA-072-glyphe-expire-reste-dessine.md) | P2 | fight | bug | in-progress | Un glyphe expiré reste dessiné chez le client |
| [QA-074](fight/QA-074-pieges-declenches-sur-la-seule-case-centrale.md) | P2 | fight | bug | in-progress | Les pièges ne se déclenchent que sur leur case centrale |
| [QA-077](inventory/QA-077-debit-kamas-non-atomique.md) | P2 | inventory | bug | fixed | Le débit de kamas du zaap n'était pas atomique |
| [QA-078](hud-panels/QA-078-inventaire-sans-skin-1-29.md) | P2 | hud-panels | bug | fixed | L'inventaire n'utilisait aucun des assets du skin 1.29 déjà en dépôt |
| [QA-081](hud-panels/QA-081-fiche-objet-onglets-et-description.md) | P2 | hud-panels | bug | fixed | Barre de défilement parasite sur la fenêtre d'inventaire, onglet « Conditions » débordant, description écrasée |
| [QA-082](hud-panels/QA-082-icones-de-caracteristique-mal-nommees.md) | P2 | hud-panels | bug | fixed | Les icônes de caractéristique venaient du mauvais jeu d'assets |
| [QA-086](world-content/QA-086-coffre-et-banque-sans-transfert-d-objets.md) | P2 | world-content | gap | fixed | Coffre et banque s'ouvrent mais ne transfèrent aucun objet |
| [QA-087](server-runtime/QA-087-cellules-movement-1-traversables.md) | P2 | server-runtime | bug | open | Les cellules `movement = 1` sont traversables au lieu d'être des cases d'arrivée |
| [QA-091](progression/QA-091-vie-regeneree-jamais-poussee-au-client.md) | P2 | progression | gap | fixed | La vie régénérée ne remonte au client qu'à la prochaine lecture de stats |
| [QA-092](input/QA-092-clic-pendant-un-deplacement-ignore.md) | P2 | input | gap | fixed | Un clic pendant un déplacement est ignoré au lieu d'interrompre la marche |
| [QA-094](world-render/QA-094-membres-d-un-groupe-empiles-sur-une-case.md) | P2 | world-render | bug | fixed | Les membres d'un groupe de monstres sont empilés sur une seule case |
| [QA-103](exchange/QA-103-exchangetype-diverge-du-client.md) | P2 | exchange | bug | fixed | L'énumération ExchangeType diverge du client décompilé sur 11 valeurs sur 19 |
| [QA-104](exchange/QA-104-formes-de-messages-d-echange-inadaptees.md) | P2 | exchange | gap | fixed | ExchangeList et ExchangeItemMovement ne portent pas un objet sous la forme que le reste du protocole utilise |
| [QA-105](exchange/QA-105-coffre-de-maison.md) | P2 | exchange | feature | open | Le coffre de maison n'a pas de contenant propre |
| [QA-106](exchange/QA-106-boutique-pnj.md) | P2 | exchange | feature | open | Aucune boutique PNJ — le catalogue n'est même pas importé |
| [QA-109](exchange/QA-109-mode-marchand.md) | P2 | exchange | feature | open | Aucun mode marchand |
| [QA-112](server-runtime/QA-112-verrou-d-occupation-unifie.md) | P2 | server-runtime | gap | open | Trois états d'interaction exclusifs, trois Map indépendantes, aucun contrat commun |
| [QA-113](server-runtime/QA-113-etat-d-interaction-perdu-au-redemarrage.md) | P2 | server-runtime | gap | open | Combats et dialogues ne survivent pas à un redémarrage du core, et rien ne le dit au client |
| [QA-114](network/QA-114-aucun-controle-de-distance-hors-combat.md) | P2 | network | gap | open | Aucun contrôle de distance ni d'adjacence hors combat — on parle à un PNJ depuis l'autre bout de la carte |
| [QA-119](world-content/QA-119-bankcost-litteral.md) | P2 | world-content | gap | open | Le banquier annonce un coût de consultation en affichant le littéral [bankCost] |
| [QA-120](exchange/QA-120-aucun-controle-de-surcharge.md) | P2 | exchange | gap | open | Aucun contrôle de surcharge : un échange peut mettre le receveur en surpoids |
| [QA-121](server-runtime/QA-121-aucun-evenement-d-interruption.md) | P2 | server-runtime | gap | open | Aucun événement de domaine hors session.* — un combat qui démarre n'interrompt rien |
| [QA-124](worldmap/QA-124-manifeste-public-de-navigation-absent.md) | P2 | worldmap | feature | fixed | Aucun manifeste public ne décrit la topologie navigable du monde |
| [QA-125](network/QA-125-contrats-typescript-non-publies.md) | P2 | network | feature | fixed | Les contrats TypeScript du client ne sont pas publiés |
| [QA-128](hud-panels/QA-128-ascenseur-plus-haut-que-sa-glissiere.md) | P2 | hud-panels | bug | fixed | L'ascenseur dépasse sa glissière quand la liste est plus courte que sa fenêtre |
| [QA-132](network/QA-132-gdf-jamais-emis.md) | P2 | network | gap | in-progress | GDF n'est jamais émis — un objet interactif n'a aucun état |
| [QA-133](progression/QA-133-pods-de-metier-non-comptes.md) | P2 | progression | bug | in-progress | Les pods gagnés par les métiers ne sont jamais comptés |
| [QA-134](hud-panels/QA-134-pas-de-panneau-metiers.md) | P2 | hud-panels | gap | in-progress | Pas de panneau Métiers — le bouton de bannière est rendu et inerte |
| [QA-138](exchange/QA-138-craft-cooperatif-et-securise.md) | P2 | exchange | feature | fixed | Ni craft coopératif ni craft sécurisé |
| [QA-140](progression/QA-140-on-ne-peut-pas-oublier-un-metier.md) | P2 | progression | feature | fixed | On ne peut pas oublier un métier |
| [QA-142](world-content/QA-142-branches-de-dialogue-non-affichables.md) | P2 | world-content | data | confirmed | Des branches de dialogue mènent à des questions que le client 1.29 ne sait pas afficher |

## P3 — finition, confort, cosmétique

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-002](auth/QA-002-ecrans-serveur-personnage-sans-artwork.md) | P3 | auth | bug | open | Écrans serveur / personnage sans artwork |
| [QA-004](hud-banner/QA-004-badge-connected-debug.md) | P3 | hud-banner | bug | open | Badge « Connected » de debug en haut à droite |
| [QA-008](hud-banner/QA-008-filtres-de-canaux-en-checkbox-html.md) | P3 | hud-banner | bug | open | Filtres de canaux de chat rendus en cases à cocher HTML brutes |
| [QA-011](hud-panels/QA-011-onglets-type-sans-icones.md) | P3 | hud-panels | bug | open | Onglets « Type » du panneau Sorts sans icônes |
| [QA-015](hud-panels/QA-015-slots-equipement-sans-icone-de-type.md) | P3 | hud-panels | bug | wontfix | ~~Slots d'équipement sans icône de type~~ |
| [QA-016](hud-panels/QA-016-all-types-en-anglais.md) | P3 | hud-panels | bug | fixed | « All types » en anglais dans le panneau Inventaire |
| [QA-023](chat/QA-023-libelles-de-canaux-en-anglais.md) | P3 | chat | bug | open | Libellés des filtres de canaux en anglais |
| [QA-024](chat/QA-024-chat-lateral-force-theme-clair.md) | P3 | chat | bug | open | Le chat latéral force `data-theme="light"` |
| [QA-028](worldmap/QA-028-titre-categories-en-anglais.md) | P3 | worldmap | bug | open | Titre « Categories » en anglais dans un panneau français |
| [QA-029](worldmap/QA-029-cases-a-cocher-des-categories-toutes-vertes.md) | P3 | worldmap | bug | open | Cases à cocher des catégories toutes vertes |
| [QA-031](worldmap/QA-031-barre-d-aide-recouvre-la-banniere.md) | P3 | worldmap | bug | open | La barre d'aide recouvre la bannière |
| [QA-032](worldmap/QA-032-panneau-categories-masque-la-carte.md) | P3 | worldmap | bug | open | Le panneau « Categories » masque la carte et n'est ni déplaçable ni repliable |
| [QA-042](world-render/QA-042-tuiles-non-re-rasterisees-au-zoom.md) | P3 | world-render | bug | open | Le rendu des tuiles n'est pas re-rastérisé net au zoom fort |
| [QA-044](fight/QA-044-fond-hors-map-noir-en-mode-tactique.md) | P3 | fight | bug | open | Le fond hors-map reste noir en mode tactique |
| [QA-053](hud-banner/QA-053-libelles-accessibilite-casses.md) | P3 | hud-banner | bug | open | Libellés d'accessibilité cassés sur les boutons de menu |
| [QA-073](fight/QA-073-duree-de-glyphe-comptee-par-tour.md) | P3 | fight | bug | in-progress | La durée d'un glyphe est décomptée par tour et non par round |
| [QA-075](fight/QA-075-sort-declencheur-charge-au-niveau-1.md) | P3 | fight | bug | in-progress | Le sort déclencheur d'un glyphe ou d'un piège est toujours chargé au niveau 1 |
| [QA-099](world-render/QA-099-pnj-mobiles-immobiles.md) | P3 | world-render | gap | fixed | Les PNJ marqués mobiles ne déambulent pas — leur chemin n'est jamais rejoué |
| [QA-110](exchange/QA-110-percepteur.md) | P3 | exchange | feature | open | Aucun ramassage de percepteur |
| [QA-111](exchange/QA-111-inventaire-de-monture-et-enclos.md) | P3 | exchange | feature | open | Ni inventaire de monture, ni étable, ni enclos |
| [QA-122](exchange/QA-122-pas-de-liste-noire.md) | P3 | exchange | feature | open | Pas de bouton « Ignorer » sur une proposition d'échange, faute de liste noire |
| [QA-139](exchange/QA-139-livre-des-artisans-et-options-metier.md) | P3 | exchange | feature | fixed | Pas de livre des artisans ni d'options de métier |
| [QA-141](progression/QA-141-le-metier-de-chasseur-n-existe-pas.md) | P3 | progression | feature | confirmed | Le métier de Chasseur n'existe pas — et ses données non plus |

## Sans gravité — vérifications sans défaut

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-047](input/QA-047-clic-hors-zone-de-map-ignore.md) | none | input | check | closed | ~~Un clic hors de la zone de map est correctement ignoré~~ |
| [QA-054](worldmap/QA-054-boussole-affiche-un-extrait-de-carte.md) | none | worldmap | check | closed | ~~La boussole affiche bien un extrait de carte du monde~~ |
| [QA-055](audio/QA-055-audio-fonctionne-de-bout-en-bout.md) | none | audio | check | closed | ~~L'audio fonctionne de bout en bout~~ |

<!-- issues:end -->
