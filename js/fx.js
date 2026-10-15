'use strict';
// Game-feel helpers: screen shake, floating damage numbers, particles, smooth health bars.

/** Trauma-based screen shake: add trauma on hits, offset = trauma^2 * max. */
class Shake {
  constructor(maxOffset = 16) {
    this.max = maxOffset;
    this.trauma = 0;
    this.x = 0;
    this.y = 0;
  }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  reset() { this.trauma = 0; this.x = 0; this.y = 0; }
  update(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * this.max;
    this.x = (Math.random() * 2 - 1) * s;
    this.y = (Math.random() * 2 - 1) * s;
  }
}

/** Damage numbers: pop in (overshoot scale), float up, fade. Size scales with value. */
class DamageNumbers {
  constructor(max = 48) {
    this.max = max;
    this.list = [];
  }
  add(x, y, value, color = '#ffffff', prefix = '') {
    const v = Math.max(1, Math.round(value));
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: x + rand(-6, 6), y,
      vx: rand(-25, 25), vy: -70 - Math.min(70, v * 1.5),
      life: 0, maxLife: 0.85,
      text: prefix + v,
      size: clamp(11 + Math.sqrt(v) * 3.4, 12, 46),
      color,
    });
  }
  clear() { this.list.length = 0; }
  update(dt) {
    for (const n of this.list) {
      n.life += dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.vy *= Math.exp(-3.5 * dt); // ease out the rise
    }
    compact(this.list, n => n.life < n.maxLife);
  }
  draw(ctx) {
    if (!this.list.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.list) {
      const t = n.life / n.maxLife;
      const pop = t < 0.15 ? lerp(1.8, 1, easeOutCubic(t / 0.15)) : 1;
      ctx.globalAlpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      ctx.font = `800 ${(n.size * pop).toFixed(1)}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(10,12,25,0.85)';
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Cheap circle particles with drag and fade. */
class Particles {
  constructor(max = 260) {
    this.max = max;
    this.list = [];
  }
  burst(x, y, color, count, speed = 160, size = 3, life = 0.5) {
    for (let i = 0; i < count && this.list.length < this.max; i++) {
      const a = rand(0, TAU), s = speed * rand(0.3, 1);
      this.list.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: size * rand(0.6, 1.3), life: 0, maxLife: life * rand(0.7, 1.3), color,
      });
    }
  }
  clear() { this.list.length = 0; }
  update(dt) {
    const drag = Math.exp(-4 * dt);
    for (const p of this.list) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
    }
    compact(this.list, p => p.life < p.maxLife);
  }
  draw(ctx) {
    for (const p of this.list) {
      const t = 1 - p.life / p.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + 0.6 * t), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Health bar with a smooth drain and a trailing "ghost" bar.
 * - display value tweens to the real value over `drainTime` (~0.75s, ease-out)
 * - ghost holds the old value for `ghostDelay`, then catches up to display
 * - colour: green > 50%, amber <= 50%, red <= 25% (based on the real value)
 */
class HealthBar {
  constructor(max, drainTime = 0.75, ghostDelay = 0.45) {
    this.drainTime = drainTime;
    this.ghostDelayTime = ghostDelay;
    this.reset(max);
  }
  reset(max, value = max) {
    this.max = max;
    this.value = value;
    this.display = value;
    this.ghost = value;
    this.from = value;
    this.tween = 1;
    this.ghostDelay = 0;
  }
  set(value, max = this.max) {
    this.max = max;
    value = clamp(value, 0, max);
    if (value === this.value) return;
    if (value < this.value) {
      // ghost keeps showing the pre-hit amount for a moment
      this.ghost = Math.max(this.ghost, this.display);
      this.ghostDelay = this.ghostDelayTime;
    }
    this.from = this.display;
    this.value = value;
    this.tween = 0;
  }
  update(dt) {
    if (this.tween < 1) {
      this.tween = Math.min(1, this.tween + dt / this.drainTime);
      this.display = lerp(this.from, this.value, easeOutCubic(this.tween));
    }
    if (this.ghost <= this.display) {
      this.ghost = this.display; // healing: ghost just rides along
    } else if (this.ghostDelay > 0) {
      this.ghostDelay -= dt;
    } else {
      this.ghost = Math.max(this.display, this.ghost - this.max * 1.1 * dt);
    }
  }
  get ratio() { return this.max > 0 ? this.value / this.max : 0; }
  color() {
    const r = this.ratio;
    return r <= 0.25 ? '#ff4d5e' : r <= 0.5 ? '#ffb22e' : '#4ff09a';
  }
  ghostColor() {
    const r = this.ratio;
    return r <= 0.25 ? '#ffc2c8' : r <= 0.5 ? '#ffe2b0' : '#c8ffe0';
  }
  draw(ctx, x, y, w, h, label) {
    const rad = h / 2;
    ctx.fillStyle = 'rgba(5,8,18,0.7)';
    roundRect(ctx, x - 2, y - 2, w + 4, h + 4, rad + 2);
    ctx.fill();
    const gw = w * clamp(this.ghost / this.max, 0, 1);
    const dw = w * clamp(this.display / this.max, 0, 1);
    if (gw > 0.5) {
      ctx.fillStyle = this.ghostColor();
      roundRect(ctx, x, y, gw, h, Math.min(rad, gw / 2));
      ctx.fill();
    }
    if (dw > 0.5) {
      ctx.fillStyle = this.color();
      roundRect(ctx, x, y, dw, h, Math.min(rad, dw / 2));
      ctx.fill();
      // gloss
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(ctx, x + 2, y + 1.5, Math.max(0, dw - 4), h * 0.3, h * 0.15);
      ctx.fill();
    }
    if (label) {
      ctx.font = `700 ${Math.max(10, h - 3)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(label, x + w / 2, y + h / 2 + 0.5);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    }
  }
}

/** Path a rounded rectangle (caller fills/strokes). */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
