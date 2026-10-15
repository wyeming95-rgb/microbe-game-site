'use strict';
// Microbe Eat & Grow — main game: state, input, simulation, rendering, UI.

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const safeProbe = document.getElementById('safe-probe');

  const CFG = {
    RUN_TIME: 75,
    BOSS_TIME: 15,          // boss appears this many seconds before the end
    ARENA_R: 900,           // petri dish radius (world units)
    VIEW_SHORT: 520,        // world units visible across the short screen side
    MAX_ENEMIES: 50,
    MAX_PICKUPS: 160,
    FOOD_TARGET: 90,
    MAX_BULLETS: 140,
    MAX_EBULLETS: 90,
    MAX_FOLLOWERS: 28,
    PLAYER_R: 16,
    PLAYER_HP: 100,
    PLAYER_SPEED: 175,
    PLAYER_MAGNET: 70,
    IFRAMES: 0.7,
    BODY_DMG: 10,
    FOLLOWER_R: 8,
    FOLLOWER_DMG: 7,
    FOLLOWER_HIT_CD: 0.3,
    SPORE_DMG: 6,
    JOY_R: 60,              // virtual joystick radius (CSS px)
  };

  // ------------------------------------------------------------ viewport
  let W = 1, H = 1, DPR = 1, zoom = 1, safeTop = 0, safeBottom = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    zoom = clamp(Math.min(W, H) / CFG.VIEW_SHORT, 0.5, 1.5);
    if (safeProbe) {
      const cs = getComputedStyle(safeProbe);
      safeTop = parseFloat(cs.paddingTop) || 0;
      safeBottom = parseFloat(cs.paddingBottom) || 0;
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // ------------------------------------------------------------ systems
  const shake = new Shake(16);
  const dmgNums = new DamageNumbers(48);
  const particles = new Particles(260);
  const director = new Director();
  const hpBar = new HealthBar(CFG.PLAYER_HP);
  const bossBar = new HealthBar(1000, 0.6, 0.5);

  const game = {
    state: 'title',   // title | playing | levelup | ending | over
    stateT: 0,
    realT: 0,
    time: 0,          // run time elapsed
    cam: { x: 0, y: 0 },
    player: null,
    followers: [],
    enemies: [],
    pickups: [],
    bullets: [],
    ebullets: [],
    waves: [],
    boss: null,
    bossSpawned: false,
    xp: 0, xpNext: 0, level: 1, pendingLevels: 0,
    score: 0, kills: 0,
    offer: [], offerT: 0, pressCard: -1, cardRects: [],
    skillLevels: {},
    bags: null,
    spin: 0,
    foodTimer: 0,
    hurtT: 0,
    banner: null,
    endReason: '', final: null, best: loadBest(),
    restartRect: null, pressRestart: false,
  };

  function loadBest() {
    try { return parseInt(localStorage.getItem('microbe-best') || '0', 10) || 0; } catch (_) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('microbe-best', String(v)); } catch (_) { /* private mode etc. */ }
  }

  // static agar specks for the dish background
  const specks = [];
  for (let i = 0; i < 260; i++) {
    const a = rand(0, TAU), d = CFG.ARENA_R * Math.sqrt(Math.random()) * 0.97;
    specks.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rand(1, 3.5), a: rand(0.05, 0.16) });
  }
  let dishGrad = null;

  // decorative microbes for the title screen
  const demo = [];
  ['wbc', 'wbc', 'wbc', 'dart', 'dart', 'macro', 'wbc', 'dart', 'macro', 'wbc'].forEach((type, i) => {
    demo.push({
      type, def: ENEMY_TYPES[type], r: ENEMY_TYPES[type].r, x: 0, y: 0, seed: i * 7.3,
      orbit: 140 + i * 38, speed: rand(0.1, 0.25) * (i % 2 ? 1 : -1), ang: 0, flash: 0, mode: 'approach',
    });
  });

  // ------------------------------------------------------------ run setup
  function makePlayer() {
    return {
      x: 0, y: 0, vx: 0, vy: 0, r: CFG.PLAYER_R,
      hp: CFG.PLAYER_HP, maxHp: CFG.PLAYER_HP,
      flash: 0, iframes: 0, dead: false,
      face: { x: 1, y: 0 },
      speedMult: 1, dmgMult: 1, magnet: CFG.PLAYER_MAGNET,
      splitLvl: 0, shotT: 0.5, regen: 0, regenT: 0,
    };
  }

  function xpForLevel(level) {
    return Math.round(4 + level * 2.5 + level * level * 0.25);
  }

  function startRun() {
    game.state = 'playing';
    game.stateT = 0;
    game.time = 0;
    game.player = makePlayer();
    game.followers.length = 0;
    game.enemies.length = 0;
    game.pickups.length = 0;
    game.bullets.length = 0;
    game.ebullets.length = 0;
    game.waves.length = 0;
    game.boss = null;
    game.bossSpawned = false;
    game.xp = 0;
    game.level = 1;
    game.xpNext = xpForLevel(1);
    game.pendingLevels = 0;
    game.score = 0;
    game.kills = 0;
    game.cam.x = 0; game.cam.y = 0;
    game.hurtT = 0;
    game.final = null;
    game.skillLevels = {};
    for (const id of Object.keys(SKILLS)) game.skillLevels[id] = 0;
    game.bags = {
      food: new ShuffleBag(['food', 'food', 'food', 'food', 'food', 'food', 'food', 'feast', 'feast', 'sugar']),
      drop: new ShuffleBag(['xp', 'xp', 'xp', 'xp', 'xp', 'xp2', 'xp2', 'heal']),
      skill: new ShuffleBag(Object.keys(SKILLS)),
      enemy: [
        new ShuffleBag(['wbc', 'wbc', 'wbc', 'wbc', 'dart']),
        new ShuffleBag(['wbc', 'wbc', 'wbc', 'dart', 'dart', 'macro']),
        new ShuffleBag(['wbc', 'wbc', 'dart', 'dart', 'macro', 'macro']),
      ],
    };
    director.reset();
    hpBar.reset(CFG.PLAYER_HP);
    shake.reset();
    dmgNums.clear();
    particles.clear();
    for (let i = 0; i < 55; i++) spawnFood();
    showBanner('EAT & GROW', 'Survive 75 seconds', '#5ef0d0');
  }

  function showBanner(text, sub, color = '#ffffff', dur = 2) {
    game.banner = { text, sub, color, t: 0, dur };
  }

  // ------------------------------------------------------------ public API for skills
  const api = {
    get player() { return game.player; },
    addFollowers,
    heal,
  };

  function addFollowers(n) {
    const p = game.player;
    for (let i = 0; i < n && game.followers.length < CFG.MAX_FOLLOWERS; i++) {
      game.followers.push({
        x: p.x + rand(-10, 10), y: p.y + rand(-10, 10), r: CFG.FOLLOWER_R,
        cd: 0, flash: 0, shotT: rand(0.3, 1.2), seed: rand(0, 100),
      });
    }
    particles.burst(p.x, p.y, '#8ff5dc', 10, 140, 3, 0.5);
  }

  function heal(amount) {
    const p = game.player;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    hpBar.set(p.hp, p.maxHp);
    const gained = p.hp - before;
    if (gained >= 1) dmgNums.add(p.x, p.y - p.r - 6, gained, '#4ff09a', '+');
  }

  // ------------------------------------------------------------ input
  const input = {
    id: null, kind: 'mouse', down: false,
    sx: 0, sy: 0, ax: 0, ay: 0,
    mouseSeen: false, mouseInside: false,
    keys: new Set(),
  };

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const pos = pointerPos(e);
    const isMouse = e.pointerType === 'mouse';
    if (isMouse) {
      input.mouseSeen = true;
      input.mouseInside = true;
      input.sx = pos.x; input.sy = pos.y;
      if (e.button !== 0) return;
    }
    if (input.id !== null) return; // ignore extra fingers
    input.id = e.pointerId;
    input.kind = isMouse ? 'mouse' : 'touch';
    input.down = true;
    input.sx = input.ax = pos.x;
    input.sy = input.ay = pos.y;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
    onTapDown(pos.x, pos.y);
  }, { passive: false });

  canvas.addEventListener('pointermove', e => {
    const pos = pointerPos(e);
    if (e.pointerType === 'mouse') {
      input.mouseSeen = true;
      input.mouseInside = true;
      input.sx = pos.x; input.sy = pos.y;
    } else if (e.pointerId === input.id) {
      input.sx = pos.x; input.sy = pos.y;
    }
  });

  function endPointer(e, isUp) {
    if (e.pointerId !== input.id) return;
    const pos = pointerPos(e);
    input.id = null;
    input.down = false;
    if (isUp) onTapUp(pos.x, pos.y);
  }
  canvas.addEventListener('pointerup', e => endPointer(e, true));
  canvas.addEventListener('pointercancel', e => endPointer(e, false));
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') input.mouseInside = false; });

  // block browser gestures: scrolling, pinch/double-tap zoom, context menu
  const block = e => e.preventDefault();
  document.addEventListener('touchmove', block, { passive: false });
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('dblclick', block, { passive: false });
  document.addEventListener('contextmenu', block);

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    input.keys.add(k);
    if (game.state === 'title' && (k === 'enter' || k === ' ')) startRun();
    else if (game.state === 'over' && game.stateT > 0.6 && (k === 'enter' || k === ' ' || k === 'r')) startRun();
    else if (game.state === 'levelup' && game.offerT > 0.35 && ['1', '2', '3'].includes(k)) {
      const i = parseInt(k, 10) - 1;
      if (i < game.offer.length) chooseSkill(i);
    }
  });
  window.addEventListener('keyup', e => input.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { input.keys.clear(); input.down = false; input.id = null; });

  function onTapDown(x, y) {
    if (game.state === 'levelup') game.pressCard = cardAt(x, y);
    else if (game.state === 'over') game.pressRestart = inRect(x, y, game.restartRect);
  }

  function onTapUp(x, y) {
    if (game.state === 'title' && game.stateT > 0.3) {
      startRun();
    } else if (game.state === 'levelup') {
      const i = cardAt(x, y);
      if (game.offerT > 0.35 && i >= 0 && i === game.pressCard) chooseSkill(i);
      game.pressCard = -1;
    } else if (game.state === 'over') {
      if (game.stateT > 0.6 && game.pressRestart && inRect(x, y, game.restartRect)) startRun();
      game.pressRestart = false;
    }
  }

  function inRect(x, y, r) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  function cardAt(x, y) {
    for (let i = 0; i < game.cardRects.length; i++) if (inRect(x, y, game.cardRects[i])) return i;
    return -1;
  }

  /** Steering vector from keyboard / touch joystick / mouse. */
  function readSteer() {
    const p = game.player;
    let kx = 0, ky = 0;
    const K = input.keys;
    if (K.has('a') || K.has('arrowleft')) kx -= 1;
    if (K.has('d') || K.has('arrowright')) kx += 1;
    if (K.has('w') || K.has('arrowup')) ky -= 1;
    if (K.has('s') || K.has('arrowdown')) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      return { x: kx / l, y: ky / l, mag: 1 };
    }
    if (input.down && input.kind === 'touch') {
      // floating joystick: drag direction from the touch anchor; anchor trails the finger
      const vx = input.sx - input.ax, vy = input.sy - input.ay;
      const len = Math.hypot(vx, vy);
      if (len > CFG.JOY_R) {
        input.ax = input.sx - (vx / len) * CFG.JOY_R;
        input.ay = input.sy - (vy / len) * CFG.JOY_R;
      }
      if (len > 6) return { x: vx / len, y: vy / len, mag: clamp((len - 6) / (CFG.JOY_R * 0.7 - 6), 0, 1) };
      return { x: 0, y: 0, mag: 0 };
    }
    if (input.kind === 'mouse' && input.mouseSeen && input.mouseInside) {
      // steer toward the cursor; holding the button = full speed
      const tx = (input.sx - W / 2) / zoom + game.cam.x;
      const ty = (input.sy - H / 2) / zoom + game.cam.y;
      const vx = tx - p.x, vy = ty - p.y;
      const len = Math.hypot(vx, vy);
      if (len > 10) return { x: vx / len, y: vy / len, mag: input.down ? 1 : clamp(len / 90, 0, 1) };
    }
    return { x: 0, y: 0, mag: 0 };
  }

  // ------------------------------------------------------------ spawning
  function keepInDish(o, bounce = 0) {
    const d = Math.hypot(o.x, o.y);
    const lim = CFG.ARENA_R - o.r;
    if (d > lim) {
      const nx = o.x / d, ny = o.y / d;
      o.x = nx * lim;
      o.y = ny * lim;
      const vn = o.vx * nx + o.vy * ny;
      if (vn > 0) {
        o.vx -= vn * nx * (1 + bounce);
        o.vy -= vn * ny * (1 + bounce);
      }
      return true;
    }
    return false;
  }

  /** A point just outside the visible screen (in a random direction) that lies inside the dish. */
  function offscreenPoint(extra = 50) {
    const p = game.player;
    const hw = W / 2 / zoom, hh = H / 2 / zoom;
    const lim = CFG.ARENA_R - 50;
    for (let i = 0; i < 12; i++) {
      const a = rand(0, TAU);
      const c = Math.cos(a), s = Math.sin(a);
      const edge = Math.min(hw / Math.max(Math.abs(c), 1e-3), hh / Math.max(Math.abs(s), 1e-3));
      const d = Math.min(edge, 700) + extra;
      const x = p.x + c * d, y = p.y + s * d;
      if (x * x + y * y < lim * lim) return { x, y };
    }
    // player hugging the rim: spawn toward the dish centre
    const d = Math.hypot(p.x, p.y) || 1;
    const a = Math.atan2(-p.y / d, -p.x / d) + rand(-0.8, 0.8);
    return { x: p.x + Math.cos(a) * 380, y: p.y + Math.sin(a) * 380 };
  }

  function makeEnemy(type, x, y) {
    const def = ENEMY_TYPES[type];
    const hp = type === 'boss' ? def.hp : def.hp * (1 + game.time / 60);
    return {
      type, def, x, y, vx: 0, vy: 0, r: def.r,
      hp, maxHp: hp, speed: def.speed * rand(0.9, 1.1), mass: def.mass,
      flash: 0, bodyCd: 0, seed: rand(0, 100), ang: 0, dead: false, t: 0,
      // dart state
      mode: 'approach', timer: 0, aimTime: 0.6, aimDelay: 0,
      // boss state
      tele: 0, teleTime: 0.85, atkT: 2.2, atkIdx: 0,
    };
  }

  function currentEnemyBag() {
    const t = game.time;
    return game.bags.enemy[t < 15 ? 0 : t < 35 ? 1 : 2];
  }

  function spawnEnemyEvent() {
    const room = CFG.MAX_ENEMIES - game.enemies.length;
    if (room <= 0) return;
    const type = currentEnemyBag().next();
    const pt = offscreenPoint();
    if (type === 'dart') {
      // a squad lined up behind each other; they dash one after another
      const p = game.player;
      const a = Math.atan2(p.y - pt.y, p.x - pt.x);
      const count = Math.min(room, game.time > 30 ? 4 : 3);
      for (let i = 0; i < count; i++) {
        const e = makeEnemy('dart', pt.x - Math.cos(a) * i * 34, pt.y - Math.sin(a) * i * 34);
        e.aimDelay = i * 0.35;
        e.ang = a;
        game.enemies.push(e);
      }
      director.onSpawn(ENEMY_TYPES.dart.cost * count);
    } else {
      game.enemies.push(makeEnemy(type, pt.x, pt.y));
      director.onSpawn(ENEMY_TYPES[type].cost);
    }
  }

  function spawnBoss() {
    const p = game.player;
    game.bossSpawned = true;
    const pt = offscreenPoint(60);
    const b = makeEnemy('boss', pt.x, pt.y);
    b.hp = b.maxHp = Math.round(600 + game.level * 85 + game.followers.length * 35 + p.splitLvl * 100);
    b.r = ENEMY_TYPES.boss.r;
    keepInDish(b);
    game.enemies.push(b);
    game.boss = b;
    bossBar.reset(b.maxHp);
    director.enterBoss();
    shake.add(0.6);
    showBanner('WARNING', ENEMY_TYPES.boss.name + ' approaches!', '#ff5a9a', 2.4);
  }

  function spawnFood() {
    if (game.pickups.length >= CFG.MAX_PICKUPS) return;
    const a = rand(0, TAU), d = (CFG.ARENA_R - 30) * Math.sqrt(Math.random());
    spawnPickup(game.bags.food.next(), Math.cos(a) * d, Math.sin(a) * d, 0, 0, true);
  }

  function spawnPickup(kind, x, y, vx, vy, isFood = false) {
    if (game.pickups.length >= CFG.MAX_PICKUPS) return;
    const def = PICKUP_TYPES[kind];
    game.pickups.push({ kind, def, x, y, vx, vy, r: def.r, seed: rand(0, 10), isFood, dead: false });
  }

  // ------------------------------------------------------------ combat
  function hurtPlayer(dmg, src) {
    const p = game.player;
    if (game.state !== 'playing' || p.iframes > 0 || p.dead) return;
    dmg = Math.round(dmg);
    p.hp -= dmg;
    p.flash = 0.12;
    p.iframes = CFG.IFRAMES;
    game.hurtT = 0.35;
    shake.add(0.45);
    dmgNums.add(p.x, p.y - p.r - 4, dmg, '#ff5a6a');
    director.onPlayerDamaged(dmg);
    particles.burst(p.x, p.y, '#ff8a8a', 8, 160, 3, 0.4);
    if (src) {
      const dx = p.x - src.x, dy = p.y - src.y, d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 260;
      p.vy += (dy / d) * 260;
    }
    hpBar.set(Math.max(0, p.hp), p.maxHp);
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      particles.burst(p.x, p.y, '#3fe8b8', 40, 300, 5, 0.9);
      shake.add(1);
      endRun('dead');
    }
  }

  function damageEnemy(e, dmg, sx, sy, kb) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.09;
    const isBoss = e.type === 'boss';
    dmgNums.add(e.x, e.y - e.r * 0.6, dmg, dmg >= 20 ? '#ffe066' : '#ffffff');
    shake.add(isBoss ? 0.07 : 0.03);
    if (kb) {
      const dx = e.x - sx, dy = e.y - sy, d = Math.hypot(dx, dy) || 1;
      e.vx += (dx / d) * kb / e.mass;
      e.vy += (dy / d) * kb / e.mass;
    }
    if (isBoss) bossBar.set(Math.max(0, e.hp), e.maxHp);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true;
    const def = e.def;
    game.kills++;
    game.score += def.score;
    particles.burst(e.x, e.y, def.color, e.type === 'boss' ? 70 : Math.round(8 + e.r * 0.4), e.type === 'boss' ? 420 : 200, 4, 0.6);
    for (let i = 0; i < def.drops; i++) {
      const a = rand(0, TAU), s = rand(40, 140);
      spawnPickup(game.bags.drop.next(), e.x + rand(-4, 4), e.y + rand(-4, 4), Math.cos(a) * s, Math.sin(a) * s);
    }
    const p = game.player;
    if (dist2(e.x, e.y, p.x, p.y) < 250 * 250) director.onKillNearPlayer();
    if (e.type === 'boss') {
      game.boss = null;
      shake.add(1);
      endRun('boss');
    }
  }

  function fireSpore(x, y, ang, dmg) {
    if (game.bullets.length >= CFG.MAX_BULLETS) return;
    game.bullets.push({ x, y, vx: Math.cos(ang) * 430, vy: Math.sin(ang) * 430, r: 4, dmg, life: 1.1, dead: false });
  }

  function fireEnemyBullet(x, y, ang, speed, dmg) {
    if (game.ebullets.length >= CFG.MAX_EBULLETS) return;
    game.ebullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 7, dmg, life: 4, dead: false });
  }

  function nearestEnemy(x, y, maxD) {
    let best = null, bd = maxD * maxD;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------ progression
  function addXp(n) {
    game.xp += n;
    while (game.xp >= game.xpNext) {
      game.xp -= game.xpNext;
      game.level++;
      game.xpNext = xpForLevel(game.level);
      game.pendingLevels++;
      addFollowers(1); // every level grows the swarm
    }
  }

  function openLevelUp() {
    game.offer = game.bags.skill.nextUnique(3);
    if (!game.offer.length) { game.pendingLevels = 0; return; }
    game.state = 'levelup';
    game.offerT = 0;
    game.pressCard = -1;
  }

  function chooseSkill(i) {
    const id = game.offer[i];
    if (!id) return;
    SKILLS[id].apply(api);
    game.skillLevels[id]++;
    if (game.skillLevels[id] >= SKILLS[id].max) game.bags.skill.remove(id);
    game.pendingLevels--;
    const p = game.player;
    particles.burst(p.x, p.y, SKILLS[id].color, 18, 220, 4, 0.6);
    showBanner(SKILLS[id].name.toUpperCase(), 'Level ' + game.level, SKILLS[id].color, 1.2);
    if (game.pendingLevels > 0) {
      openLevelUp();
    } else {
      game.state = 'playing';
      p.iframes = Math.max(p.iframes, 0.5); // grace period after the pause
    }
  }

  function endRun(reason) {
    if (game.state !== 'playing') return;
    game.state = 'ending';
    game.stateT = 0;
    game.endReason = reason;
    let bonus = 0;
    if (reason === 'time') bonus = 1000;
    if (reason === 'boss') bonus = 1000 + Math.round(Math.max(0, CFG.RUN_TIME - game.time) * 100);
    game.score += bonus;
    const isBest = game.score > game.best;
    if (isBest) { game.best = game.score; saveBest(game.best); }
    game.final = {
      score: game.score, bonus, level: game.level, kills: game.kills,
      time: Math.min(game.time, CFG.RUN_TIME), isBest,
    };
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    game.realT += dt;
    game.stateT += dt;
    shake.update(dt);
    if (game.banner) {
      game.banner.t += dt;
      if (game.banner.t >= game.banner.dur) game.banner = null;
    }

    switch (game.state) {
      case 'title':
        for (const d of demo) {
          const a = game.realT * d.speed + d.seed;
          d.x = Math.cos(a) * d.orbit;
          d.y = Math.sin(a) * d.orbit * 0.8;
          d.ang = a + Math.PI / 2 * Math.sign(d.speed);
        }
        break;
      case 'playing':
        updateWorld(dt, true);
        if (game.pendingLevels > 0 && game.state === 'playing') openLevelUp();
        break;
      case 'levelup':
        game.offerT += dt;
        hpBar.update(dt);
        break;
      case 'ending':
        updateWorld(dt * 0.3, false); // slow-mo finish
        if (game.stateT >= 1.3) { game.state = 'over'; game.stateT = 0; }
        break;
      case 'over':
        particles.update(dt);
        dmgNums.update(dt);
        break;
    }
  }

  function updateWorld(dt, live) {
    const p = game.player;
    if (live) {
      game.time += dt;
      if (!game.bossSpawned && game.time >= CFG.RUN_TIME - CFG.BOSS_TIME) spawnBoss();
    }

    updatePlayer(dt, live);
    updateFollowers(dt);

    // pacing director decides when enemies arrive
    let nearby = 0;
    for (const e of game.enemies) if (dist2(e.x, e.y, p.x, p.y) < 300 * 300) nearby++;
    const spawns = director.update(dt, { runTime: game.time, nearby });
    if (live) for (let i = 0; i < spawns; i++) spawnEnemyEvent();

    updateEnemies(dt);
    separateEnemies();
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateWaves(dt);
    updatePickups(dt);

    if (live) {
      game.foodTimer -= dt;
      if (game.foodTimer <= 0) {
        game.foodTimer = 0.12;
        let food = 0;
        for (const it of game.pickups) if (it.isFood) food++;
        if (food < CFG.FOOD_TARGET) spawnFood();
      }
    }

    particles.update(dt);
    dmgNums.update(dt);
    hpBar.update(dt);
    bossBar.update(dt);
    game.hurtT = Math.max(0, game.hurtT - dt);

    game.cam.x = damp(game.cam.x, p.x, 9, dt);
    game.cam.y = damp(game.cam.y, p.y, 9, dt);

    compact(game.enemies, e => !e.dead);
    compact(game.pickups, it => !it.dead);
    compact(game.bullets, b => !b.dead);
    compact(game.ebullets, b => !b.dead);
    compact(game.waves, w => w.r < w.maxR);

    if (live && game.time >= CFG.RUN_TIME) endRun('time');
  }

  function updatePlayer(dt, live) {
    const p = game.player;
    p.flash -= dt;
    p.iframes -= dt;
    if (p.dead) return;

    const steer = live ? readSteer() : { x: 0, y: 0, mag: 0 };
    const spd = CFG.PLAYER_SPEED * p.speedMult * steer.mag;
    p.vx = damp(p.vx, steer.x * spd, 10, dt);
    p.vy = damp(p.vy, steer.y * spd, 10, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    keepInDish(p, 0.3);

    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 20) {
      p.face.x = damp(p.face.x, p.vx / sp, 12, dt);
      p.face.y = damp(p.face.y, p.vy / sp, 12, dt);
      const fl = Math.hypot(p.face.x, p.face.y) || 1;
      p.face.x /= fl; p.face.y /= fl;
    }

    if (p.regen > 0 && live) {
      p.regenT += dt;
      if (p.regenT >= 1) { p.regenT -= 1; if (p.hp < p.maxHp) heal(p.regen); }
    }

    // split shot: the player fires a fan of spores at the nearest enemy
    if (p.splitLvl > 0) {
      p.shotT -= dt;
      if (p.shotT <= 0) {
        p.shotT = 0.85 - 0.08 * p.splitLvl;
        const tgt = nearestEnemy(p.x, p.y, 420);
        if (tgt) {
          const base = Math.atan2(tgt.y - p.y, tgt.x - p.x);
          const n = p.splitLvl + 1;
          for (let k = 0; k < n; k++) fireSpore(p.x, p.y, base + (k - (n - 1) / 2) * 0.17, CFG.SPORE_DMG * p.dmgMult);
        }
      }
    }
  }

  function updateFollowers(dt) {
    const p = game.player;
    const fs = game.followers;
    const n = fs.length;
    if (!n) return;
    game.spin += dt * 1.9;
    const baseR = p.r + 18 + Math.min(n, 14) * 2.6;
    for (let i = 0; i < n; i++) {
      const f = fs[i];
      const inner = n > 10 && i % 2 === 1;
      const a = (inner ? -game.spin * 0.8 : game.spin) + (i / n) * TAU;
      const rr = (inner ? baseR * 0.6 : baseR) + Math.sin(game.realT * 3 + f.seed) * 3;
      f.x = damp(f.x, p.x + Math.cos(a) * rr, 7, dt);
      f.y = damp(f.y, p.y + Math.sin(a) * rr, 7, dt);
      f.cd -= dt;
      f.flash -= dt;

      // contact damage
      if (f.cd <= 0) {
        for (const e of game.enemies) {
          if (e.dead) continue;
          const r = f.r + e.r;
          if (dist2(f.x, f.y, e.x, e.y) < r * r) {
            damageEnemy(e, CFG.FOLLOWER_DMG * p.dmgMult, f.x, f.y, 90);
            f.cd = CFG.FOLLOWER_HIT_CD;
            f.flash = 0.08;
            break;
          }
        }
      }

      // split shot: followers fire single spores
      if (p.splitLvl > 0) {
        f.shotT -= dt;
        if (f.shotT <= 0) {
          f.shotT = 1.7 - 0.15 * p.splitLvl + rand(0, 0.3);
          const tgt = nearestEnemy(f.x, f.y, 320);
          if (tgt) fireSpore(f.x, f.y, Math.atan2(tgt.y - f.y, tgt.x - f.x), CFG.SPORE_DMG * p.dmgMult);
        }
      }
    }
  }

  function updateEnemies(dt) {
    const p = game.player;
    for (const e of game.enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.flash -= dt;
      e.bodyCd -= dt;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const toP = Math.atan2(dy, dx);

      if (e.type === 'dart') updateDart(e, dt, d, toP);
      else {
        e.ang = toP;
        const chase = p.dead ? -0.3 : 1; // drift away once the player is gone
        const rate = e.type === 'macro' || e.type === 'boss' ? 1.3 : 2.6;
        e.vx = damp(e.vx, (dx / d) * e.speed * chase, rate, dt);
        e.vy = damp(e.vy, (dy / d) * e.speed * chase, rate, dt);
        if (e.type === 'boss') updateBoss(e, dt);
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;
      keepInDish(e, 0);

      // contact with player
      if (!p.dead) {
        const rr = e.r + p.r;
        const d2 = dist2(e.x, e.y, p.x, p.y);
        if (d2 < rr * rr) {
          hurtPlayer(e.def.dmg * (e.mode === 'dash' ? 1.3 : 1), e);
          if (e.bodyCd <= 0) {
            damageEnemy(e, CFG.BODY_DMG * p.dmgMult, p.x, p.y, 140);
            e.bodyCd = 0.45;
          }
          // push the player out so they don't sink into enemies
          const dd = Math.sqrt(d2) || 1;
          const overlap = rr - dd;
          const w = e.mass / (e.mass + 1);
          p.x += ((p.x - e.x) / dd) * overlap * w;
          p.y += ((p.y - e.y) / dd) * overlap * w;
          keepInDish(p, 0);
        }
      }
    }
  }

  function updateDart(e, dt, d, toP) {
    switch (e.mode) {
      case 'approach':
        e.ang = toP;
        e.vx = damp(e.vx, Math.cos(toP) * e.speed, 3, dt);
        e.vy = damp(e.vy, Math.sin(toP) * e.speed, 3, dt);
        if (d < 340 && e.t >= e.aimDelay) { e.mode = 'aim'; e.timer = e.aimTime; }
        break;
      case 'aim':
        e.vx = damp(e.vx, 0, 8, dt);
        e.vy = damp(e.vy, 0, 8, dt);
        if (e.timer > 0.15) e.ang = toP; // lock direction just before dashing
        e.timer -= dt;
        if (e.timer <= 0) {
          e.mode = 'dash';
          e.timer = 0.5;
          e.vx = Math.cos(e.ang) * 560;
          e.vy = Math.sin(e.ang) * 560;
        }
        break;
      case 'dash':
        e.timer -= dt;
        if (Math.random() < 0.5) particles.burst(e.x, e.y, '#ffe9a0', 1, 30, 2, 0.3);
        if (e.timer <= 0) { e.mode = 'recover'; e.timer = 0.8; }
        break;
      case 'recover':
        e.vx = damp(e.vx, 0, 4, dt);
        e.vy = damp(e.vy, 0, 4, dt);
        e.timer -= dt;
        if (e.timer <= 0) e.mode = 'approach';
        break;
    }
  }

  function updateBoss(b, dt) {
    if (b.tele > 0) {
      b.tele -= dt;
      b.vx *= 0.9; b.vy *= 0.9;
      if (b.tele <= 0) {
        game.waves.push({ x: b.x, y: b.y, r: b.r, maxR: b.r + 380, speed: 400, hit: false });
        shake.add(0.4);
        particles.burst(b.x, b.y, '#ff8ab8', 20, 300, 4, 0.5);
      }
      return;
    }
    b.atkT -= dt;
    if (b.atkT > 0) return;
    const enraged = b.hp < b.maxHp * 0.5;
    b.atkT = enraged ? 1.9 : 2.7;
    const atk = ['pulse', 'spawn', 'spores'][b.atkIdx++ % 3];
    if (atk === 'pulse') {
      b.tele = b.teleTime;
    } else if (atk === 'spawn') {
      const n = Math.min(enraged ? 6 : 4, CFG.MAX_ENEMIES - game.enemies.length);
      for (let i = 0; i < n; i++) {
        const a = (i / Math.max(1, n)) * TAU + rand(-0.2, 0.2);
        const m = makeEnemy('minion', b.x + Math.cos(a) * (b.r + 14), b.y + Math.sin(a) * (b.r + 14));
        m.vx = Math.cos(a) * 200; m.vy = Math.sin(a) * 200;
        game.enemies.push(m);
      }
      particles.burst(b.x, b.y, '#f6a9c6', 14, 200, 4, 0.5);
    } else {
      const n = enraged ? 18 : 12;
      const off = rand(0, TAU);
      for (let i = 0; i < n; i++) fireEnemyBullet(b.x, b.y, off + (i / n) * TAU, 170, 9);
      shake.add(0.15);
    }
  }

  function separateEnemies() {
    const es = game.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        const r = a.r + b.r;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (r - d) * 0.5;
        const m = a.mass + b.mass;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push * (b.mass / m);
        a.y -= ny * push * (b.mass / m);
        b.x += nx * push * (a.mass / m);
        b.y += ny * push * (a.mass / m);
      }
    }
  }

  function updateBullets(dt) {
    const lim = CFG.ARENA_R * CFG.ARENA_R;
    for (const b of game.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x * b.x + b.y * b.y > lim) { b.dead = true; continue; }
      for (const e of game.enemies) {
        if (e.dead) continue;
        const r = b.r + e.r;
        if (dist2(b.x, b.y, e.x, e.y) < r * r) {
          damageEnemy(e, b.dmg, b.x - b.vx, b.y - b.vy, 60);
          particles.burst(b.x, b.y, '#bff8ff', 3, 90, 2, 0.25);
          b.dead = true;
          break;
        }
      }
    }
  }

  function updateEnemyBullets(dt) {
    const p = game.player;
    for (const b of game.ebullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || Math.hypot(b.x, b.y) > CFG.ARENA_R) { b.dead = true; continue; }
      // follower cells shield the player
      for (const f of game.followers) {
        const r = b.r + f.r;
        if (dist2(b.x, b.y, f.x, f.y) < r * r) {
          b.dead = true;
          f.flash = 0.08;
          particles.burst(b.x, b.y, '#ff9a6a', 4, 100, 2, 0.3);
          break;
        }
      }
      if (b.dead || p.dead) continue;
      const r = b.r + p.r;
      if (dist2(b.x, b.y, p.x, p.y) < r * r) {
        b.dead = true;
        hurtPlayer(b.dmg, b);
      }
    }
  }

  function updateWaves(dt) {
    const p = game.player;
    for (const w of game.waves) {
      w.r += w.speed * dt;
      if (!w.hit && !p.dead) {
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (Math.abs(d - w.r) < p.r + 10) {
          w.hit = true;
          hurtPlayer(18, w);
        }
      }
    }
  }

  function updatePickups(dt) {
    const p = game.player;
    const mr = p.magnet;
    const drag = Math.exp(-5 * dt);
    for (const it of game.pickups) {
      if (it.dead) continue;
      const dx = p.x - it.x, dy = p.y - it.y;
      const d2 = dx * dx + dy * dy;
      if (!p.dead && d2 < mr * mr) {
        const d = Math.sqrt(d2) || 1;
        const pull = 300 + (1 - d / mr) * 500;
        it.vx = damp(it.vx, (dx / d) * pull, 8, dt);
        it.vy = damp(it.vy, (dy / d) * pull, 8, dt);
      } else {
        it.vx *= drag;
        it.vy *= drag;
      }
      it.x += it.vx * dt;
      it.y += it.vy * dt;

      const rr = p.r + it.r + 3;
      if (!p.dead && game.state === 'playing' && d2 < rr * rr) {
        it.dead = true;
        const def = it.def;
        game.score += def.score;
        if (def.xp) addXp(def.xp);
        if (def.heal) heal(def.heal);
        particles.burst(it.x, it.y, def.color, 4, 90, 2.5, 0.3);
      }
    }
  }

  // ------------------------------------------------------------ render
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, W, H);

    const title = game.state === 'title';
    const camX = title ? 0 : game.cam.x, camY = title ? 0 : game.cam.y;

    ctx.save();
    ctx.translate(W / 2 + shake.x, H / 2 + shake.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    const view = {
      x0: camX - W / 2 / zoom - 80, x1: camX + W / 2 / zoom + 80,
      y0: camY - H / 2 / zoom - 80, y1: camY + H / 2 / zoom + 80,
    };
    drawDish(view);
    if (title) drawTitleWorld();
    else drawWorld(view);
    ctx.restore();

    if (title) { drawTitleUI(); return; }
    drawVignette();
    drawHUD();
    if (game.state === 'levelup') drawLevelUp();
    if (game.state === 'over') drawGameOver();
  }

  function inView(v, x, y, r) {
    return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
  }

  function drawDish(view) {
    const R = CFG.ARENA_R;
    if (!dishGrad) {
      dishGrad = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
      dishGrad.addColorStop(0, '#17283f');
      dishGrad.addColorStop(0.8, '#132238');
      dishGrad.addColorStop(1, '#1c3652');
    }
    ctx.fillStyle = dishGrad;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#9fd8ff';
    for (const s of specks) {
      if (!inView(view, s.x, s.y, s.r)) continue;
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(140,220,255,0.12)';
    ctx.beginPath(); ctx.arc(0, 0, R + 8, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(170,235,255,0.55)';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  }

  function drawWorld(view) {
    const t = game.realT;
    for (const it of game.pickups) if (inView(view, it.x, it.y, it.r * 2)) drawPickup(ctx, it, t);

    for (const w of game.waves) {
      const k = w.r / w.maxR;
      ctx.strokeStyle = `rgba(255,90,150,${0.85 * (1 - k)})`;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke();
    }

    for (const e of game.enemies) if (e.type !== 'boss' && inView(view, e.x, e.y, e.r * 1.5)) drawEnemy(ctx, e, t);
    if (game.boss && !game.boss.dead) drawEnemy(ctx, game.boss, t);

    ctx.fillStyle = '#ff8a5a';
    for (const b of game.ebullets) {
      if (!inView(view, b.x, b.y, b.r)) continue;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#bff8ff';
    for (const b of game.bullets) {
      if (!inView(view, b.x, b.y, b.r)) continue;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }

    for (const f of game.followers) drawFollower(ctx, f, t);
    const p = game.player;
    if (p && !p.dead) {
      if (p.magnet > CFG.PLAYER_MAGNET * 1.1) {
        ctx.strokeStyle = 'rgba(185,140,255,0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.magnet, 0, TAU); ctx.stroke();
      }
      drawPlayer(ctx, p, t);
    }

    particles.draw(ctx);
    dmgNums.draw(ctx);
  }

  function drawTitleWorld() {
    const t = game.realT;
    for (const d of demo) drawEnemy(ctx, d, t);
    drawPlayer(ctx, { x: 0, y: 0, r: 22, flash: 0, iframes: 0, face: { x: Math.cos(t), y: Math.sin(t) * 0.5 } }, t);
  }

  // ---- UI helpers
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  function text(str, x, y, size, color, align = 'center', weight = 700, outline = true) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.strokeStyle = 'rgba(5,8,18,0.75)';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  /** Largest font size <= size that fits str within maxW. */
  function fitSize(str, maxW, size, weight = 600) {
    for (; size > 9; size -= 1) {
      ctx.font = `${weight} ${size}px ${FONT}`;
      if (ctx.measureText(str).width <= maxW) break;
    }
    return size;
  }
  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function drawVignette() {
    const p = game.player;
    const low = p && !p.dead && p.hp / p.maxHp <= 0.25 ? 0.25 + 0.15 * Math.sin(game.realT * 6) : 0;
    const a = Math.max(game.hurtT / 0.35 * 0.55, low);
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, `rgba(255,40,60,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHUD() {
    const p = game.player;
    const pad = 12;
    const y0 = safeTop + 10;

    // timer (top centre)
    const remain = CFG.RUN_TIME - game.time;
    const bossTime = remain <= CFG.BOSS_TIME;
    const tSize = bossTime ? 28 + 2 * Math.max(0, Math.sin(game.realT * 8)) : 26;
    text(fmtTime(remain), W / 2, y0 + 14, tSize, bossTime ? '#ff7aa8' : '#ffffff', 'center', 800);

    // pacing director indicator (subtle) under the timer
    const iw = 56, ix = W / 2 - iw / 2, iy = y0 + 32;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, ix, iy, iw, 4, 2); ctx.fill();
    ctx.fillStyle = director.color;
    roundRect(ctx, ix, iy, iw * clamp(director.intensity / director.PEAK, 0, 1), 4, 2); ctx.fill();
    ctx.globalAlpha = 0.7;
    text(director.label, W / 2, iy + 11, 9, director.color, 'center', 700, false);
    ctx.globalAlpha = 1;

    // level + XP (top left)
    text('Lv ' + game.level, pad, y0 + 9, 15, '#ffffff', 'left', 800);
    const xw = Math.min(W * 0.28, 150), xh = 6, xy = y0 + 22;
    ctx.fillStyle = 'rgba(5,8,18,0.7)';
    roundRect(ctx, pad - 1, xy - 1, xw + 2, xh + 2, 4); ctx.fill();
    ctx.fillStyle = '#6fd3ff';
    roundRect(ctx, pad, xy, xw * clamp(game.xp / game.xpNext, 0, 1), xh, 3); ctx.fill();

    // score + kills (top right)
    text(String(game.score), W - pad, y0 + 9, 16, '#ffe066', 'right', 800);
    text(game.kills + ' kills', W - pad, y0 + 27, 11, '#b8c4e0', 'right', 600);

    // player health bar
    const hw = Math.min(W - pad * 2, 360);
    const hy = y0 + 50;
    hpBar.draw(ctx, pad, hy, hw, 14, `${Math.ceil(p.hp)} / ${p.maxHp}`);

    // boss bar
    if (game.boss && !game.boss.dead) {
      const bw = Math.min(W - pad * 2, 420), bx = (W - bw) / 2, by = hy + 32;
      text(ENEMY_TYPES.boss.name, W / 2, by - 8, 11, '#ff9ac4', 'center', 800);
      bossBar.draw(ctx, bx, by, bw, 10, '');
      drawBossPointer(game.boss);
    }

    // banner
    if (game.banner) {
      const b = game.banner;
      const k = b.t / b.dur;
      const s = b.t < 0.25 ? easeOutBack(b.t / 0.25) : 1;
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const by = H * 0.3;
      text(b.text, W / 2, by, Math.max(1, Math.min(40, W / 11) * s), b.color, 'center', 900);
      if (b.sub) text(b.sub, W / 2, by + 32, 15, '#e6ecff', 'center', 600);
      ctx.globalAlpha = 1;
    }

    // touch joystick
    if (game.state === 'playing' && input.down && input.kind === 'touch') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(input.ax, input.ay, CFG.JOY_R, 0, TAU); ctx.stroke();
      const dx = input.sx - input.ax, dy = input.sy - input.ay;
      const l = Math.hypot(dx, dy), m = Math.min(l, CFG.JOY_R);
      const kx = l ? input.ax + dx / l * m : input.ax, ky = l ? input.ay + dy / l * m : input.ay;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.arc(kx, ky, 18, 0, TAU); ctx.fill();
    }
  }

  /** Arrow at the screen edge pointing to an off-screen boss. */
  function drawBossPointer(b) {
    const sx = (b.x - game.cam.x) * zoom + W / 2;
    const sy = (b.y - game.cam.y) * zoom + H / 2;
    const m = b.r * zoom;
    if (sx > -m && sx < W + m && sy > -m && sy < H + m) return;
    const a = Math.atan2(sy - H / 2, sx - W / 2);
    const ex = clamp(sx, 24, W - 24), ey = clamp(sy, safeTop + 110, H - safeBottom - 24);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = `rgba(255,90,154,${0.6 + 0.4 * Math.sin(game.realT * 8)})`;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function layoutCards(n) {
    const rects = [];
    if (W < H * 1.1) { // portrait: stacked
      const w = Math.min(W - 36, 400), h = 86, gap = 14;
      const total = n * h + (n - 1) * gap;
      const y = Math.max(safeTop + 140, H / 2 - total / 2 + 30);
      for (let i = 0; i < n; i++) rects.push({ x: (W - w) / 2, y: y + i * (h + gap), w, h, vertical: false });
    } else { // landscape: side by side
      const gap = 18, w = Math.min(230, (W - 60 - gap * (n - 1)) / n), h = Math.min(250, H * 0.55);
      const total = n * w + (n - 1) * gap;
      const y = H / 2 - h / 2 + 30;
      for (let i = 0; i < n; i++) rects.push({ x: W / 2 - total / 2 + i * (w + gap), y, w, h, vertical: true });
    }
    return rects;
  }

  function drawLevelUp() {
    ctx.fillStyle = 'rgba(4,6,14,0.66)';
    ctx.fillRect(0, 0, W, H);
    const rects = layoutCards(game.offer.length);
    game.cardRects = rects;
    const top = rects.length ? rects[0].y : H / 2;
    const pop = easeOutBack(clamp(game.offerT / 0.3, 0, 1));
    text('LEVEL UP!', W / 2, top - 62, 34 * Math.max(0.01, pop), '#5ef0d0', 'center', 900);
    text('Choose a mutation', W / 2, top - 30, 14, '#b8c4e0', 'center', 600);

    game.offer.forEach((id, i) => {
      const r = rects[i];
      const sk = SKILLS[id];
      const lvl = game.skillLevels[id];
      const k = clamp((game.offerT - i * 0.07) / 0.3, 0, 1);
      if (k <= 0) return;
      const s = easeOutBack(k);
      const pressed = game.pressCard === i && input.down;
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(s * (pressed ? 0.96 : 1), s * (pressed ? 0.96 : 1));
      ctx.translate(-r.w / 2, -r.h / 2);
      ctx.globalAlpha = k;
      ctx.fillStyle = '#141d36';
      roundRect(ctx, 0, 0, r.w, r.h, 14); ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = sk.color;
      ctx.stroke();

      const desc = sk.desc(lvl);
      const lvText = lvl === 0 ? 'NEW' : `Lv ${lvl} → ${lvl + 1}`;
      if (r.vertical) {
        drawSkillIcon(id, r.w / 2, r.h * 0.3, Math.min(30, r.w * 0.16), sk.color);
        text(sk.name, r.w / 2, r.h * 0.58, fitSize(sk.name, r.w - 20, 18, 800), '#ffffff', 'center', 800, false);
        text(desc, r.w / 2, r.h * 0.72, fitSize(desc, r.w - 20, 13), '#b8c4e0', 'center', 600, false);
        text(lvText, r.w / 2, r.h * 0.87, 12, sk.color, 'center', 800, false);
        text(String(i + 1), 14, 16, 11, 'rgba(255,255,255,0.35)', 'left', 700, false);
      } else {
        drawSkillIcon(id, 42, r.h / 2, 24, sk.color);
        text(sk.name, 82, r.h * 0.36, fitSize(sk.name, r.w - 170, 18, 800), '#ffffff', 'left', 800, false);
        text(desc, 82, r.h * 0.66, fitSize(desc, r.w - 96, 13), '#b8c4e0', 'left', 600, false);
        text(lvText, r.w - 14, r.h * 0.36, 12, sk.color, 'right', 800, false);
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawSkillIcon(id, x, y, s, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.arc(x, y, s * 1.15, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = 'round';
    switch (id) {
      case 'cells':
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3 - Math.PI / 2;
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * s * 0.45, y + Math.sin(a) * s * 0.45, s * 0.3, 0, TAU); ctx.fill();
        }
        break;
      case 'speed':
        for (const o of [-0.35, 0.25]) {
          ctx.beginPath();
          ctx.moveTo(x + (o - 0.25) * s, y - s * 0.5);
          ctx.lineTo(x + (o + 0.25) * s, y);
          ctx.lineTo(x + (o - 0.25) * s, y + s * 0.5);
          ctx.stroke();
        }
        break;
      case 'spike':
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = i * TAU / 16, rr = i % 2 ? s * 0.38 : s * 0.8;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        break;
      case 'split':
        for (let i = -1; i <= 1; i++) {
          const a = -Math.PI / 2 + i * 0.5;
          ctx.beginPath(); ctx.moveTo(x, y + s * 0.5);
          ctx.lineTo(x + Math.cos(a) * s * 0.7, y + s * 0.5 + Math.sin(a) * s * 1.1);
          ctx.stroke();
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * s * 0.75, y + s * 0.5 + Math.sin(a) * s * 1.15, s * 0.16, 0, TAU); ctx.fill();
        }
        break;
      case 'magnet':
        ctx.lineWidth = s * 0.28;
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.arc(x, y - s * 0.05, s * 0.5, Math.PI, 0, true); ctx.stroke();
        break;
      case 'regen':
        ctx.fillRect(x - s * 0.6, y - s * 0.18, s * 1.2, s * 0.36);
        ctx.fillRect(x - s * 0.18, y - s * 0.6, s * 0.36, s * 1.2);
        break;
      case 'maxhp':
        ctx.lineWidth = s * 0.22;
        ctx.beginPath(); ctx.arc(x, y, s * 0.6, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, s * 0.25, 0, TAU); ctx.fill();
        break;
    }
    ctx.lineCap = 'butt';
  }

  function drawGameOver() {
    const f = game.final;
    const k = clamp(game.stateT / 0.4, 0, 1);
    ctx.fillStyle = `rgba(4,6,14,${0.72 * k})`;
    ctx.fillRect(0, 0, W, H);
    if (!f) return;
    const s = easeOutBack(k);
    const pw = Math.min(W - 36, 360), ph = 330;
    const px = (W - pw) / 2, py = Math.max(safeTop + 20, (H - ph) / 2);
    ctx.save();
    ctx.translate(W / 2, py + ph / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -(py + ph / 2));
    ctx.fillStyle = '#121a31';
    roundRect(ctx, px, py, pw, ph, 18); ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(160,220,255,0.35)';
    ctx.stroke();

    const titles = {
      dead: ['CONSUMED', '#ff5a6a'],
      time: ['SURVIVED!', '#5ef0d0'],
      boss: ['QUEEN DEFEATED!', '#ffe066'],
    };
    const [tt, tc] = titles[game.endReason] || titles.time;
    text(tt, W / 2, py + 38, fitSize(tt, pw - 30, 30, 900), tc, 'center', 900);
    text('SCORE', W / 2, py + 78, 12, '#8d9bc0', 'center', 700, false);
    text(String(f.score), W / 2, py + 108, 40, '#ffffff', 'center', 900);
    if (f.isBest) text('NEW BEST!', W / 2, py + 138, 12, '#ffe066', 'center', 800, false);
    else text('Best ' + game.best, W / 2, py + 138, 12, '#8d9bc0', 'center', 600, false);

    const rows = [
      ['Level', String(f.level)],
      ['Kills', String(f.kills)],
      ['Time', f.time.toFixed(1) + 's'],
    ];
    if (f.bonus) rows.push(['Survival bonus', '+' + f.bonus]);
    rows.forEach(([a, b], i) => {
      const y = py + 168 + i * 24;
      text(a, px + 30, y, 15, '#b8c4e0', 'left', 600, false);
      text(b, px + pw - 30, y, 15, '#ffffff', 'right', 800, false);
    });

    const bw = Math.min(pw - 60, 220), bh = 50;
    const r = { x: W / 2 - bw / 2, y: py + ph - bh - 20, w: bw, h: bh };
    game.restartRect = r;
    const pressed = game.pressRestart && input.down;
    ctx.fillStyle = pressed ? '#2fbf98' : '#3fe8b8';
    roundRect(ctx, r.x, r.y, r.w, r.h, 25); ctx.fill();
    text('RESTART', W / 2, r.y + r.h / 2 + 1, 18, '#06241c', 'center', 900, false);
    ctx.restore();
  }

  function drawTitleUI() {
    ctx.fillStyle = 'rgba(4,6,14,0.35)';
    ctx.fillRect(0, 0, W, H);
    const cy = H * 0.3;
    const bob = Math.sin(game.realT * 2) * 4;
    const size = Math.min(54, W / 7.5);
    text('MICROBE', W / 2, cy - size * 0.55 + bob, size, '#5ef0d0', 'center', 900);
    text('EAT & GROW', W / 2, cy + size * 0.55 + bob, size * 0.72, '#ffffff', 'center', 900);

    const tap = 0.55 + 0.45 * Math.sin(game.realT * 4);
    ctx.globalAlpha = tap;
    text('TAP TO START', W / 2, H * 0.68, 20, '#ffe066', 'center', 800);
    ctx.globalAlpha = 1;
    const lines = [
      'Drag anywhere to swim (mouse: point / hold)',
      'Eat food, kill cells, level up, grow a swarm',
      'Survive 75s — the Queen arrives at the end',
    ];
    lines.forEach((l, i) => text(l, W / 2, H * 0.68 + 36 + i * 20, fitSize(l, W - 30, 13, 500), '#b8c4e0', 'center', 500, false));
    if (game.best) text('Best ' + game.best, W / 2, H - safeBottom - 24, 13, '#8d9bc0', 'center', 600, false);
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05; // avoid huge steps after tab switches
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // debug hook (handy from the console): window.__microbe.game
  window.__microbe = { game, CFG, director, startRun, chooseSkill };
})();
