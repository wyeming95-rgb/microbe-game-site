'use strict';
// HTML menus: home + sign up, level select, upgrades shop, results. Talks to the
// game through window.MicrobeGame and to save data through window.GameStorage.

(() => {
  const $ = id => document.getElementById(id);
  const screens = {
    home: $('screen-home'),
    levels: $('screen-levels'),
    upgrades: $('screen-upgrades'),
    results: $('screen-results'),
  };
  let current = null;
  let lastResult = null;

  /** Show one screen (or none while playing). */
  function show(name) {
    current = name;
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
    if (name && screens[name]) screens[name].scrollTop = 0;
    if (!name && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function starsHtml(n) {
    let h = '';
    for (let i = 0; i < 3; i++) h += `<span class="star${i < n ? ' on' : ''}">★</span>`;
    return h;
  }

  function highestUnlocked() { return Math.min(GameStorage.getUnlocked(), Levels.count); }

  function updateDNA() {
    const dna = GameStorage.getDNA();
    $('home-dna').textContent = dna;
    document.querySelectorAll('.dna-val').forEach(el => { el.textContent = dna; });
  }

  // ------------------------------------------------------------ home + sign up
  function renderHome() {
    const profile = GameStorage.getProfile();
    $('profile-card').hidden = !profile;
    $('signup-form').hidden = !!profile;
    if (profile) $('profile-name').textContent = profile.name;
    const lvl = Levels.get(highestUnlocked());
    $('play-sub').textContent = `Level ${lvl.id} · ${lvl.name}`;
    updateDNA();
  }

  function openSignup(editing) {
    const profile = GameStorage.getProfile();
    $('signup-title').textContent = editing ? 'Edit profile' : 'Sign up';
    $('btn-signup').textContent = editing ? 'Save' : 'Sign up';
    $('signup-name').value = profile ? profile.name : '';
    $('signup-email').value = profile ? profile.email : '';
    $('signup-error').textContent = '';
    $('profile-card').hidden = true;
    $('signup-form').hidden = false;
  }

  function signupError(msg, field) {
    $('signup-error').textContent = msg;
    if (field) {
      field.classList.add('invalid');
      field.focus();
    }
  }

  $('signup-form').addEventListener('submit', e => {
    e.preventDefault();
    const nameEl = $('signup-name'), emailEl = $('signup-email');
    nameEl.classList.remove('invalid');
    emailEl.classList.remove('invalid');
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    if (!name) return signupError('Please enter a player name.', nameEl);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return signupError('That email doesn’t look right.', emailEl);
    GameStorage.saveProfile({ name, email });
    nameEl.blur(); emailEl.blur();
    renderHome();
  });
  ['signup-name', 'signup-email'].forEach(id => $(id).addEventListener('input', e => {
    e.target.classList.remove('invalid');
    $('signup-error').textContent = '';
  }));
  $('btn-edit-profile').addEventListener('click', () => openSignup(true));

  /** Runs need a player name; otherwise send them to the sign-up form. */
  function requireProfile() {
    if (GameStorage.getProfile()) return true;
    show('home');
    openSignup(false);
    signupError('Enter a player name to start playing.', $('signup-name'));
    return false;
  }

  function startLevel(id) {
    if (!requireProfile()) return;
    if (!GameStorage.isUnlocked(id)) return;
    show(null);
    MicrobeGame.startLevel(id);
  }

  $('btn-play').addEventListener('click', () => startLevel(highestUnlocked()));
  $('btn-levels').addEventListener('click', () => { renderLevels(); show('levels'); });
  $('btn-upgrades').addEventListener('click', () => { renderUpgrades(); show('upgrades'); });
  $('btn-back-levels').addEventListener('click', goHome);
  $('btn-back-upgrades').addEventListener('click', goHome);

  function goHome() {
    MicrobeGame.goHome();
    renderHome();
    show('home');
  }

  // ------------------------------------------------------------ level select
  function renderLevels() {
    updateDNA();
    const grid = $('level-grid');
    grid.innerHTML = Levels.list.map(l => {
      const locked = !GameStorage.isUnlocked(l.id);
      const r = GameStorage.getLevelResult(l.id);
      const goalTag = { survive: 'Survive', boss: 'Boss', kills: 'Kills' }[l.goal];
      if (locked) {
        return `<button class="level-btn locked" data-level="${l.id}" type="button" disabled aria-label="Level ${l.id} locked">
          <span class="lv-num">${l.id}</span>
          <span class="lv-lock" aria-hidden="true">🔒</span>
          <span class="lv-name">${esc(l.name)}</span>
        </button>`;
      }
      return `<button class="level-btn${r.cleared ? ' cleared' : ''}" data-level="${l.id}" type="button" aria-label="Level ${l.id}: ${esc(l.name)}">
        <span class="lv-num">${l.id}</span>
        <span class="lv-name">${esc(l.name)}</span>
        <span class="lv-goal">${goalTag}</span>
        <span class="stars">${starsHtml(r.stars)}</span>
        <span class="lv-best">${r.best ? 'Best ' + r.best : '—'}</span>
      </button>`;
    }).join('');
  }

  $('level-grid').addEventListener('click', e => {
    const btn = e.target.closest('.level-btn');
    if (!btn || btn.classList.contains('locked')) return;
    startLevel(parseInt(btn.dataset.level, 10));
  });

  // ------------------------------------------------------------ upgrades shop
  function renderUpgrades() {
    updateDNA();
    const dna = GameStorage.getDNA();
    $('upgrade-list').innerHTML = Upgrades.ids.map(id => {
      const def = Upgrades.defs[id];
      const tier = Upgrades.tier(id);
      const cost = Upgrades.nextCost(id);
      const maxed = cost === null;
      const afford = !maxed && dna >= cost;
      let pips = '';
      for (let i = 0; i < Upgrades.MAX_TIER; i++) pips += `<span class="pip${i < tier ? ' on' : ''}"></span>`;
      const now = tier > 0 ? def.desc(tier) : 'Not owned';
      const next = maxed ? 'Maxed out' : 'Next: ' + def.desc(tier + 1);
      return `<div class="upgrade" style="--c:${def.color}">
        <div class="up-info">
          <div class="up-name">${esc(def.name)} <span class="up-tier">Tier ${tier}/${Upgrades.MAX_TIER}</span></div>
          <div class="pips">${pips}</div>
          <div class="up-desc">${esc(now)}</div>
          <div class="up-next">${esc(next)}</div>
        </div>
        <button class="btn buy-btn${maxed ? ' maxed' : ''}" data-upgrade="${id}" type="button"${afford ? '' : ' disabled'}>
          ${maxed ? 'MAX' : `<span>Buy</span><small>🧬 ${cost}</small>`}
        </button>
      </div>`;
    }).join('');
  }

  $('upgrade-list').addEventListener('click', e => {
    const btn = e.target.closest('.buy-btn');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.upgrade;
    if (Upgrades.buy(id)) {
      renderUpgrades();
      const row = document.querySelector(`.buy-btn[data-upgrade="${id}"]`);
      if (row) {
        const el = row.closest('.upgrade');
        el.classList.add('bought');
        setTimeout(() => el.classList.remove('bought'), 400);
      }
    }
  });

  // ------------------------------------------------------------ results
  const REASONS = {
    dead: ['CONSUMED', 'lose'],
    timeout: ['TIME’S UP', 'lose'],
    time: ['SURVIVED!', 'win'],
    boss: ['QUEEN DEFEATED!', 'win'],
    kills: ['TARGET REACHED!', 'win'],
  };

  function showResults(f) {
    lastResult = f;
    const lvl = Levels.get(f.levelId);
    const [title, cls] = REASONS[f.reason] || REASONS.dead;
    $('res-level').textContent = `Level ${lvl.id} · ${lvl.name}`;
    const t = $('res-title');
    t.textContent = title;
    t.className = cls;
    $('res-stars').innerHTML = starsHtml(f.stars);
    $('res-score').textContent = f.score;
    $('res-best').textContent = f.isBest && f.score > 0 ? 'NEW BEST!' : 'Best ' + f.best;
    $('res-best').classList.toggle('new', f.isBest && f.score > 0);
    const rows = [['Kills', f.kills], ['Cell level', f.level], ['Time', f.time.toFixed(1) + 's']];
    if (f.bonus) rows.push(['Win bonus', '+' + f.bonus]);
    $('res-rows').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    $('res-dna').textContent = f.dna;
    const unlock = $('res-unlock');
    unlock.hidden = !f.unlockedNext || f.levelId >= Levels.count;
    if (!unlock.hidden) unlock.textContent = `Level ${f.levelId + 1} unlocked!`;
    const hasNext = f.levelId < Levels.count && GameStorage.isUnlocked(f.levelId + 1);
    $('btn-next').disabled = !hasNext;
    $('btn-next').textContent = f.levelId >= Levels.count ? 'Last level' : 'Next';
    updateDNA();
    show('results');
  }

  MicrobeGame.onRunEnd = showResults;

  $('btn-results-home').addEventListener('click', goHome);
  $('btn-retry').addEventListener('click', () => { if (lastResult) startLevel(lastResult.levelId); });
  $('btn-next').addEventListener('click', () => {
    if (lastResult && lastResult.levelId < Levels.count) startLevel(lastResult.levelId + 1);
  });

  // ------------------------------------------------------------ keyboard
  window.addEventListener('keydown', e => {
    if (!current || (e.target && e.target.closest && e.target.closest('input'))) return;
    if (e.key === 'Escape' && (current === 'levels' || current === 'upgrades')) goHome();
    else if (e.key === 'Enter' && document.activeElement === document.body) {
      if (current === 'home') $('btn-play').click();
      else if (current === 'results') ($('btn-next').disabled ? $('btn-retry') : $('btn-next')).click();
    }
  });

  // ------------------------------------------------------------ boot
  GameStorage.init().then(() => {
    renderHome();
    show('home');
  });
})();
