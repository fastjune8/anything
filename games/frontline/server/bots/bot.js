// 봇 전투 AI: 시야 판단 → 이동 → 조준 → 사격 (서버 전용)
import { rayWorld } from '../../shared/collision.js';
import { WEAPONS, calcDamage } from '../../shared/weapons.js';
import { LEAN_DIST } from '../../shared/constants.js';

// ───────── 봇 AI ─────────
const EYE = 1.55;
const SPEED = 4.6;          // m/s
const VIEW = 70;            // 시야 거리
const FOV_HALF = (75 * Math.PI) / 180; // 정면 ±75° (6m 이내는 소리로 감지)
const WEAPON_POOL = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6];
const PREF_RANGE = { m4: 22, ak: 22, mp5: 14, m870: 8, awm: 40, m249: 26, m9: 12 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Bot {
  constructor(player, room) {
    this.p = player; this.room = room;
    this.nav = room.nav; // 이 방의 맵에 맞는 길찾기
    this.skill = 0.5 + Math.random() * 0.35;
    const s0 = room.map.spawns.ffa[0];
    this.reset([s0[0], 0, s0[1]]);
  }

  reset(pos) {
    this.x = pos[0]; this.z = pos[2];
    this.yaw = Math.atan2(pos[0], pos[2]); this.pitch = 0;
    this.weapon = WEAPON_POOL[(Math.random() * WEAPON_POOL.length) | 0];
    this.path = null; this.pi = 0; this.repath = 0;
    this.target = null; this.seenT = 99; this.lastKnown = null; this.react = 0;
    this.fireCd = 0.4; this.burst = 0; this.pause = 0.6;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 1;
    this.stuckT = 0; this.sx = this.x; this.sz = this.z;
    this.p.pos = [this.x, 0, this.z];
  }

  setGoal(x, z) {
    this.path = this.nav.findPath(this.x, this.z, x, z); this.pi = 0;
    return !!this.path;
  }

  tryMove(mx, mz) {
    const nx = this.x + mx, nz = this.z + mz;
    if (!this.nav.isBlocked(nx, nz)) { this.x = nx; this.z = nz; return true; }
    if (!this.nav.isBlocked(nx, this.z)) { this.x = nx; return true; }
    if (!this.nav.isBlocked(this.x, nz)) { this.z = nz; return true; }
    return false;
  }

  followPath(dt, speed) {
    if (!this.path || this.pi >= this.path.length) return false;
    const [wx, wz] = this.path[this.pi];
    const dx = wx - this.x, dz = wz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.35) { this.pi++; return this.pi < this.path.length; }
    const s = Math.min(d, speed * dt);
    this.tryMove((dx / d) * s, (dz / d) * s);
    return true;
  }

  // 목표 지점으로 가고, 도착하면 그 안에서 자리를 조금씩 옮기며 머문다 (가만히 서 있으면 쉬운 표적이 된다)
  holdObjective(dt, a) {
    const inside = Math.hypot(this.x - a.x, this.z - a.z) <= a.r;
    if (this.followPath(dt, inside ? SPEED * 0.5 : SPEED)) return;
    this.holdT = (this.holdT || 0) - dt;
    if (inside && this.holdT > 0) return;
    this.holdT = 0.6 + Math.random() * 1.8;
    const g = this.nav.pointNear(a.x, a.z, a.r * 0.75);
    if (!g || !this.setGoal(g[0], g[1])) { const r = this.nav.randomReachablePoint(); this.setGoal(r[0], r[1]); }
  }

  canSee(pt) {
    const dx = pt[0] - this.x, dy = pt[1] - EYE, dz = pt[2] - this.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const r = rayWorld({ x: this.x, y: EYE, z: this.z }, { x: dx / dist, y: dy / dist, z: dz / dist }, this.nav.COLLIDERS, dist);
    return r.t >= dist - 0.1;
  }
  // 상대의 보이는 지점 (몸 가운데, 아니면 기울여 내민 머리 쪽). 안 보이면 null
  visiblePoint(o) {
    const tp = o.pos, cy = o.crouch ? 0.85 : 1.2;
    const center = [tp[0], tp[1] + cy, tp[2]];
    if (this.canSee(center)) return center;
    const l = o.lean || 0;
    if (Math.abs(l) < 0.2) return null;
    const off = l * LEAN_DIST * 0.85, yaw = o.yaw || 0;
    const peek = [tp[0] + Math.cos(yaw) * off, tp[1] + cy + 0.18, tp[2] - Math.sin(yaw) * off];
    return this.canSee(peek) ? peek : null;
  }

  update(dt) {
    const p = this.p;
    if (!p.alive) return;
    const w = WEAPONS[this.weapon];

    // 1) 시야: 가장 가까운 보이는 적
    const now = Date.now();
    let best = null, bestD = Infinity, bestPt = null;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const o of this.room.players.values()) {
      if (!this.room.isEnemy(p, o) || !o.alive || !o.pos || o.invulnUntil > now) continue; // 아군/무적인 상대는 노리지 않는다
      const dx = o.pos[0] - this.x, dz = o.pos[2] - this.z, d = Math.hypot(dx, dz);
      if (d > VIEW || d >= bestD) continue;
      if (d > 6 && (dx * fx + dz * fz) / d < Math.cos(FOV_HALF)) continue;
      const pt = this.visiblePoint(o);
      if (!pt) continue;
      best = o; bestD = d; bestPt = pt;
    }
    if (best) {
      if (this.target !== best) { this.target = best; this.react = (0.25 + Math.random() * 0.35) * (1.4 - this.skill); }
      this.seenT = 0; this.lastKnown = { x: best.pos[0], z: best.pos[2] };
    } else {
      this.seenT += dt;
      if (this.seenT > 2.5) this.target = null;
    }

    // 2) 이동
    this.repath -= dt; this.strafeT -= dt;
    let moving = true;
    if (best) {
      const range = PREF_RANGE[w.id] || 20;
      if (bestD > range + 4) {
        if (this.repath <= 0 || !this.path) { this.setGoal(best.pos[0], best.pos[2]); this.repath = 0.8; }
        if (!this.followPath(dt, SPEED)) moving = false;
      } else {
        if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 0.7 + Math.random() * 1.6; }
        const sx = Math.cos(this.yaw) * this.strafe, sz = -Math.sin(this.yaw) * this.strafe;
        if (!this.tryMove(sx * SPEED * 0.55 * dt, sz * SPEED * 0.55 * dt)) this.strafe = -this.strafe;
        this.path = null;
      }
    } else if (this.lastKnown && this.seenT < 6) {
      if (!this.path || this.repath <= 0) { this.setGoal(this.lastKnown.x, this.lastKnown.z); this.repath = 1.2; }
      if (!this.followPath(dt, SPEED)) { this.lastKnown = null; moving = false; }
    } else {
      const goal = this.room.rules.objective(p); // 모드 목표 (점령전: 거점). 없으면 돌아다닌다
      if (goal) this.holdObjective(dt, goal);
      else if (!this.followPath(dt, SPEED * 0.85)) {
        const g = this.nav.randomReachablePoint();
        this.setGoal(g[0], g[1]);
      }
    }

    // 3) 막힘 감지 (1초 동안 거의 못 움직이면 경로 포기)
    this.stuckT += dt;
    if (this.stuckT >= 1) {
      if (moving && Math.hypot(this.x - this.sx, this.z - this.sz) < 0.4) { this.path = null; this.lastKnown = null; }
      this.sx = this.x; this.sz = this.z; this.stuckT = 0;
    }

    // 4) 다른 플레이어와 겹치지 않게 살짝 밀어냄
    for (const o of this.room.players.values()) {
      if (o === p || !o.alive || !o.pos) continue;
      const dx = this.x - o.pos[0], dz = this.z - o.pos[2], d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 0.001) this.tryMove((dx / d) * (0.8 - d) * 0.5, (dz / d) * (0.8 - d) * 0.5);
    }

    // 5) 조준 방향
    let wantYaw = this.yaw, wantPitch = 0, aimed = false;
    if (best) {
      const dx = bestPt[0] - this.x, dz = bestPt[2] - this.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(bestPt[1] - EYE, Math.hypot(dx, dz));
    } else if (this.path && this.pi < this.path.length) {
      wantYaw = Math.atan2(-(this.path[this.pi][0] - this.x), -(this.path[this.pi][1] - this.z));
    }
    const rate = (5 + this.skill * 5) * dt;
    const dy = wrapPi(wantYaw - this.yaw);
    this.yaw = wrapPi(this.yaw + clamp(dy, -rate, rate));
    this.pitch += clamp(wantPitch - this.pitch, -rate, rate);
    if (best) aimed = Math.abs(wrapPi(wantYaw - this.yaw)) < 0.12;

    // 6) 사격
    this.react -= dt; this.pause -= dt; this.fireCd -= dt;
    if (best && this.react <= 0 && this.pause <= 0 && aimed) {
      let shots = 0;
      while (this.fireCd <= 0 && shots < 3) {
        this.shoot(best, bestD, w, bestPt);
        this.fireCd += 60 / w.rpm; shots++;
        if (--this.burst <= 0) {
          this.pause = w.auto ? 0.25 + Math.random() * 0.55 : 0.05 + Math.random() * 0.25;
          this.burst = w.auto ? (w.mag >= 100 ? 10 + ((Math.random() * 8) | 0) : 3 + ((Math.random() * 5) | 0)) : 1;
          break;
        }
      }
    } else if (this.fireCd < 0) this.fireCd = 0;

    p.pos[0] = this.x; p.pos[1] = 0; p.pos[2] = this.z;
  }

  // pt: 노리는 지점 (visiblePoint). 벽 뒤에서 머리만 내민 상대는 맞히기 어렵다
  shoot(target, dist, w, pt) {
    const wi = this.weapon;
    const tx = pt[0], ty = pt[1], tz = pt[2];
    const peeking = pt[1] - target.pos[1] > (target.crouch ? 0.9 : 1.25);
    const ox = this.x, oy = EYE, oz = this.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const muzzle = [+(ox + fx * 0.6).toFixed(2), +(oy - 0.1).toFixed(2), +(oz + fz * 0.6).toFixed(2)];
    const pHit = Math.max(0.08, 0.82 - dist * 0.011) * this.skill * (w.pellets > 1 ? 0.85 : 1) * (peeking ? 0.45 : 1);

    let dmg = 0, head = false;
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      if (Math.random() < pHit) {
        const r = Math.random(), part = r < 0.1 ? 'head' : r < 0.22 ? 'leg' : 'body';
        dmg += calcDamage(wi, part, dist);
        if (part === 'head') head = true;
        const hy = part === 'head' ? ty + 0.4 : part === 'leg' ? ty - 0.7 : ty;
        ends.push([+tx.toFixed(2), +hy.toFixed(2), +tz.toFixed(2), 6]);
      } else {
        const off = 0.8 + Math.random() * 2.2;
        let dx = tx - ox + (Math.random() * 2 - 1) * off, dy = ty - oy + (Math.random() * 2 - 1) * off * 0.5, dz = tz - oz + (Math.random() * 2 - 1) * off;
        const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
        const rw = rayWorld({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, this.nav.COLLIDERS, 200);
        ends.push([+(ox + dx * rw.t).toFixed(2), +(oy + dy * rw.t).toFixed(2), +(oz + dz * rw.t).toFixed(2), rw.n >= 0 ? rw.n : 2]);
      }
    }
    this.p.invulnUntil = 0;
    this.room.broadcast({ t: 'shot', id: this.p.id, w: wi, o: muzzle, e: ends });
    if (dmg > 0) this.room.applyDamage(this.p, target, wi, Math.round(dmg), head);
  }
}
