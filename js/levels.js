'use strict';
/**
 * Level table. Each level tunes the run:
 *   goal       'survive' (reach the time limit; killing the boss also wins)
 *              'boss'    (defeat the boss before time runs out)
 *              'kills'   (reach `kills` before time runs out)
 *   time       time limit in seconds
 *   bossAt     seconds into the run when the boss arrives (null = no boss)
 *   spawn      director spawn-rate multiplier; ramp = how fast it escalates over time
 *   relax      [min, max] seconds of calm between surges
 *   maxEnemies on-screen enemy cap
 *   speed/hp/dmg  enemy multipliers
 *   squad      antibody squad size [early, after 30s]
 *   mix        enemy ShuffleBags by stage: [[startSecond, bag], ...]
 *   boss       { hp, dmg, atk } multipliers (atk = attack speed)
 *   stars      score needed for [2 stars, 3 stars] (1 star = win)
 */
const LEVELS = [
  {
    id: 1, name: 'First Division', goal: 'survive', time: 45, bossAt: null,
    spawn: 0.7, ramp: 0.6, relax: [6, 10], maxEnemies: 30,
    speed: 0.85, hp: 0.8, dmg: 0.8, squad: [2, 3],
    mix: [[0, ['wbc']], [20, ['wbc', 'wbc', 'wbc', 'dart']]],
    boss: { hp: 1, dmg: 1, atk: 1 },
    stars: [2200, 3200],
  },
  {
    id: 2, name: 'Antibody Alert', goal: 'survive', time: 60, bossAt: null,
    spawn: 0.85, ramp: 0.8, relax: [5, 9], maxEnemies: 36,
    speed: 0.92, hp: 0.9, dmg: 0.9, squad: [3, 3],
    mix: [[0, ['wbc', 'wbc', 'dart']], [25, ['wbc', 'dart', 'dart']]],
    boss: { hp: 1, dmg: 1, atk: 1 },
    stars: [4500, 6500],
  },
  {
    id: 3, name: 'The Queen', goal: 'survive', time: 75, bossAt: 60,
    spawn: 1, ramp: 1, relax: [5, 10], maxEnemies: 50,
    speed: 1, hp: 1, dmg: 1, squad: [3, 4],
    mix: [
      [0, ['wbc', 'wbc', 'wbc', 'wbc', 'dart']],
      [15, ['wbc', 'wbc', 'wbc', 'dart', 'dart', 'macro']],
      [35, ['wbc', 'wbc', 'dart', 'dart', 'macro', 'macro']],
    ],
    boss: { hp: 0.85, dmg: 0.9, atk: 1 },
    stars: [6500, 9500],
  },
  {
    id: 4, name: 'Macro Mass', goal: 'kills', kills: 45, time: 90, bossAt: null,
    spawn: 1, ramp: 1, relax: [4, 8], maxEnemies: 45,
    speed: 1, hp: 1, dmg: 1, squad: [3, 3],
    mix: [[0, ['wbc', 'wbc', 'macro']], [30, ['wbc', 'macro', 'macro', 'dart']]],
    boss: { hp: 1, dmg: 1, atk: 1 },
    stars: [6000, 9000],
  },
  {
    id: 5, name: 'Rush Hour', goal: 'survive', time: 60, bossAt: null,
    spawn: 1.35, ramp: 1.2, relax: [3, 6], maxEnemies: 50,
    speed: 1.1, hp: 1, dmg: 1.05, squad: [4, 5],
    mix: [[0, ['wbc', 'dart', 'dart']], [25, ['wbc', 'dart', 'dart', 'dart', 'macro']]],
    boss: { hp: 1, dmg: 1, atk: 1 },
    stars: [10000, 15000],
  },
  {
    id: 6, name: 'Royal Hunt', goal: 'boss', time: 120, bossAt: 30,
    spawn: 1.05, ramp: 1, relax: [5, 8], maxEnemies: 45,
    speed: 1.05, hp: 1.1, dmg: 1.05, squad: [3, 4],
    mix: [[0, ['wbc', 'wbc', 'dart', 'macro']]],
    boss: { hp: 1.1, dmg: 1.1, atk: 1.05 },
    stars: [9000, 12500],
  },
  {
    id: 7, name: 'Swarm Tide', goal: 'survive', time: 90, bossAt: 75,
    spawn: 1.3, ramp: 1.1, relax: [4, 7], maxEnemies: 60,
    speed: 1.1, hp: 1.2, dmg: 1.1, squad: [4, 4],
    mix: [[0, ['wbc', 'wbc', 'wbc', 'wbc', 'dart']], [40, ['wbc', 'wbc', 'wbc', 'dart', 'macro']]],
    boss: { hp: 1.2, dmg: 1.15, atk: 1.1 },
    stars: [11000, 15500],
  },
  {
    id: 8, name: 'Heavy Tissue', goal: 'kills', kills: 80, time: 100, bossAt: null,
    spawn: 1.25, ramp: 1.1, relax: [3, 6], maxEnemies: 55,
    speed: 1.1, hp: 1.4, dmg: 1.2, squad: [4, 5],
    mix: [[0, ['wbc', 'macro', 'dart']], [35, ['macro', 'macro', 'wbc', 'dart', 'dart']]],
    boss: { hp: 1, dmg: 1, atk: 1 },
    stars: [9000, 12500],
  },
  {
    id: 9, name: 'Fever', goal: 'survive', time: 90, bossAt: 70,
    spawn: 1.4, ramp: 1.2, relax: [3, 6], maxEnemies: 60,
    speed: 1.25, hp: 1.35, dmg: 1.2, squad: [4, 5],
    mix: [[0, ['wbc', 'wbc', 'dart', 'dart']], [30, ['wbc', 'dart', 'dart', 'macro', 'macro']]],
    boss: { hp: 1.45, dmg: 1.25, atk: 1.15 },
    stars: [16000, 24000],
  },
  {
    id: 10, name: 'Queen’s Court', goal: 'boss', time: 150, bossAt: 40,
    spawn: 1.3, ramp: 1.2, relax: [3, 6], maxEnemies: 60,
    speed: 1.2, hp: 1.5, dmg: 1.25, squad: [5, 5],
    mix: [[0, ['wbc', 'dart', 'macro', 'macro']]],
    boss: { hp: 1.8, dmg: 1.4, atk: 1.25 },
    stars: [16000, 23000],
  },
  {
    id: 11, name: 'Cytokine Storm', goal: 'survive', time: 100, bossAt: 80,
    spawn: 1.6, ramp: 1.3, relax: [2, 4], maxEnemies: 65,
    speed: 1.3, hp: 1.6, dmg: 1.3, squad: [5, 6],
    mix: [[0, ['wbc', 'wbc', 'dart', 'dart', 'macro']], [40, ['wbc', 'dart', 'dart', 'macro', 'macro']]],
    boss: { hp: 2, dmg: 1.45, atk: 1.3 },
    stars: [30000, 45000],
  },
  {
    id: 12, name: 'Immune Overlord', goal: 'boss', time: 180, bossAt: 45,
    spawn: 1.7, ramp: 1.4, relax: [2, 4], maxEnemies: 70,
    speed: 1.35, hp: 1.8, dmg: 1.4, squad: [5, 6],
    mix: [[0, ['wbc', 'dart', 'dart', 'macro']], [60, ['dart', 'dart', 'macro', 'macro', 'wbc']]],
    boss: { hp: 2.5, dmg: 1.6, atk: 1.4 },
    stars: [25000, 36000],
  },
];

const Levels = {
  list: LEVELS,
  count: LEVELS.length,
  get(id) { return LEVELS.find(l => l.id === id) || LEVELS[0]; },

  /** Short objective text for banners and the level grid. */
  objective(l) {
    if (l.goal === 'boss') return 'Defeat the Queen in ' + l.time + 's';
    if (l.goal === 'kills') return 'Kill ' + l.kills + ' in ' + l.time + 's';
    return 'Survive ' + l.time + 's' + (l.bossAt != null ? ' — Queen at the end' : '');
  },

  /** 0 when lost; 1-3 when won, based on score thresholds. */
  stars(l, score, won) {
    if (!won) return 0;
    return 1 + (score >= l.stars[0] ? 1 : 0) + (score >= l.stars[1] ? 1 : 0);
  },

  /** DNA earned for a run: score + kills, bonus on win (bigger the first time). */
  dnaReward(l, { score, kills, won, firstClear }) {
    let dna = Math.floor(score / 400) + Math.floor(kills / 5);
    if (won) dna += 10 + l.id * 4;
    if (firstClear) dna += 15 + l.id * 3;
    return dna;
  },
};
