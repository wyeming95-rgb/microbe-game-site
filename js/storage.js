'use strict';
/**
 * Save-data layer. Everything persistent (profile, level progress, DNA, upgrades)
 * goes through window.GameStorage; nothing else touches localStorage.
 *
 * Design (so a remote backend such as Supabase can replace localStorage later):
 *   - A backend adapter owns I/O: { load(): Promise<object|null>, save(data): Promise }.
 *   - GameStorage.init() loads once (async) into an in-memory cache.
 *   - Reads are synchronous from the cache; every write updates the cache, then
 *     persists via the adapter (fire-and-forget, errors are logged, never thrown).
 *   - To swap backends: GameStorage.useBackend(myAdapter) before init().
 *
 * Named GameStorage (not Storage) because window.Storage is the built-in
 * Web Storage interface that localStorage itself is an instance of.
 */
(() => {
  const KEY = 'microbe.save.v1';

  function defaultData() {
    return {
      version: 1,
      profile: null,          // { name, email, createdAt }
      dna: 0,
      upgrades: {},           // { [upgradeId]: tier }
      levels: {},             // { [levelId]: { best, stars, cleared, plays } }
      unlocked: 1,            // highest unlocked level id
    };
  }

  /** Default backend: one JSON blob in localStorage. */
  const localBackend = {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (_) {
        return Promise.resolve(null); // private mode / corrupt JSON
      }
    },
    save(data) {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* quota / private mode */ }
      return Promise.resolve();
    },
  };

  let backend = localBackend;
  let data = defaultData();
  let ready = null;

  /** Merge loaded data over defaults so older/partial saves stay valid. */
  function normalize(raw) {
    const d = defaultData();
    if (!raw || typeof raw !== 'object') return d;
    if (raw.profile && typeof raw.profile.name === 'string') d.profile = raw.profile;
    d.dna = Math.max(0, Math.floor(Number(raw.dna) || 0));
    if (raw.upgrades && typeof raw.upgrades === 'object') {
      for (const [k, v] of Object.entries(raw.upgrades)) d.upgrades[k] = Math.max(0, Math.floor(Number(v) || 0));
    }
    if (raw.levels && typeof raw.levels === 'object') d.levels = raw.levels;
    d.unlocked = Math.max(1, Math.floor(Number(raw.unlocked) || 1));
    return d;
  }

  function persist() {
    const snapshot = JSON.parse(JSON.stringify(data));
    Promise.resolve(backend.save(snapshot)).catch(err => console.warn('[GameStorage] save failed', err));
  }

  const copy = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

  const GameStorage = {
    KEY,

    useBackend(adapter) { backend = adapter; ready = null; },

    /** Load save data once. Safe to call repeatedly. */
    init() {
      if (!ready) {
        ready = Promise.resolve(backend.load())
          .catch(() => null)
          .then(raw => { data = normalize(raw); });
      }
      return ready;
    },

    // ---- profile
    getProfile() { return copy(data.profile); },
    saveProfile({ name, email = '' }) {
      name = String(name || '').trim().slice(0, 16);
      if (!name) throw new Error('name required');
      data.profile = {
        name,
        email: String(email || '').trim().slice(0, 120),
        createdAt: (data.profile && data.profile.createdAt) || new Date().toISOString(),
      };
      persist();
      return copy(data.profile);
    },

    // ---- progress
    getProgress() { return { unlocked: data.unlocked, levels: copy(data.levels) }; },
    getLevelResult(id) { return copy(data.levels[id]) || { best: 0, stars: 0, cleared: false, plays: 0 }; },
    isUnlocked(id) { return id <= data.unlocked; },
    getUnlocked() { return data.unlocked; },
    /**
     * Record a finished run. Beating a level unlocks the next one.
     * @returns {{isBest:boolean, firstClear:boolean, unlockedNext:boolean}}
     */
    saveLevelResult(id, { score, stars, won }) {
      const prev = data.levels[id] || { best: 0, stars: 0, cleared: false, plays: 0 };
      const isBest = score > prev.best;
      const firstClear = !!won && !prev.cleared;
      data.levels[id] = {
        best: Math.max(prev.best, score),
        stars: Math.max(prev.stars, stars),
        cleared: prev.cleared || !!won,
        plays: (prev.plays || 0) + 1,
      };
      let unlockedNext = false;
      if (won && data.unlocked < id + 1) { data.unlocked = id + 1; unlockedNext = true; }
      persist();
      return { isBest, firstClear, unlockedNext };
    },

    // ---- DNA currency
    getDNA() { return data.dna; },
    addDNA(n) {
      data.dna += Math.max(0, Math.floor(n));
      persist();
      return data.dna;
    },
    spendDNA(n) {
      n = Math.max(0, Math.floor(n));
      if (data.dna < n) return false;
      data.dna -= n;
      persist();
      return true;
    },

    // ---- upgrades
    getUpgrades() { return copy(data.upgrades); },
    getUpgradeTier(id) { return data.upgrades[id] || 0; },
    /** Atomically pay `cost` and raise the tier (up to maxTier). Returns the new tier, or -1. */
    buyUpgrade(id, cost, maxTier) {
      const tier = data.upgrades[id] || 0;
      if (tier >= maxTier || data.dna < cost) return -1;
      data.dna -= cost;
      data.upgrades[id] = tier + 1;
      persist();
      return tier + 1;
    },

    /** Wipe everything (debug). */
    reset() { data = defaultData(); persist(); },
  };

  window.GameStorage = GameStorage;
})();
