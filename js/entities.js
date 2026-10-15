'use strict';
// Data tables (enemies, pickups, skills) and drawing for all entities.

const ENEMY_TYPES = {
  //        hp    radius speed contact  mass drops score  director cost
  wbc:    { hp: 26,   r: 15, speed: 74,  dmg: 8,  mass: 1,  drops: 1, score: 50,   cost: 6,
            color: '#e9eef8', edge: '#b9c3dc', name: 'White Blood Cell' },
  dart:   { hp: 12,   r: 10, speed: 95,  dmg: 12, mass: 0.6, drops: 1, score: 40,   cost: 4,
            color: '#ffd84d', edge: '#c99a12', name: 'Antibody' },
  macro:  { hp: 150,  r: 33, speed: 36,  dmg: 15, mass: 5,   drops: 5, score: 150,  cost: 14,
            color: '#7fd18b', edge: '#3f8e52', name: 'Macrophage' },
  minion: { hp: 14,   r: 11, speed: 100, dmg: 8,  mass: 0.8, drops: 1, score: 20,   cost: 0,
            color: '#f6a9c6', edge: '#c0567f', name: 'Phagolet' },
  boss:   { hp: 1500, r: 76, speed: 46,  dmg: 25, mass: 60,  drops: 0, score: 3000, cost: 0,
            color: '#d65a8c', edge: '#7e1f4b', name: 'Phagocyte Queen' },
};

// Food (spawned in the dish) and drops (from kills). Kinds are drawn from shuffle bags.
const PICKUP_TYPES = {
  food:  { r: 4.5, xp: 1, heal: 0,  score: 10, color: '#c6f36b' },
  feast: { r: 7,   xp: 3, heal: 0,  score: 30, color: '#ffa24a' },
  sugar: { r: 6,   xp: 0, heal: 8,  score: 10, color: '#ff7eb6' },
  xp:    { r: 5,   xp: 2, heal: 0,  score: 15, color: '#6fd3ff' },
  xp2:   { r: 7,   xp: 5, heal: 0,  score: 40, color: '#b98cff' },
  heal:  { r: 6.5, xp: 0, heal: 12, score: 10, color: '#ff7eb6' },
};

/** Skills offered on level-up. apply(api) receives the game API from game.js. */
const SKILLS = {
  cells: {
    name: 'Mitosis', max: 6, color: '#5ef0d0',
    desc: () => '+2 follower cells',
    apply: api => api.addFollowers(2),
  },
  speed: {
    name: 'Flagella', max: 5, color: '#7fb8ff',
    desc: () => '+12% move speed',
    apply: api => { api.player.speedMult += 0.12; },
  },
  spike: {
    name: 'Spike Proteins', max: 6, color: '#ff7a7a',
    desc: () => '+30% damage (contact & spores)',
    apply: api => { api.player.dmgMult += 0.3; },
  },
  split: {
    name: 'Split Shot', max: 4, color: '#ffd84d',
    desc: lvl => lvl === 0 ? 'You & cells fire spores' : '+1 spore per volley, faster',
    apply: api => { api.player.splitLvl += 1; },
  },
  magnet: {
    name: 'Chemotaxis', max: 4, color: '#b98cff',
    desc: () => '+60% food/XP pull radius',
    apply: api => { api.player.magnet *= 1.6; },
  },
  regen: {
    name: 'Regeneration', max: 4, color: '#4ff09a',
    desc: () => '+2 HP per second',
    apply: api => { api.player.regen += 2; },
  },
  maxhp: {
    name: 'Thick Membrane', max: 4, color: '#ff9e5e',
    desc: () => '+25 max HP & heal 25',
    apply: api => { api.player.maxHp += 25; api.heal(25); },
  },
};

// ---------------------------------------------------------------- drawing

const _bx = new Float32Array(24), _by = new Float32Array(24);

/** Build a smooth wobbly closed blob path. n <= 24 points. */
function blobPath(ctx, x, y, r, t, seed, wobble, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + wobble * (0.6 * Math.sin(t * 2.3 + seed + i * 1.7) + 0.4 * Math.sin(t * 3.7 + seed * 2.1 + i * 2.9));
    _bx[i] = x + Math.cos(a) * r * k;
    _by[i] = y + Math.sin(a) * r * k;
  }
  ctx.beginPath();
  ctx.moveTo((_bx[n - 1] + _bx[0]) / 2, (_by[n - 1] + _by[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(_bx[i], _by[i], (_bx[i] + _bx[j]) / 2, (_by[i] + _by[j]) / 2);
  }
  ctx.closePath();
}

function drawPlayer(ctx, p, t) {
  const flashing = p.flash > 0;
  // blink during i-frames
  if (p.iframes > 0 && !flashing && Math.floor(t * 20) % 2 === 0) ctx.globalAlpha = 0.45;
  blobPath(ctx, p.x, p.y, p.r, t * 1.6, 1.3, 0.09, 12);
  ctx.fillStyle = flashing ? '#ffffff' : '#3fe8b8';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = flashing ? '#ffffff' : '#139e86';
  ctx.stroke();
  if (!flashing) {
    // nucleus
    ctx.fillStyle = 'rgba(10,90,90,0.35)';
    ctx.beginPath();
    ctx.arc(p.x - p.face.x * 4, p.y - p.face.y * 4, p.r * 0.38, 0, TAU);
    ctx.fill();
    // eyes look in the movement direction
    const ex = p.face.x, ey = p.face.y, px = -ey, py = ex;
    for (const s of [-1, 1]) {
      const cx = p.x + ex * p.r * 0.35 + px * s * p.r * 0.32;
      const cy = p.y + ey * p.r * 0.35 + py * s * p.r * 0.32;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, cy, p.r * 0.24, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0b2030';
      ctx.beginPath(); ctx.arc(cx + ex * 1.6, cy + ey * 1.6, p.r * 0.12, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawFollower(ctx, f, t) {
  const flashing = f.flash > 0;
  blobPath(ctx, f.x, f.y, f.r, t * 2, f.seed, 0.12, 8);
  ctx.fillStyle = flashing ? '#ffffff' : '#8ff5dc';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = flashing ? '#ffffff' : '#2bb79a';
  ctx.stroke();
  if (!flashing) {
    ctx.fillStyle = 'rgba(20,110,100,0.5)';
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.35, 0, TAU); ctx.fill();
  }
}

function drawEnemy(ctx, e, t) {
  const def = e.def;
  const white = e.flash > 0;
  const fill = white ? '#ffffff' : def.color;
  const edge = white ? '#ffffff' : def.edge;

  switch (e.type) {
    case 'dart': {
      // antibody: a Y shape pointing along its heading
      const c = Math.cos(e.ang), s = Math.sin(e.ang);
      if (e.mode === 'aim') {
        // telegraph the dash line
        const k = 1 - e.timer / e.aimTime;
        ctx.strokeStyle = `rgba(255,90,90,${0.15 + 0.45 * k})`;
        ctx.lineWidth = 3 + 3 * k;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + c * 260, e.y + s * 260);
        ctx.stroke();
      }
      const L = e.r * 1.3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = edge;
      ctx.lineWidth = 7;
      dartPath(ctx, e.x, e.y, c, s, L);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 4;
      dartPath(ctx, e.x, e.y, c, s, L);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }
    case 'boss': {
      const pulse = e.tele > 0 ? 1 - e.tele / e.teleTime : 0;
      if (e.tele > 0) {
        ctx.strokeStyle = `rgba(255,80,140,${0.3 + 0.5 * pulse})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (1.15 + 0.25 * pulse), 0, TAU);
        ctx.stroke();
      }
      // spiky outer membrane
      blobPath(ctx, e.x, e.y, e.r * (1 + 0.06 * pulse), t * 1.2, e.seed, 0.1, 20);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = edge;
      ctx.stroke();
      if (!white) {
        blobPath(ctx, e.x, e.y, e.r * 0.55, t * 2, e.seed + 3, 0.15, 10);
        ctx.fillStyle = '#8c2459';
        ctx.fill();
        // single angry eye looking at the player
        ctx.fillStyle = '#ffe6f0';
        ctx.beginPath(); ctx.arc(e.x + Math.cos(e.ang) * 12, e.y + Math.sin(e.ang) * 12, e.r * 0.22, 0, TAU); ctx.fill();
        ctx.fillStyle = '#300';
        ctx.beginPath(); ctx.arc(e.x + Math.cos(e.ang) * 18, e.y + Math.sin(e.ang) * 18, e.r * 0.1, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'macro': {
      blobPath(ctx, e.x, e.y, e.r, t * 1.1, e.seed, 0.16, 14);
      ctx.fillStyle = fill;
      ctx.globalAlpha = white ? 1 : 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 4;
      ctx.strokeStyle = edge;
      ctx.stroke();
      if (!white) {
        ctx.fillStyle = 'rgba(40,100,55,0.55)';
        for (let i = 0; i < 4; i++) {
          const a = e.seed + i * 1.9 + t * 0.4;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * e.r * 0.45, e.y + Math.sin(a) * e.r * 0.45, e.r * 0.13, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#2f6e3f';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.28, 0, TAU); ctx.fill();
      }
      break;
    }
    default: { // wbc, minion
      blobPath(ctx, e.x, e.y, e.r, t * 1.8, e.seed, 0.12, 10);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = edge;
      ctx.stroke();
      if (!white) {
        // lobed nucleus
        ctx.fillStyle = e.type === 'wbc' ? '#8a6bd1' : '#b03a6b';
        for (let i = 0; i < 3; i++) {
          const a = e.seed + i * 2.1;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * e.r * 0.3, e.y + Math.sin(a) * e.r * 0.3, e.r * 0.27, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
}

function dartPath(ctx, x, y, c, s, L) {
  // stem behind, two arms forward
  ctx.beginPath();
  ctx.moveTo(x - c * L, y - s * L);
  ctx.lineTo(x, y);
  const a1c = Math.cos(0.55), a1s = Math.sin(0.55);
  // rotate heading by +-0.55 rad
  ctx.lineTo(x + (c * a1c - s * a1s) * L, y + (s * a1c + c * a1s) * L);
  ctx.moveTo(x, y);
  ctx.lineTo(x + (c * a1c + s * a1s) * L, y + (s * a1c - c * a1s) * L);
}

function drawPickup(ctx, it, t) {
  const pulse = 1 + 0.15 * Math.sin(t * 6 + it.seed);
  const r = it.r * pulse;
  ctx.fillStyle = it.def.color;
  switch (it.kind) {
    case 'xp':
    case 'xp2':
      ctx.beginPath();
      ctx.moveTo(it.x, it.y - r * 1.3);
      ctx.lineTo(it.x + r, it.y);
      ctx.lineTo(it.x, it.y + r * 1.3);
      ctx.lineTo(it.x - r, it.y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'heal':
    case 'sugar':
      ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(it.x - r * 0.55, it.y - r * 0.17, r * 1.1, r * 0.34);
      ctx.fillRect(it.x - r * 0.17, it.y - r * 0.55, r * 0.34, r * 1.1);
      break;
    default:
      ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(it.x - r * 0.3, it.y - r * 0.3, r * 0.35, 0, TAU); ctx.fill();
  }
}
