import { msg } from "@lingui/core/macro";

export const statsTooltips = {
  energy: msg`Points d'énergie : perdus en cas de mort. Régénérés en se déconnectant dans une zone de sauvegarde.`,
  xp: msg`Points d'expérience : en gagnant suffisamment de points d'expérience, vous gagnez un niveau.`,
  hp: msg`Points de vie : si vos points de vie tombent à 0 en combat, vous êtes vaincu.`,
  ap: msg`Points d'action : utilisés pour lancer des sorts et effectuer des actions en combat.`,
  mp: msg`Points de mouvement : chaque case de déplacement en combat coûte 1 PM.`,
  initiative: msg`Initiative : détermine l'ordre de jeu en combat. Plus elle est élevée, plus vous jouez tôt.`,
  prospection: msg`Prospection : augmente vos chances de trouver des objets sur les monstres vaincus.`,
  vitality: msg`Vitalité : chaque point de vitalité augmente vos points de vie maximum de 1.`,
  wisdom: msg`Sagesse : augmente les points d'expérience gagnés et la résistance aux pertes de PA/PM.`,
  strength: msg`Force : augmente les dégâts de terre et le pods transportable.`,
  intelligence: msg`Intelligence : augmente les dégâts de feu et les soins.`,
  chance: msg`Chance : augmente les dégâts d'eau et la prospection.`,
  agility: msg`Agilité : augmente les dégâts d'air, l'esquive PA/PM et la fuite.`,
  capital: msg`Points de capital : utilisez-les pour augmenter vos caractéristiques.`,
  quill: msg`Plus de statistiques`,
};

export const statsLabels = {
  energy: msg`Energie`,
  xp: msg`Expérience`,
  hp: msg`Points de vie`,
  ap: msg`Points d'actions`,
  mp: msg`Points de mouvement`,
  initiative: msg`Initiative`,
  prospection: msg`Prospection`,
  characteristics: msg`Caractéristiques`,
  vitality: msg`Vitalité`,
  wisdom: msg`Sagesse`,
  strength: msg`Force`,
  intelligence: msg`Intelligence`,
  chance: msg`Chance`,
  agility: msg`Agilité`,
  capital: msg`Capital`,
  jobs: msg`Mes métiers`,
  specializations: msg`Spécialisations`,
  level: msg`Niveau {level}`,
  energyTip: msg`Énergie : {energy} / {maxEnergy}`,
  xpTip: msg`Expérience : {current} / {range} (niveau {level})`,
  boostTip: msg`+1 {name} : coûte {cost} point(s) de capital`,
};

export const worldMapLabels = {
  title: msg`Carte du monde`,
};

export const combatLabels = {
  pass: msg`Pass`,
  forfeit: msg`Forfeit`,
};

export const spellsLabels = {
  title: msg`Sorts`,
  spellList: msg`Liste des sorts`,
  boostPoints: msg`Points de sorts`,
  name: msg`Nom`,
  level: msg`Niveau`,
  filterAll: msg`Tous`,
  filterGuild: msg`Guilde`,
  filterWater: msg`Eau`,
  filterFire: msg`Feu`,
  filterEarth: msg`Terre`,
  filterAir: msg`Air`,
  filterUpgradable: msg`Améliorables`,
  spellType: msg`Type de sort`,
};

export const inventoryLabels = {
  title: msg`Inventaire`,
  kamas: msg`Kamas`,
  weight: msg`Pods`,
  filterEquipment: msg`Equipement`,
  filterNonEquipment: msg`Divers`,
  filterResources: msg`Ressources`,
  filterRunes: msg`Runes`,
  filterCards: msg`Cartes`,
  filterSouls: msg`Ames`,
  filterQuest: msg`Quête`,
  equipment: msg`Equipement`,
  noItem: msg`Aucun objet`,
};

export const questsLabels = {
  title: msg`Quêtes`,
  currentStep: msg`Etape en cours`,
  stepsList: msg`Liste des étapes`,
  finishedQuests: msg`Quêtes terminées`,
  questCount: msg`{count} quête(s)`,
  status: msg`Etat`,
  name: msg`Nom`,
  steps: msg`Etapes`,
};

export const friendsLabels = {
  title: msg`Amis`,
  friends: msg`Amis`,
  enemies: msg`Ennemis`,
  ignored: msg`Ignorés`,
  online: msg`En ligne`,
  offline: msg`Hors ligne`,
  addFriend: msg`Ajouter un ami`,
  addEnemy: msg`Ajouter un ennemi`,
  addIgnored: msg`Ajouter un ignoré`,
  add: msg`Ajouter`,
  pseudonym: msg`Pseudo`,
  info: msg`Informations`,
};

export const guildLabels = {
  title: msg`Guilde`,
  members: msg`Membres`,
  info: msg`Infos`,
  boosts: msg`Boosts`,
  taxCollectors: msg`Percepteurs`,
  mountParks: msg`Enclos`,
  houses: msg`Maisons`,
  guildNote: msg`Note de guilde`,
  noData: msg`Aucune donnée`,
  level: msg`Niveau {level}`,
  emblem: msg`Emblème`,
  xp: msg`Expérience`,
};

export const mountLabels = {
  title: msg`Monture`,
  xp: msg`Expérience`,
  ride: msg`Monter`,
  release: msg`Libérer`,
  noMount: msg`Aucune monture`,
  energy: msg`Energie`,
  maturity: msg`Maturité`,
  love: msg`Amour`,
  name: msg`Nom`,
  inventory: msg`Inventaire`,
};

export const conquestLabels = {
  title: msg`Conquête`,
  stats: msg`Stats`,
  zones: msg`Zones`,
  join: msg`Rejoindre`,
  worldBalance: msg`Equilibre mondial`,
  areaBalance: msg`Equilibre de zone`,
  pvpActive: msg`PvP Actif`,
  pvpInactive: msg`PvP Inactif`,
  alignment: msg`Alignement`,
  guildRanking: msg`Classement de guilde`,
};
