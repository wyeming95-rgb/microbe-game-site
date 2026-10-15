'use strict';
// Small math helpers + ShuffleBag ("marble bag") randomness.

const TAU = Math.PI * 2;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
// Frame-rate independent exponential smoothing toward a target.
function damp(a, b, rate, dt) { return lerp(a, b, 1 - Math.exp(-rate * dt)); }

// Remove items for which keep(item) is false, in place (no new array per frame).
function compact(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (keep(it)) arr[w++] = it;
  }
  arr.length = w;
}

/**
 * ShuffleBag: put every item (duplicates = weight) in a bag, shuffle, draw
 * without replacement; refill when empty. Guarantees an even spread and no
 * item appears more often than its count within one bag.
 */
class ShuffleBag {
  constructor(items, rng = Math.random) {
    this.items = items.slice();
    this.rng = rng;
    this.pool = [];
    this.last = undefined;
  }

  refill() {
    const p = this.items.slice();
    for (let i = p.length - 1; i > 0; i--) { // Fisher-Yates
      const j = Math.floor(this.rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    // Avoid an immediate repeat across the bag boundary (pool pops from the end).
    if (p.length > 1 && p[p.length - 1] === this.last) {
      const t = p[0]; p[0] = p[p.length - 1]; p[p.length - 1] = t;
    }
    this.pool = p;
  }

  next() {
    if (this.items.length === 0) return undefined;
    if (this.pool.length === 0) this.refill();
    this.last = this.pool.pop();
    return this.last;
  }

  /** Draw up to n distinct items. Duplicates drawn along the way go back into the bag. */
  nextUnique(n) {
    const distinct = new Set(this.items).size;
    n = Math.min(n, distinct);
    const out = [], rejected = [];
    let guard = 0;
    while (out.length < n && guard++ < 200) {
      const it = this.next();
      if (out.includes(it)) rejected.push(it); else out.push(it);
    }
    for (const it of rejected) {
      this.pool.splice(Math.floor(this.rng() * (this.pool.length + 1)), 0, it);
    }
    return out;
  }

  /** Permanently remove an item (all copies), e.g. a maxed-out skill. */
  remove(item) {
    this.items = this.items.filter(i => i !== item);
    this.pool = this.pool.filter(i => i !== item);
  }

  get remaining() { return this.pool.length; }
}
