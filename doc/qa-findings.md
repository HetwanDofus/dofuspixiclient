# QA findings — session de jeu

Journal de test exploratoire du client, tenu au fil d'une session de jeu réelle
(login → monde → interactions → combat). Chaque entrée note ce qui a été
observé, pas ce que le code laisse supposer.

Barème de sévérité :

| | |
|---|---|
| **P0** | bloque la session (crash, impossible d'avancer) |
| **P1** | fonctionnalité cassée ou absente sur un flux principal |
| **P2** | comportement divergent du 1.29 canonique, contournable |
| **P3** | finition, confort, cosmétique |

Statut : `ouvert` / `confirmé` / `à revérifier`.

---

## Synthèse — session 1

56 entrées : 4 en P0, 13 en P1, 21 en P2, 17 en P3, plus un point vérifié
sans défaut. Le parcours login → serveur → personnage → monde fonctionne de
bout en bout, le rendu tient 72 fps en toutes
circonstances, le changement de map, le pathfinding et le déplacement sont
solides, et le mode tactique est de belle qualité. Ce qui manque n'est
presque jamais du moteur : c'est du **câblage** et des **données**.

Trois causes racines expliquent la majorité des symptômes :

1. **Les données de contenu ne sont pas importées.** `monster_templates`,
   `npc_templates` et `item_templates` sont à zéro ligne, alors que `maps`
   (9 358) et `spell_levels` (10 632) sont peuplées. D'où : monde désert,
   inventaire structurellement vide, combat intestable. → QA-034, QA-035
2. **Les panneaux HUD sont des maquettes.** Sept panneaux sur huit ne
   s'abonnent à aucun store ; les données arrivent bien du serveur et vivent
   dans les stores, mais rien ne les lit. → QA-037, et par ricochet QA-010,
   QA-013, QA-017
3. **Le gateway reste bloqué en mode buffering** après toute reconnexion au
   core, ce qui gèle silencieusement la partie. Correctif d'une ligne
   identifié. → QA-048, QA-046

### Les quatre P0, et les P1 qui pèsent le plus

| # | Sévérité | Titre |
|---|---|---|
| QA-048 | P0 | Le gateway ne sort jamais du mode buffering après reconnexion au core |
| QA-034 | P0 | Aucun monstre ne se pose sur aucune map |
| QA-035 | P0 | Aucun PNJ, aucun objet en base |
| QA-037 | P0 | Sept des huit panneaux HUD sont des maquettes statiques |
| QA-020 | P1 | Le champ de chat de la bannière n'est branché à rien |
| QA-050 | P1 | 194 objets interactifs chargés, aucun n'est cliquable |
| QA-025 | P1 | Les personnages n'ont aucune animation d'attente |
| QA-041 | P1 | Un atlas GPU de 512 Mo réalloué à chaque zoom, jamais utilisé |

### Ce qui frappe le plus manette en main

Au-delà des bloquants, quatre absences se remarquent dans les dix premières
secondes de jeu : les personnages sont **totalement figés** (aucune animation
d'attente, QA-025), **rien ne réagit au survol** d'une cellule (QA-049), la
bannière **n'affiche ni PA ni PM** (QA-005), et un **overlay de debug FPS**
trône en permanence en haut de l'écran (QA-003).

### Fonctionnalités écrites mais livrées mortes

Le mode tactique (QA-043) est entièrement implémenté et rend très bien quand on
l'appelle à la main, mais aucun bouton ne l'active. Même schéma pour le chat
latéral, invisible sur la plupart des résolutions et sans déclencheur
(QA-022), et pour les boutons utilitaires de la bannière (QA-052).

### Ce qui va bien

L'**audio** tourne de bout en bout — musique, ambiance et bruits aléatoires,
avec fondu (QA-055). Login (PBKDF2 compris) en ~1,6 s ; sélection serveur et personnage sans
accroc ; rendu à 72 fps au repos, grille affichée, zoom ×4 et panneau ouvert ;
cinq changements de map enchaînés sans erreur console ni requête en échec ;
pathfinding et orientation du sprite corrects ; marche/course choisies sur la
longueur du trajet, conformément au 1.29 ; carte du monde lisible et complète ;
minimap correctement rafraîchie ; interface traduite en français à quelques
chaînes près.

### Deux faux positifs que j'ai écartés

Consignés parce que le piège se retend facilement :

- **FPS.** Mes premières mesures (7 à 23 fps) venaient du throttling
  `requestAnimationFrame` de Chrome sur une fenêtre en arrière-plan, pas du
  jeu. Toute mesure de framerate doit être précédée d'un `Page.bringToFront`
  et d'une vérification de `document.visibilityState`.
- **Audio.** J'ai d'abord conclu à tort que rien ne jouait, sur la foi d'un
  `document.querySelectorAll("audio")` vide — or `new Audio(url)` ne crée
  aucun élément dans le DOM. Il faut instrumenter le constructeur `Audio`, et
  l'installer **avant** le premier chargement de map.

---

## Session 1 — 2026-08-20

**Environnement** : Chrome (WebGPU), Vite dev `:5173`, gateway/authd/gamed en
Docker, compte `dev`.


### Connexion et sélection

**QA-001 — P2 — Écran de login générique, hors charte 1.29 et non traduit** · `ouvert`
`window/mainview/auth/` — le login est un formulaire Tailwind sombre « Sign in /
Username / Password » sur fond dégradé gris. Le 1.29 a un écran de connexion
illustré avec le logo. Surtout, le reste du client est intégralement en
français (lingui + bundles `langs/fr`) : ces trois libellés sont les seuls en
anglais du parcours d'entrée.

**QA-002 — P3 — Écrans serveur / personnage sans artwork** · `ouvert`
« Select server » → `Server #1 / 1 chars / online`, puis « Select character » →
`Dev / lvl 1 / gfx 10`. Le personnage est listé en texte brut : ni aperçu du
sprite, ni classe, ni serveur d'origine. `gfx 10` est un identifiant interne
qui ne devrait pas être exposé.

### HUD permanent

**QA-003 — P1 — Overlay FPS de debug affiché en permanence, sans toggle**
`ouvert` · `game/render/engine.ts:128-135`
`Engine.init()` crée inconditionnellement un `<div>` `position:fixed`
`z-index:999999` en haut à gauche du viewport, qui affiche
`72 FPS 1act upd:0.0ms | sl:0/2048 r:0 q:0.0ms fl:0.0ms h:0`. Il n'est lié à
aucun raccourci (`DEBUG_TOGGLE` = `D` ne l'affecte pas) et se superimpose au
jeu en toutes circonstances. À passer derrière le flag debug.

**QA-004 — P3 — Badge « Connected » de debug en haut à droite** · `ouvert`
`window/mainview/MapRenderer.tsx:285` — pastille verte permanente hors de la
zone de jeu. Le 1.29 n'affiche l'état réseau que sur perte de connexion.

### Bannière principale

**QA-005 — P1 — PA / PM absents de la bannière** · `ouvert`
La bannière n'affiche que le cœur de vie (`55`). Le 1.29 place les points
d'action et de mouvement de part et d'autre du cœur, visibles en permanence y
compris hors combat. Les valeurs existent pourtant côté client — le panneau
Caractéristiques affiche bien `PA 6 / PM 3`.

**QA-006 — P2 — Ni barre d'XP, ni pods, ni énergie, ni nom/niveau en bannière**
`ouvert` · Le bandeau 1.29 porte la barre d'expérience sur toute sa largeur et
un survol du cœur donne énergie + pods. Rien de tout cela n'est présent.

**QA-007 — P2 — Les 14 slots de raccourcis sont vides et inertes** · `ouvert`
Deux rangées de 7 slots (onglets latéraux « Sorts » / « Obj. »). Aucun contenu,
aucun glisser-déposer testable puisque ni sorts ni objets n'existent
(cf. QA-010, QA-013). Les onglets ne réagissent pas au clic.

**QA-008 — P3 — Filtres de canaux de chat rendus en cases à cocher HTML brutes**
`ouvert` · Huit `<input type=checkbox>` colorés (vert / noir / bleu / violet /
orange / gris / marron / magenta) flottent au-dessus de la boussole. Le 1.29
utilise de petites pastilles intégrées au parchemin. En l'état l'élément lit
comme un formulaire web posé sur le HUD.

**QA-009 — P2 — Marqueur de position de la minimap = rectangle rouge plein**
`ouvert` · `game/worldmap/minimap-renderer.ts` — la position du joueur est un
gros rectangle rouge opaque d'environ 30×15 px qui masque le décor sous lui,
au lieu du petit repère canonique. La minimap reste par ailleurs vide tant que
le personnage n'a pas bougé une première fois.

### Panneaux

**QA-010 — P1 — Le personnage n'a aucun sort** · `ouvert`
Panneau Sorts (`S`) : liste vide, `Points de boost : 0`. En 1.29 tout
personnage démarre avec les sorts de base de sa classe dès le niveau 1. Sans
sort, le combat se limite au corps à corps — cela bloque le test de tout le
runtime de sorts.

**QA-011 — P3 — Onglets « Type » du panneau Sorts sans icônes** · `ouvert`
Six rectangles gris vides là où le 1.29 affiche les icônes d'élément
(Terre / Feu / Eau / Air / Neutre).

**QA-012 — P1 — Les panneaux débordent sous la bannière et sont tronqués**
`ouvert` · `hud/HudOverlay.tsx:53-61` — `panelWrapStyle` contraint la hauteur à
`bannerTopPx` mais les panneaux Inventaire et Sorts dépassent : le bas de la
grille d'inventaire et la zone « Aucun objet sélectionné » passent derrière la
bannière et deviennent inaccessibles.

**QA-013 — P2 — Inventaire : 450/1000 pods pour zéro objet** · `ouvert`
L'inventaire est vide (aucun objet, aucun équipement) mais la jauge de pods
affiche `450/1000`. Soit la valeur est seedée en dur, soit le calcul de poids
ne dérive pas du contenu réel.

**QA-014 — P2 — Inventaire : aperçu du personnage remplacé par une silhouette**
`ouvert` · Le cadre de gauche montre une silhouette grise générique. Le 1.29 y
rend le personnage habillé, mis à jour à chaque changement d'équipement.

**QA-015 — P3 — Slots d'équipement sans icône de type** · `ouvert`
Les emplacements sont de simples carrés gris de tailles inégales et mal
alignés. Le 1.29 grise dans chaque slot l'icône du type accepté (amulette,
anneau, coiffe, cape, ceinture, bottes, familier, dofus…).

**QA-016 — P3 — « All types » en anglais dans le panneau Inventaire** · `ouvert`
Seule chaîne non traduite du panneau ; tout le reste (« Équipement »,
« Aucun objet sélectionné », « Kamas », « Pods ») est en français.

**QA-017 — P2 — Le panneau Guilde s'ouvre avec des données pour un personnage sans guilde**
`ouvert` · `G` ouvre un panneau complet (Membres / Infos / Bonus / Percepteurs /
Enclos / Maisons / Emblème) affichant « Niveau 1 » et une barre d'XP. Sans
guilde, le 1.29 n'ouvre pas ce panneau.

**QA-018 — P2 — Initiative à 1 dans le panneau Caractéristiques** · `ouvert`
`PV 55/55, PA 6, PM 3, Initiative 1, Prospection 100`. Les PA/PM/PV/prospection
sont conformes au niveau 1, mais l'initiative de base du 1.29 se situe autour
de 100 — la valeur `1` suggère une formule non implémentée. Le champ
« Énergie » est affiché sans valeur.

### Réseau / protocole

**QA-019 — P2 — Messages `gameActionsStart` / `gameActionsFinish` non gérés**
`ouvert` · À chaque déplacement, la console logge
`[MessageHandler] No handler for gameActionsStart` puis
`… gameActionsFinish`. Le serveur émet donc le cadrage d'action (équivalent
`GA` du 1.29) que le client ignore — le séquenceur d'actions n'est pas branché.

### Chat

**QA-020 — P1 — Le champ de chat de la bannière n'est branché à rien** · `confirmé`
`hud/banner/BannerReact.tsx:387` passe uniquement un `placeholder` à
`MainBannerChatInput`. Inspection des props React de l'élément en session :
`type, className, placeholder` — pas de `value`, `onChange`, `onKeyDown` ni
`onSubmit`. On peut taper « bonjour le monde », appuyer sur Entrée : le texte
reste dans le champ, rien n'est envoyé, rien n'apparaît dans le log, aucune
trame ne part. La zone de log de la bannière au-dessus reste vide en toutes
circonstances.

**QA-021 — P2 — Deux chats concurrents, dont un factice** · `ouvert`
Le chat réellement fonctionnel est `SideChatContainer`, panneau latéral séparé.
Quand il s'affiche, l'écran porte deux zones de saisie (« Chat here… » morte
dans la bannière, « Say something… » vivante à droite) et **deux jeux de huit
filtres de canaux**. Il faut décider lequel des deux est le chat du jeu.

**QA-022 — P1 — Le chat latéral est invisible sur la plupart des résolutions**
`ouvert` · `window/mainview/MapRenderer.tsx:305-320` — le panneau ne se rend
que si l'espace libre à côté du canvas dépasse 350 px. Or le canvas est
plafonné par la hauteur (`FULL_HEIGHT`), donc en 1868×907 il reste exactement
329 px de chaque côté et le chat disparaît. Mesuré en session : visible à
2400 px de large, absent à 1868 px. Il n'existe aucun bouton pour l'ouvrir —
`toggleChatOpen` est exporté par `game/stores/chat-store.ts` mais n'est appelé
nulle part. Sur un 16:9 courant, le joueur n'a donc aucun chat.

**QA-023 — P3 — Libellés des filtres de canaux en anglais** · `ouvert`
`components/ui/main-banner.tsx:173-182` : `General, Team, Party, Guild,
Alignment, Trade, Recruitment, Event`. Attendu : Général, Équipe, Groupe,
Guilde, Alignement, Commerce, Recrutement, Événement.

**QA-024 — P3 — Le chat latéral force `data-theme="light"`** · `ouvert`
Fond beige clair collé au bord droit, en rupture avec le reste du HUD, et il
prend toute la hauteur de la fenêtre — y compris la bande hors zone de jeu.

### Rendu / monde

**QA-025 — P1 — Les personnages n'ont aucune animation d'attente** · `confirmé`
Trois captures du canvas autour du sprite à 700 ms d'intervalle donnent des
pixels strictement identiques ; le compteur de l'overlay reste à `r:0`
(aucune frame rasterisée). Le personnage est figé sur une pose unique. Le 1.29
joue `static<Direction>` en boucle en permanence (respiration, clignement).
C'est ce qui donne au monde son impression de vie — l'absence se remarque
immédiatement.

**QA-026 — P2 — Pas de nom au-dessus du personnage** · `ouvert`
Aucun `TextOverHead` ne s'affiche, ni en permanence ni au survol. Le store
`hud/world/player-nameplate-store.ts` et le composant `PlayerNameplate`
existent et sont montés, mais aucune entrée n'y est poussée pour le joueur
local pendant la session.

**QA-027 — P2 — Menu contextuel en anglais et non conforme** · `ouvert`
Clic droit sur son propre personnage → menu à trois lignes : `Dev` (titre),
`Slap`, `Organize my shop`. Les deux actions sont en anglais et ne
correspondent à rien du 1.29 : « Slap » (gifler) n'est pas une action du jeu,
et l'organisation de boutique n'apparaît que sur un personnage en mode
marchand. Les entrées attendues sur un autre joueur (message privé, ajouter en
ami / ennemi, inviter dans le groupe, duel, échange, profil) sont absentes.

### Carte du monde

**QA-028 — P3 — Titre « Categories » en anglais dans un panneau français**
`ouvert` · Les entrées sous l'en-tête sont bien traduites (« Lieux de classes »,
« Hôtels de vente », « Ateliers », « Divers », « Territoires de conquête »,
« Donjons », « Grille ») ; seul l'en-tête reste en anglais.

**QA-029 — P3 — Cases à cocher des catégories toutes vertes** · `ouvert`
Chaque ligne porte une case verte identique à gauche et la pastille de couleur
réelle de la catégorie à droite. La case devrait reprendre la couleur de la
catégorie qu'elle pilote.

**QA-030 — P2 — Marqueur de position = rectangle rouge plein, ici aussi**
`ouvert` · Même symptôme que QA-009 sur la carte du monde : un pavé rouge
opaque d'une case entière au lieu d'un repère. Sur les deux vues, le joueur ne
peut pas voir ce qu'il y a sous sa propre position.

**QA-031 — P3 — La barre d'aide recouvre la bannière** · `ouvert`
« M Fermer | Glisser Déplacer | Molette Zoom » est posée en bas au centre,
par-dessus le cœur de vie et la boussole.

**QA-032 — P3 — Le panneau « Categories » masque la carte et n'est ni déplaçable ni repliable**
`ouvert` · Il occupe en dur le coin haut-gauche de la zone cartographique.

**QA-033 — P2 — Cliquer une case de la carte du monde ne fait rien**
`ouvert` · `hud/worldmap/WorldMapPanel.tsx:49` : le callback `onTeleport` se
contente d'un `console.log("World map teleport:", mapId)`. Ce n'est pas un
manque en soi (le 1.29 ne téléporte pas non plus au clic), mais le survol
n'affiche pas davantage le nom de la zone / sous-zone, qui est l'usage
principal de cet écran.

### Contenu du monde — le jeu est vide

**QA-034 — P0 — Aucun monstre ne se pose sur aucune map** · `confirmé`
Cinq maps traversées (7365 → 7448 → 7464 → 7612 → 8600 → 8599), zéro groupe.
Le serveur logge à chaque entrée `[MapMonsterService] spawned 0 monster groups`.

Cause racine trouvée : la table `monster_templates` est **vide** (0 ligne).
Les maps, elles, ont bien leur configuration — `maps.numgroup = 3`,
`mob_size_min/max = 3/8`, `monsters_raw = '|52,1|101,3|134,1|98,3|149,1'` sur
7448 par exemple. `MapMonsterService.ensureSpawned` parse donc un pool valide,
puis `buildMembers` ne résout aucun template et retourne une liste vide, si
bien qu'aucun groupe n'est enregistré.

Conséquence : **tout le pan combat / PvM est intestable**. C'est le blocage
numéro un de cette session.

**QA-035 — P0 — Aucun PNJ, aucun objet en base** · `confirmé`
`npc_templates` = 0, `scripted_npcs` = 0, `item_templates` = 0. Le monde n'a ni
marchand, ni dialogue, ni butin, ni équipement possible. L'inventaire ne peut
structurellement rien contenir, et la commande d'échange / boutique du menu
contextuel n'a aucun support.

Ces trois tables (avec `monster_templates`) sont les seules données de contenu
manquantes : `maps` = 9 358 lignes et `spell_levels` = 10 632 sont bien
peuplées. Il manque donc une étape d'import, pas un schéma.

**QA-036 — P1 — Le personnage possède les 2 091 sorts du jeu** · `confirmé`
`select count(*) from player_spells` → **2 091**, soit l'intégralité du
catalogue attribué au personnage de test. En parallèle `class_starter_spells`
est vide (0 ligne) : la table qui devrait définir les sorts de départ par
classe n'est pas seedée, et le seed compense en donnant tout.

Le serveur reconstruit et renvoie donc cette liste complète à chaque entrée de
map — `[SpellsService] buildSpellList player=1 spells=2091 … total=30ms`,
observé à chacun des cinq changements de map.

### Panneaux HUD — maquettes non branchées

**QA-037 — P0 — Sept des huit panneaux HUD sont des maquettes statiques**
`confirmé` · Aucun de ces fichiers ne contient de `useSyncExternalStore` ni
d'abonnement à un store :

| Panneau | Symptôme observé en session |
|---|---|
| `SpellsPanel.tsx` | 12 lignes vides générées par `[...Array(12)]`, « Points de boost : 0 » écrit en dur |
| `InventoryPanel.tsx` | `useState(1500000)` pour les kamas, `useState(450)` pour le poids, `maxWeight = 1000` |
| `QuestsPanel.tsx` | « Quêtes : 0 » en dur |
| `FriendsPanel.tsx` | deux listes générées par `[...Array(...)]` |
| `GuildPanel.tsx` | « Niveau 1 » en dur, sept onglets sans données |
| `MountPanel.tsx` | « Pas de monture » figé |
| `ConquestPanel.tsx` | liste générée |

Seul `StatsPanel.tsx` affiche du réel — et encore, parce que `HudOverlay` lui
passe `stats`, `name`, `level` et `classId` en props depuis `characterStore` ;
le panneau lui-même ne s'abonne à rien.

C'est ce qui explique QA-010, QA-013 et QA-017 : les données arrivent bien du
serveur et vivent dans les stores (`spellsStore` reçoit ses 2 091 entrées via
`applySpellList`), mais **aucun panneau ne les lit**. Le travail restant est
du câblage, pas de la collecte de données.

**QA-038 — P2 — Le menu contextuel ne se ferme jamais** · `ouvert`
Ouvert par clic droit sur le personnage, il reste affiché à travers `Échap`,
l'ouverture d'autres panneaux et un changement de map. Relevé encore présent
dans `document.body.innerText` (« Dev Slap Organize my shop ») plusieurs
interactions après son ouverture.

### Caméra et zoom

**QA-039 — P2 — Le zoom molette n'existe pas dans le 1.29 et va beaucoup trop loin**
`ouvert` · `game/constants/battlefield.ts:41` — `ZOOM_LEVELS = [1,2,3,4,5]`.
Trois crans de molette suffisent à remplir l'écran avec deux buissons. Le 1.29
n'a aucun zoom : la vue est fixe. Si le zoom est un ajout assumé, l'amplitude
doit être réduite (1 → 2 au maximum) ; sinon il faut le retirer.

**QA-040 — P2 — La caméra ne suit jamais le personnage** · `confirmé`
`mapContainer.x/y` reste à `0,0` en toutes circonstances — relevé avant et
après un déplacement. Aux zooms élevés le personnage sort du cadre et rien ne
le ramène ; après un dézoom la vue reste sur le coin de map où l'on se
trouvait. Aucun bouton ni raccourci ne recentre la vue.

**QA-041 — P1 — Un atlas GPU de 512 Mo est réalloué à chaque changement de zoom, et jamais utilisé**
`confirmé` · Relevé littéral de la console pendant la session :

```
[FrameAtlas] 16384x8192 atlas, slot=512,  512 slots, res=3.26
[FrameAtlas] 16384x8192 atlas, slot=1024, 128 slots, res=4.89
[FrameAtlas] 16384x8192 atlas, slot=1024, 128 slots, res=6.53
[FrameAtlas] 16384x8192 atlas, slot=1024, 128 slots, res=4.89
[FrameAtlas] 16384x8192 atlas, slot=512,  512 slots, res=3.26
[FrameAtlas] 16384x8192 atlas, slot=256, 2048 slots, res=1.63
```

Six textures 16384×8192 RGBA8 (512 Mo de taille logique chacune) créées en
quelques crans de molette. `CharacterSpriteLoader.setZoom`
(`game/assets/character-sprite.ts:275`) en instancie une nouvelle sans libérer
la précédente, et `VelloRenderer::free_texture` n'est appelé nulle part dans le
client.

Pire : l'atlas ne sert à rien. Le compteur de l'overlay reste à `r:0 h:0`
(zéro rastérisation, zéro hit) pendant toute la session, parce que le rendu des
personnages passe en réalité par `renderAnimationStrip` ; `FrameAtlas.getFrame`
n'a aucun appelant. Seuls `tick()` et `flush()` sont appelés, à chaque frame,
sur une file toujours vide.

Noter aussi la dégradation de capacité : `2048` slots à zoom 1, `128` à zoom 5,
puisque la taille de slot passe de 256 à 1024 px.

**QA-042 — P3 — Le rendu des tuiles n'est pas re-rastérisé net au zoom fort**
`ouvert` · À 3 crans de zoom les bords des feuilles et des troncs sont
visiblement interpolés. Avec un pipeline vectoriel, le zoom devrait rester net.

### Fonctionnalités présentes mais inaccessibles

**QA-043 — P1 — Le mode tactique n'a aucun déclencheur dans l'interface**
`confirmé` · `Battlefield.setTacticalMode()` est entièrement implémenté (tuiles
`tactic_` / `cell_`, décor thématique, restauration à la sortie) et
`tacticalModeStore` existe. Appelé à la main depuis la console, le rendu obtenu
est propre et fidèle au 1.29 : cellules grises, obstacles en relief, décors
conservés. Mais **aucun `.tsx` n'appelle `setTacticalMode`** — grep sur tout
`hud/` : zéro occurrence. Le 1.29 expose ce mode par un bouton de la barre de
combat. La fonctionnalité est écrite et livrée morte.

**QA-044 — P3 — Le fond hors-map reste noir en mode tactique** · `ouvert`
Le 1.29 remplit l'arrière-plan tactique avec la texture de thème de la
sous-zone ; ici tout ce qui déborde de la grille est noir.

### Note de méthode — mesures de FPS

Les premières mesures de cette session (7 à 23 fps) étaient **fausses** : la
fenêtre Chrome pilotée était en arrière-plan (`document.visibilityState ===
"hidden"`), ce qui fait throttler `requestAnimationFrame`. Après
`Page.bringToFront`, toutes les configurations testées tiennent le plafond
d'affichage :

| Scénario | FPS |
|---|---|
| Repos, 1 acteur | 72 |
| Grille isométrique affichée | 72 |
| Zoom ×4 | 72 |
| Panneau Inventaire ouvert | 72 |

Le rendu n'est donc pas un problème sur cette charge (une map, un acteur, aucun
combat). À re-mesurer une fois les monstres et les combats disponibles.

### Entrées et robustesse

**QA-045 — P2 — Le double-clic envoie deux ordres de déplacement identiques**
`confirmé` · Un double-clic sur une cellule produit dans la console :
```
cell-click cell=237 … Moving: 265 → 237
cell-click cell=237 … Moving: 265 → 237
```
Deux trames pour un seul geste. Aucun dé-doublonnage ni fenêtre anti-rebond.

À noter, après vérification : marche et course sont correctement gérées — le
choix se fait sur la longueur du trajet dans `PlayerMovement` via
`shouldUseRun(pathLength, runLimit)`, ce qui est bien le comportement 1.29. Le
double-clic n'a donc pas à déclencher la course ; il ne devrait simplement pas
émettre deux ordres.

**QA-046 — P1 — Session zombie après un redémarrage du core : aucun retour utilisateur**
`à revérifier` · **Corrigé le 2026-08-20** — voir la note de correction en fin
d'entrée. Vérifié bout en bout sur la stack Docker ; reste à repasser le
parcours joueur complet manette en main pour clore.

Constat d'origine : `docker restart` sur `gamed`, client laissé ouvert.
Résultat :

- le gateway conserve la socket (`/health` → `sessions:1`) et le nouveau core
  démarre proprement (`WsRouter registered 21 message handler(s)`,
  `GatewayFrameService gateway connected`) ;
- le client continue d'afficher le badge vert **« Connected »** ;
- mais **plus aucune réponse serveur** : trois clics de déplacement successifs
  émettent bien `Moving: 324 → 238`, `324 → 260`, sans jamais recevoir
  `gameActionsStart` / `gameActionsFinish` ni `gameMapData`. Le personnage
  reste figé sur la cellule 324, et les logs `gamed` ne montrent aucun
  `enter-game` de restauration.

Le `HandoffCoordinator` annonce pourtant `discovered 4 handoff parts: sessions,
scheduler.jobs, player-presence.players, player-presence.pending-moves` — le
mécanisme suppose un déploiement orchestré (nouveau core démarré avant l'arrêt
de l'ancien), ce qu'un restart brutal ne fait pas.

Le défaut à corriger n'est pas le handoff lui-même mais **l'absence totale de
détection** : le client doit repérer que ses ordres restent sans acquittement
et le dire au joueur. Le 1.29 affiche une boîte de dialogue de perte de
connexion. Ici l'interface ment activement en affichant « Connected ».

#### Note de correction — 2026-08-20

**La détection a été placée au gateway, pas au client.** Le rapport proposait
un timeout d'acquittement côté client ; c'est le seul endroit qui ne sait
*rien*. Le gateway, lui, voit le lien UDS du core tomber puis revenir hors
handoff : à cet instant précis l'état de session du core est prouvablement
perdu. Il ferme donc les WebSockets qu'il tenait pour ce core, avec le code
applicatif **4001 / `core_gone`**. Aucune heuristique, aucun délai à régler,
aucun faux positif sous latence.

Portée de la fermeture, dans `apps/gameserver-ts/src/gateway/upstream.ts` :

- seules les sessions **du rôle concerné** partent — un `gamed` qui redémarre
  ne touche pas aux sessions `authd` en cours de login ;
- seules les sessions **existant à l'instant de la coupure** partent. Un
  client qui se connecte *pendant* l'indisponibilité est annoncé au nouveau
  core depuis le buffer et reste parfaitement valide : c'est exactement ce que
  QA-048 rend possible, et la correction ici ne devait pas le reprendre ;
- un **handoff ne ferme personne** : le lien qui meurt n'est plus l'actif, et
  son état a déjà été transféré.

Côté client, trois défauts s'ajoutaient à l'absence de détection :

- `setOnConnected` / `setOnDisconnected` (`game/game-client.ts`) existaient et
  n'étaient **appelés par personne** ;
- le badge « Connected » de `MapRenderer.tsx` était un `useState` renseigné
  **une seule fois au montage**. Il mentait donc aussi sur une coupure réseau
  franche, pas seulement sur une session zombie ;
- `Connection.scheduleReconnect` abandonnait **en silence** une fois les
  tentatives épuisées : l'appelant recevait un `disconnected`, puis plus rien —
  indistinguable d'un lien sain et inactif.

Ce qui a été fait : un `connectionStore` porte l'état réel
(`connecting` / `connected` / `reconnecting` / `lost`), le badge et
`hudStore.connected` le lisent en direct, `Connection` émet un événement
`failed` quand il renonce, ne retente plus rien sur 4001 (une socket neuve
vers un serveur qui nous a oubliés ne répare rien), et une modale
« Connexion au serveur perdue » s'affiche au-dessus de l'auth comme du jeu,
avec un seul bouton : retour à l'écran de connexion. Ce retour est un
rechargement complet, assumé — l'état d'une session est réparti entre des
acteurs xstate de portée module, le battlefield Pixi, l'audio et une demi-
douzaine de stores, dont aucun n'a de chemin de démontage aujourd'hui.

Couverture : 3 tests gateway sur vraies sockets UDS (fermeture ciblée par
rôle, survie d'un client arrivé pendant la coupure, handoff qui ne ferme
personne), 4 tests sur la politique de retry de `Connection` et 6 tests sur le
câblage client → état affiché. Les tests ont été vérifiés rouges sans le
correctif.

Vérification Docker : `docker restart dofuspixiclient-gamed-1`, la session
ouverte avant la coupure reçoit `close code=4001 reason="core_gone"` en
**62 ms**, un client connecté pendant l'indisponibilité reste ouvert et
survit au retour du core, et les sessions `authd` ne bougent pas.

**Duplication assumée** : le code 4001 est défini deux fois, dans
`apps/gameserver-ts/src/gateway/close-codes.ts` et
`apps/electrobun/src/game/network/close-codes.ts`. Les deux applications sont
des déployables distincts sans paquet runtime commun ; chaque fichier renvoie
explicitement à l'autre.

**Ce qui n'est pas corrigé ici** : la reprise de session elle-même. Un joueur
déconnecté par un redémarrage de core doit se reconnecter et perd sa
progression non enregistrée. Le rendre transparent suppose un handoff
orchestré à chaque redémarrage, ou une restauration d'état côté core à partir
de la base — deux chantiers d'une autre taille.

**QA-047 — P3 — Un clic hors de la zone de map est correctement ignoré**
`vérifié, RAS` · Aucun log, aucune trame. Comportement attendu.

**QA-048 — P0 — Le gateway ne sort jamais du mode buffering après une reconnexion au core**
`à revérifier` · **Corrigé le 2026-08-20** — voir la note de correction en fin
d'entrée. Le mécanisme est vérifié bout en bout sur la stack Docker ; reste à
repasser le parcours joueur complet (login → liste des personnages) pour clore.

**Cause racine identifiée** — mais le correctif n'est pas d'une ligne.

Reproduction :
1. `docker restart dofuspixiclient-gamed-1` (client connecté ou non) ;
2. recharger le client et se reconnecter (`dev` / `dev` → Server #1).

Résultat : l'écran de sélection affiche **« No characters on this server. »**
alors que `select * from players` retourne bien `Dev` (id 1, account 1,
server 1). Reproduit deux fois d'affilée. Le personnage n'est pas perdu — il
est simplement inatteignable, ce qui rend le message doublement trompeur.

Chaîne d'événements, relevée dans les logs du gateway :

```
"active core disconnected — buffering"          ← buffering = true
"uds connect failed, retrying"  reconnectMs:500
"connected to core"                             ← reconnecté…
```

puis `/health` :

```json
{"role":"game","active":"/sockets/gamed.sock","buffering":true,"buffered":7}
```

Le gateway s'est bien reconnecté, mais **reste en `buffering: true` avec 7
trames en file, jamais transmises**. `authd` reçoit et traite tout
normalement (`login ok`, `ticket: account=1 server=1`), tandis que `gamed`
ne logge plus rien du tout depuis son démarrage : aucune trame `/game` ne lui
parvient.

Dans `apps/gameserver-ts/src/gateway/upstream.ts` :

- `onDisconnect` (l. 64-72) pose `this.buffering = true` quand le lien actif
  meurt ;
- seuls `setActive()` (l. 83) et le chemin de handoff (l. 250) remettent
  `buffering = false` ;
- or `udsConnect` **reconnecte le même objet `link`** en boucle. Sa callback
  `onConnect` (l. 58-62) se contente de `link.resolveReady()` — elle
  n'appelle jamais `setActive`, puisque `this.active === link` l'est déjà.

`buffering` reste donc `true` définitivement, et `forwardClient` (l. 98)
empile toute trame client jusqu'à `BUFFER_CAP`.

Correctif : dans `onConnect`, si `this.active === link`, remettre
`this.buffering = false` puis appeler `this.flushBuffer()`.

Portée : c'est le mécanisme de zéro-downtime qui justifie tout le découpage
gateway / core décrit dans `doc/architecture.md`. Il est cassé sur le scénario
le plus courant — un core qui redémarre sans handoff orchestré, c'est-à-dire
tout crash et tout `just gamed` en watch mode. **Seul un redémarrage du
gateway rétablit le service**, alors que le gateway est précisément le
composant censé ne jamais redémarrer.

QA-046 (session zombie côté client) est la face visible de ce même bug : le
client ne détecte pas que ses trames partent dans le vide.

#### Note de correction — 2026-08-20

Le correctif d'une ligne envisagé plus haut **ne suffisait pas**. Remettre
`buffering = false` dans `onConnect` lève bien le blocage, mais les trames
mises en file partent quand même dans le vide, pour une seconde raison :

- dans `packages/uds-transport/src/client.ts`, `current` n'est réassigné qu'au
  retour du `await Bun.connect(...)`, alors que `onConnect` est appelé
  *pendant* ce connect. À l'instant du rappel, `current` pointe encore sur la
  socket morte, et `send()` — qui teste `current && isOpen(current)` — jette
  silencieusement tout ce qu'on lui donne. Le vidage du buffer déclenché depuis
  `onConnect` était donc entièrement perdu. La socket est maintenant publiée
  avant l'appel du rappel.

Deux défauts voisins ont été corrigés dans la foulée, parce qu'ils produisent
exactement le même symptôme par un autre chemin :

- `sessionOpen` / `sessionClose` court-circuitaient le buffer et partaient
  directement sur la socket : une session ouverte pendant la coupure n'était
  jamais annoncée au nouveau core, et ses trames arrivaient ensuite pour une
  session qu'il ne connaissait pas. Tout passe désormais par la même file, ce
  qui garantit aussi l'ordre `open` → messages → `close`.
- un handoff qui échoue laissait `standby` positionné (tout handoff ultérieur
  refusé) et `buffering` à `true` — le gel de QA-048, par une autre route. Le
  repli sur le core actif est maintenant explicite.

Enfin, le journal d'un buffer saturé émettait une ligne **par trame perdue** :
mesuré à 190 ms et 200 000 notifications de l'UI Ink pour 200 000 trames, soit
un ralentissement auto-infligé au pire moment. Une ligne à l'ouverture de
l'épisode, un décompte à la reprise.

Couverture : `apps/gameserver-ts/src/gateway/upstream.spec.ts`, 7 tests sur de
vraies sockets UDS (redémarrage de core, ordre des trames de session, plafond
du buffer, handoff nominal, handoff en échec). Vérifié aussi sur la stack
Docker : `docker restart dofuspixiclient-gamed-1` puis `/health` repasse à
`buffering:false` en moins de 2 s, et une trame émise pendant la coupure est
rejouée et traitée par `gamed`.

**Ce qui n'est pas corrigé ici** : le core redémarré a perdu l'état des
sessions déjà en jeu. Le gateway relaie de nouveau, mais un joueur connecté
avant la coupure reste sans état côté serveur — c'est QA-046, traité depuis
(voir sa note de correction du même jour).

### Interactions de la bannière et du monde

**QA-049 — P1 — Aucun retour visuel au survol d'une cellule** · `confirmé`
Survol d'une cellule marchable pendant 600 ms, capture de la zone avant/après :
**zéro pixel modifié**. Le 1.29 pose un losange bleu translucide sur la cellule
survolée et change le curseur. Sans ce retour, on ne sait jamais où l'on va
cliquer — c'est le manque d'ergonomie le plus sensible en jeu, avec l'absence
d'animation d'attente (QA-025).

**QA-050 — P1 — 194 objets interactifs chargés sur la map, aucun n'est cliquable**
`confirmé` · `battlefield.interactiveObjectsData.size` → **194** sur la map
courante, mais `pickingSystem.getPickableObjects().length` → **1** (le
personnage seul). Les portes, zaaps, ressources et éléments de décor
interactifs sont donc décodés et stockés, sans jamais être enregistrés auprès
du système de picking. Rien dans le monde n'est actionnable.

**QA-051 — P2 — Les quatre secteurs de la boussole sont inertes** · `confirmé`
Clic sur chacun des quatre secteurs de l'anneau (haut / droite / bas / gauche) :
aucun log, aucune trame, aucun changement. Ce sont les flèches de changement de
map du 1.29.

**QA-052 — P2 — Les quatre boutons utilitaires de la bannière sont inertes**
`confirmé` · `Expand chat`, `Open emotes`, `Sit down` (coin haut-gauche) et le
bouton `More` (« + » orange à droite) : clic → `document.body.innerText`
inchangé, aucun log, aucune erreur. « S'asseoir » et le panneau d'émotes sont
des fonctions 1.29 courantes.

**QA-053 — P3 — Libellés d'accessibilité cassés sur les boutons de menu**
`ouvert` · Les neuf boutons ronds exposent comme nom accessible la
concaténation des textes alternatifs de leurs deux images d'état :
`"ButtonButton pressedStat"`, `"ButtonButton pressedSpel"`,
`"ButtonButton pressedInve"`… Attendu : « Caractéristiques », « Sorts »,
« Inventaire ». Les trois boutons du coin chat sont eux nommés, mais en
anglais (`Expand chat`, `Open emotes`, `Sit down`).

**QA-054 — P3 — La boussole affiche bien un extrait de carte du monde**
`vérifié, RAS` · Vérification faite : la minimap se met à jour au changement de
map (pixels comparés avant / après) et montre un extrait de la carte du monde
centré sur le joueur — ce qui est le comportement 1.29 correct. Seul le
marqueur reste à corriger (QA-009).

### Audio

**QA-055 — RAS — L'audio fonctionne de bout en bout** · `vérifié`
C'est une des parties les mieux finies du client. Vérifié en instrumentant le
constructeur `Audio` et l'`AudioManager` :

- `playMusic(115)` crée `/assets/sound/musics/loc_amakna.mp3`, `play()` réussit,
  volume `0.225` en cours de fondu vers `0.3`, position `2,9 s` — la piste joue
  réellement ;
- l'ambiance tourne aussi : les bruits aléatoires de l'ambiance 7
  (`fx_512`, `fx_511`, `fx_510`) sont créés et joués, conformément à son
  entrée `n:[487,488,510,511,512,513]` ;
- le bundle `langs/fr/audio.json` résout correctement (`115 → loc_amakna.mp3`,
  `118 → loc_cania.mp3`) et la base porte bien les ids (7 061 maps avec
  musique, 7 505 avec ambiance) ;
- aucun échec de lecture, aucun fichier manquant.

**QA-056 — P2 — Aucun réglage de volume ni de coupure du son dans l'interface**
`confirmé` · `AudioManager` gère trois canaux avec volumes et mutes
(`music: 0.3`, `environment: 0.3`, `effects: 0.5`) et expose `setVolume` /
`setMuted`, mais **aucun `.tsx` du HUD ne les appelle**. Il n'existe par
ailleurs aucun panneau d'options : `PanelName` se limite à `stats`, `spells`,
`inventory`, `quests`, `friends`, `guild`, `mount`, `conquest`. Le joueur ne
peut ni baisser ni couper le son. Le 1.29 a un panneau d'options avec un
curseur par canal.

### Sessions et comptes

**QA-057 — P1 — Un même compte pouvait ouvrir autant de fenêtres qu'il voulait**
`à revérifier` · **Corrigé le 2026-08-20.** Découvert en testant QA-046 : deux
fenêtres se connectent en parallèle sur le compte `dev`, aucune n'est
déconnectée, et elles peuvent piloter **le même personnage**.

Rien ne l'interdisait à aucun étage :

- `login.handler.ts` vérifiait identifiants et bannissement, puis appelait
  `attachAccount` sans chercher si le compte avait déjà une session ;
- les tickets sont bien à usage unique (`redeem` fait `where usedAt is null` →
  `set usedAt`), mais la seconde fenêtre refait un login complet et obtient son
  propre ticket, parfaitement légitime — l'unicité du ticket protège du rejeu,
  pas de la seconde connexion ;
- `select-character.handler.ts` vérifiait que le personnage appartient au
  compte, pas que personne d'autre ne le joue.

Le `SessionRegistry` du core n'était indexé que par `sessionId` : il n'y avait
littéralement nulle part où chercher. Côté base, `markLoggedIn` n'écrit que
`lastLoginAt` / `lastLoginIp`, aucun état « en ligne ».

Le dégât n'est pas théorique : `PlayerPresenceService` indexe `byCharacter`
(personnage → map) et `bySession` (session → personnage). Deux sessions sur le
même personnage écrasent `byCharacter`, et le premier départ laisse une entrée
`bySession` orpheline.

Signe que l'intention était là : `LOGIN_ERROR_ALREADY_ONLINE = 3` existe dans
`proto/account.proto` et le client sait déjà l'afficher (`auth.handler.ts`).
Seul le test côté serveur n'avait jamais été écrit.

#### Note de correction — 2026-08-20

**On éjecte l'ancienne session, on ne refuse pas la nouvelle** — un joueur
réellement déconnecté doit pouvoir revenir sans attendre l'expiration de
l'ancienne.

Le core sait qui devrait être connecté, le gateway seul possède la socket. Le
core lui envoie donc un `SessionClose` — la trame existait déjà, employée
jusqu'ici seulement dans le sens gateway → core ; elle devient bidirectionnelle,
et dans ce sens signifie « raccroche ». **Aucune régénération `buf`.** Le
gateway traduit le motif en code de fil (`account_taken_over` → **4002**), et le
client réutilise toute la machinerie de QA-046 : pas de reconnexion, modale
« Votre compte a été connecté depuis un autre endroit », retour au login.

L'éjection passe par un point unique, `SessionEvictionService.evictAccount()`,
appelé au login `authd` **et** à la redemption du ticket `gamed` — c'est ce
second point qui remplace réellement une session en jeu. Elle ferme la session
localement, donc le départ du monde emprunte la saga `session.closed` existante,
comme une déconnexion ordinaire.

Garde-fous, tous couverts par des tests vérifiés rouges d'abord :

- **un login raté n'éjecte personne** (mot de passe faux, compte banni, pseudo
  inconnu, ticket refusé). Sans ce garde, connaître un pseudo suffirait à
  déconnecter un joueur à volonté ;
- jamais d'auto-éjection ;
- `restore()` reconstruit l'index par compte après un handoff — sans quoi un
  déploiement bleu/vert désactiverait silencieusement toute la détection ;
- un `accountId` vide n'est jamais indexé (les sessions s'ouvrent anonymes) ;
- pas de boucle : le `sessionClose` que le gateway renvoie tombe sur une session
  déjà retirée ;
- 4002 est non-retryable côté client, donc la fenêtre éjectée ne peut pas
  éjecter l'autre en retour.

Vérifié sur la stack Docker, parcours complet login → sélection serveur →
ticket : la fenêtre A est fermée en `4002 account_taken_over` **31 ms** après
que B a présenté son ticket, `/health` reste à `sessions:1`. Un mot de passe
faux depuis une seconde fenêtre laisse la première intacte, et un
`docker restart gamed` ferme toujours en `4001 core_gone` — les deux chemins
restent distincts.

**Ce qui n'est pas corrigé ici : la reprise de session.** Après éjection, le
personnage quitte le monde et le joueur repasse par le login. En 1.29 il
reprendrait sa partie, combat compris. Ce n'est pas un défaut introduit ici —
le combat est indexé par `sessionId` (`fight.fighter.ts`, `fight.registry.ts`,
et l'audience des diffusions dans `fight.entity.ts`) et **rien n'écoute
`session.closed` côté combat** : `FightLeaveHandler` ne répond qu'au
`GameLeaveRequest` explicite. Une simple coupure réseau en plein combat laisse
déjà un combattant orphelin. L'éjection ajoute un déclencheur à ce défaut, pas
le défaut.

Points d'accroche déjà en place pour ce chantier, à ne pas défaire :
`SessionLeaveSaga.onSessionClosed({ session, reason })` reçoit déjà le motif —
c'est là que se branchera le délai de grâce ; `FightRegistryService`
`registerSession()` / `unregisterSession()` et `Fighter.sessionId`, mutable,
permettent de rebrancher un combattant sur une nouvelle session ; et la reprise
devra s'accrocher à la **sélection de personnage**, pas au ticket, puisqu'au
moment du ticket on ne connaît que le compte.

---

## Non testé, et pourquoi

**Le combat n'a pas pu être testé du tout.** C'est le cœur de Dofus et la plus
grosse lacune de cette session. Deux verrous :

1. QA-034 — aucun monstre ne se pose sur aucune map (`monster_templates` vide),
   donc aucun combat PvM ne peut être déclenché ;
2. il n'existe pas de second personnage ni de commande de debug pour amorcer un
   combat autrement.

J'ai tenté d'insérer quelques `monster_templates` minimaux dans la base de
développement pour débloquer ce test ; **l'écriture a été refusée par la
politique de permissions de l'environnement** et je ne l'ai pas contournée.

Restent donc entièrement à couvrir, une fois les monstres disponibles :
placement, tours et timer, PA/PM en combat, lancer de sorts et runtime
d'animation (`spell-runtime`, 87 handlers d'effets et 45 types de défis
enregistrés côté serveur), dégâts et soins, mort, fin de combat et butin,
mode tactique en situation réelle (QA-043), et les FPS sous charge de combat.

Pour débloquer : peupler `monster_templates` / `monster_levels` (et
`npc_templates`, `item_templates`) depuis le dump StarLoco, de la même manière
que `just import-maps` peuple déjà les 9 358 maps.
