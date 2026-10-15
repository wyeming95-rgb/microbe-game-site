'use strict';
/**
 * Left 4 Dead-style pacing director.
 *
 *   BUILD  -> spawn rate ramps up; intensity rises from spawns, enemies crowding
 *             the player and damage taken. When intensity hits PEAK ->
 *   PEAK   -> short sustained surge (~2.5s) ->
 *   RELAX  -> 5-10s of calm: no spawns, intensity drains ->
 *   BUILD  -> ...
 *   BOSS   -> final phase: only a slow trickle (the boss spawns its own minions).
 */
class Director {
  constructor() {
    this.PEAK = 100;
    this.reset();
  }

  reset() {
    this.state = 'build';
    this.stateTime = 0;
    this.intensity = 0;
    this.relaxDuration = 0;
    this.spawnTimer = 1.2;
    this.cycles = 0;
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
    if (s === 'relax') this.relaxDuration = rand(5, 10);
    if (s === 'build') {
      this.spawnTimer = 0.8;
      this.cycles++;
      this.intensity = Math.min(this.intensity, this.PEAK * 0.35); // always leave room to build
    }
  }

  enterBoss() { this.setState('boss'); this.spawnTimer = 3; }

  add(amount) { this.intensity = clamp(this.intensity + amount, 0, this.PEAK * 1.25); }
  onSpawn(cost) { this.add(cost); }
  onPlayerDamaged(dmg) { this.add(dmg * 1.6); }
  onKillNearPlayer() { this.add(1.5); }

  /** Seconds between spawn events in the current state (Infinity = none). */
  spawnInterval(runTime) {
    const difficulty = 1 + runTime / 60 + this.cycles * 0.06;
    switch (this.state) {
      case 'build': {
        const ramp = clamp(this.stateTime / 14, 0, 1);
        return lerp(1.6, 0.5, ramp) / difficulty;
      }
      case 'peak': return 0.4 / difficulty;
      case 'boss': return 3.2;
      default: return Infinity; // relax
    }
  }

  /**
   * @param {number} dt
   * @param {{runTime:number, nearby:number}} info nearby = enemies close to the player
   * @returns {number} how many spawn events should happen this frame
   */
  update(dt, info) {
    this.stateTime += dt;
    // pressure from enemies crowding the player (ignored while relaxing so calm can happen)
    if (this.state !== 'relax') this.add(info.nearby * 0.45 * dt);

    switch (this.state) {
      case 'build':
        this.add(-2.5 * dt);
        if (this.intensity >= this.PEAK) this.setState('peak');
        break;
      case 'peak':
        this.add(-4 * dt);
        if (this.stateTime >= 2.5) this.setState('relax');
        break;
      case 'relax':
        this.add(-16 * dt);
        if (this.stateTime >= this.relaxDuration) this.setState('build');
        break;
      case 'boss':
        this.add(-6 * dt);
        break;
    }

    const interval = this.spawnInterval(info.runTime);
    if (!isFinite(interval)) return 0;
    this.spawnTimer -= dt;
    let n = 0;
    while (this.spawnTimer <= 0 && n < 3) {
      this.spawnTimer += interval;
      n++;
    }
    return n;
  }

  get label() {
    return { build: 'BUILDING', peak: 'SURGE', relax: 'CALM', boss: 'BOSS' }[this.state];
  }
  get color() {
    return { build: '#ffb22e', peak: '#ff4d5e', relax: '#5ec8ff', boss: '#e05aa8' }[this.state];
  }
}
