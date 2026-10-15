'use strict';
// Permanent upgrades bought with DNA. Applied to the player at the start of every run.

const UPGRADE_COST_STEPS = [1, 2, 3.5, 6, 10];

const UPGRADES = {
  maxHP: {
    name: 'Thick Wall', color: '#ff9e5e', base: 25,
    desc: t => `+${t * 15} max HP`,
    apply: (p, t) => { p.maxHp += t * 15; p.hp = p.maxHp; },
  },
  speed: {
    name: 'Cilia', color: '#7fb8ff', base: 30,
    desc: t => `+${t * 5}% move speed`,
    apply: (p, t) => { p.speedMult += t * 0.05; },
  },
  damage: {
    name: 'Toxins', color: '#ff7a7a', base: 35,
    desc: t => `+${t * 10}% damage`,
    apply: (p, t) => { p.dmgMult += t * 0.1; },
  },
  startSwarm: {
    name: 'Colony', color: '#5ef0d0', base: 40,
    desc: t => `Start with ${t} extra cell${t === 1 ? '' : 's'}`,
    apply: (p, t, api) => { if (t > 0) api.addFollowers(t); },
  },
  xpGain: {
    name: 'Metabolism', color: '#6fd3ff', base: 30,
    desc: t => `+${t * 10}% XP gain`,
    apply: (p, t) => { p.xpMult += t * 0.1; },
  },
  magnet: {
    name: 'Receptors', color: '#b98cff', base: 20,
    desc: t => `+${t * 20}% pickup radius`,
    apply: (p, t) => { p.magnet *= 1 + t * 0.2; },
  },
};

const Upgrades = {
  defs: UPGRADES,
  ids: Object.keys(UPGRADES),
  MAX_TIER: UPGRADE_COST_STEPS.length,

  tier(id) { return Math.min(GameStorage.getUpgradeTier(id), this.MAX_TIER); },
  /** Cost of the next tier, or null when maxed. */
  nextCost(id) {
    const t = this.tier(id);
    return t >= this.MAX_TIER ? null : Math.round(UPGRADES[id].base * UPGRADE_COST_STEPS[t]);
  },
  canBuy(id) {
    const c = this.nextCost(id);
    return c !== null && GameStorage.getDNA() >= c;
  },
  buy(id) {
    const c = this.nextCost(id);
    if (c === null) return false;
    return GameStorage.buyUpgrade(id, c, this.MAX_TIER) > 0;
  },
  /** Apply every owned tier to a fresh player. api = game API (addFollowers, heal). */
  applyAll(player, api) {
    for (const id of this.ids) {
      const t = this.tier(id);
      if (t > 0) UPGRADES[id].apply(player, t, api);
    }
  },
};
