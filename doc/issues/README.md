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

**88 entrées**, dont **84 encore ouvertes**.

## Par gravité

| Gravité | Restantes | Total |
|---|---|---|
| P0 — bloque la session (crash, impossible d'avancer) | 4 | 4 |
| P1 — fonctionnalité cassée ou absente sur un flux principal | 33 | 33 |
| P2 — comportement divergent du 1.29 canonique, contournable | 31 | 31 |
| P3 — finition, confort, cosmétique | 16 | 17 |
| Sans gravité — vérifications sans défaut | 0 | 3 |

## Par statut

| Statut | Entrées |
|---|---|
| `open` — observé, non reproduit méthodiquement | 35 |
| `confirmed` — reproduit, preuve au dossier | 17 |
| `in-progress` — correctif engagé | 13 |
| `fixed` — correctif livré, reste à revérifier manette en main | 19 |
| `closed` — vérifié, clos | 3 |
| `wontfix` — écarté, avec la raison en fiche | 1 |

## Par domaine

| Domaine | Restantes | Total |
|---|---|---|
| [`audio/`](audio/) | 0 | 1 |
| [`auth/`](auth/) | 2 | 2 |
| [`camera-zoom/`](camera-zoom/) | 3 | 3 |
| [`chat/`](chat/) | 5 | 5 |
| [`fight/`](fight/) | 13 | 13 |
| [`hud-banner/`](hud-banner/) | 9 | 9 |
| [`hud-panels/`](hud-panels/) | 13 | 14 |
| [`input/`](input/) | 3 | 4 |
| [`inventory/`](inventory/) | 3 | 3 |
| [`network/`](network/) | 5 | 5 |
| [`progression/`](progression/) | 2 | 2 |
| [`server-runtime/`](server-runtime/) | 4 | 4 |
| [`session/`](session/) | 3 | 3 |
| [`world-content/`](world-content/) | 5 | 5 |
| [`world-render/`](world-render/) | 7 | 7 |
| [`worldmap/`](worldmap/) | 7 | 8 |

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
| [QA-084](world-content/QA-084-cellules-scriptees-jamais-importees.md) | P1 | world-content | data | fixed | Aucune cellule scriptée n'est importée — banque, boutiques et donjons inaccessibles |
| [QA-085](network/QA-085-aucun-protocole-d-objet-interactif.md) | P1 | network | gap | fixed | Aucun protocole d'utilisation d'objet interactif — portes, zaaps et coffres inertes |
| [QA-088](world-render/QA-088-largeur-de-carte-perimee-apres-changement.md) | P1 | world-render | bug | fixed | Les acteurs ignorent le recentrage de la carte — décalés hors du décor sur toute carte non 15x17 |
| [QA-089](input/QA-089-identifiants-de-picking-recycles-apres-changement-de-carte.md) | P1 | input | bug | fixed | Après un changement de carte, cliquer un élément ouvre le menu d'un acteur de la carte précédente |

## P2 — comportement divergent du 1.29 canonique, contournable

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-001](auth/QA-001-ecran-login-hors-charte.md) | P2 | auth | bug | open | Écran de login générique, hors charte 1.29 et non traduit |
| [QA-006](hud-banner/QA-006-ni-xp-ni-pods-ni-energie.md) | P2 | hud-banner | gap | open | Ni barre d'XP, ni pods, ni énergie, ni nom/niveau en bannière |
| [QA-007](hud-banner/QA-007-slots-de-raccourcis-vides-et-inertes.md) | P2 | hud-banner | gap | open | Les 14 slots de raccourcis sont vides et inertes |
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
| [QA-086](world-content/QA-086-coffre-et-banque-sans-transfert-d-objets.md) | P2 | world-content | gap | open | Coffre et banque s'ouvrent mais ne transfèrent aucun objet |
| [QA-087](server-runtime/QA-087-cellules-movement-1-traversables.md) | P2 | server-runtime | bug | open | Les cellules `movement = 1` sont traversables au lieu d'être des cases d'arrivée |

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

## Sans gravité — vérifications sans défaut

| # | Gravité | Domaine | Type | Statut | Titre |
|---|---|---|---|---|---|
| [QA-047](input/QA-047-clic-hors-zone-de-map-ignore.md) | none | input | check | closed | ~~Un clic hors de la zone de map est correctement ignoré~~ |
| [QA-054](worldmap/QA-054-boussole-affiche-un-extrait-de-carte.md) | none | worldmap | check | closed | ~~La boussole affiche bien un extrait de carte du monde~~ |
| [QA-055](audio/QA-055-audio-fonctionne-de-bout-en-bout.md) | none | audio | check | closed | ~~L'audio fonctionne de bout en bout~~ |

<!-- issues:end -->
