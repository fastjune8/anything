// 서버 전용: 봇 길찾기(내비 그리드 + A*)와 전투 AI
import { buildLayout, MAP_HALF } from './public/js/layout.js';
import { rayWorld } from './public/js/collision.js';
import { WEAPONS, calcDamage } from './public/js/shared.js';

const { colliders: COLLIDERS } = buildLayout();

// ───────── 내비게이션 그리드 ─────────
const CELL = 0.5;                 // 칸 크기(m)
const R = 0.32;                   // 봇 반지름 (장애물을 이만큼 부풀려서 막힘 판정)
const N = Math.round((2 * MAP_HALF) / CELL);
const blocked = new Uint8Array(N * N);
const reach = new Uint8Array(N * N); // 주 구역(스폰에서 걸어갈 수 있는 곳)

const cellOf = v => Math.min(N - 1, Math.max(0, Math.floor((v + MAP_HALF) / CELL)));
const centerOf = i => -MAP_HALF + (i + 0.5) * CELL;
const isBlocked = (x, z) => blocked[cellOf(z) * N + cellOf(x)] === 1;

// 서 있는 몸통 높이를 막는 물체만 장애물로 본다 (문 위 가로대·지붕·창문 위쪽은 통과 가능)
for (const c of COLLIDERS) {
  if (!(c.minY < 1.6 && c.maxY > 0.5)) continue;
  const x0 = cellOf(c.minX - R), x1 = cellOf(c.maxX + R);
  const z0 = cellOf(c.minZ - R), z1 = cellOf(c.maxZ + R);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const px = centerOf(cx), pz = centerOf(cz);
      if (px >= c.minX - R && px <= c.maxX + R && pz >= c.minZ - R && pz <= c.maxZ + R) blocked[cz * N + cx] = 1;
    }
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function canStep(cx, cz, dx, dz) {
  const nx = cx + dx, nz = cz + dz;
  if (nx < 0 || nz < 0 || nx >= N || nz >= N) return false;
  if (blocked[nz * N + nx]) return false;
  if (dx && dz && (blocked[cz * N + nx] || blocked[nz * N + cx])) return false; // 모서리 끼임 방지
  return true;
}

// 스폰 지점에서 flood fill 로 갈 수 있는 구역 표시
(function markReachable() {
  const start = [0, -54];
  let s = cellOf(start[1]) * N + cellOf(start[0]);
  if (blocked[s]) { // 가장 가까운 빈 칸
    for (let r = 1; r < 20 && blocked[s]; r++) {
      for (let dz = -r; dz <= r && blocked[s]; dz++) for (let dx = -r; dx <= r; dx++) {
        const i = (cellOf(start[1]) + dz) * N + cellOf(start[0]) + dx;
        if (i >= 0 && i < N * N && !blocked[i]) { s = i; break; }
      }
    }
  }
  const stack = [s]; reach[s] = 1;
  while (stack.length) {
    const cur = stack.pop(), cx = cur % N, cz = (cur / N) | 0;
    for (const [dx, dz] of DIRS) {
      if (!canStep(cx, cz, dx, dz)) continue;
      const ni = (cz + dz) * N + cx + dx;
      if (!reach[ni]) { reach[ni] = 1; stack.push(ni); }
    }
  }
})();

function nearestReach(x, z) {
  const cx = cellOf(x), cz = cellOf(z);
  if (reach[cz * N + cx]) return cz * N + cx;
  for (let r = 1; r < 24; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (reach[nz * N + nx]) return nz * N + nx;
      }
    }
  }
  return -1;
}

// 이진 힙 (A* 열린 목록)
const hI = [], hF = [];
function hPush(i, f) {
  let k = hI.length; hI.push(i); hF.push(f);
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (hF[p] <= hF[k]) break;
    [hI[p], hI[k]] = [hI[k], hI[p]]; [hF[p], hF[k]] = [hF[k], hF[p]]; k = p;
  }
}
function hPop() {
  const top = hI[0], li = hI.pop(), lf = hF.pop();
  if (hI.length) {
    hI[0] = li; hF[0] = lf;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1; let m = k;
      if (l < hI.length && hF[l] < hF[m]) m = l;
      if (r < hI.length && hF[r] < hF[m]) m = r;
      if (m === k) break;
      [hI[m], hI[k]] = [hI[k], hI[m]]; [hF[m], hF[k]] = [hF[k], hF[m]]; k = m;
    }
  }
  return top;
}

const seen = new Uint32Array(N * N), done = new Uint32Array(N * N);
const gScore = new Float32Array(N * N), parent = new Int32Array(N * N);
let stamp = 0;

function lineFree(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, steps = Math.ceil(Math.hypot(dx, dz) / 0.25);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isBlocked(ax + dx * t, az + dz * t)) return false;
  }
  return true;
}

// 반환: [[x,z], ...] (현재 위치 제외) 또는 null
export function findPath(sx, sz, tx, tz) {
  const s = nearestReach(sx, sz), g = nearestReach(tx, tz);
  if (s < 0 || g < 0) return null;
  const gx = g % N, gz = (g / N) | 0;
  const heur = (x, z) => { const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return dx + dz - 0.586 * Math.min(dx, dz); };
  stamp++; hI.length = 0; hF.length = 0;
  seen[s] = stamp; gScore[s] = 0; parent[s] = -1; hPush(s, 0);
  let expanded = 0;
  while (hI.length) {
    const cur = hPop();
    if (done[cur] === stamp) continue;
    done[cur] = stamp;
    if (cur === g) break;
    if (++expanded > 60000) return null;
    const cx = cur % N, cz = (cur / N) | 0;
    for (const [dx, dz, cost] of DIRS) {
      if (!canStep(cx, cz, dx, dz)) continue;
      const ni = (cz + dz) * N + cx + dx, ng = gScore[cur] + cost;
      if (seen[ni] !== stamp || ng < gScore[ni]) {
        seen[ni] = stamp; gScore[ni] = ng; parent[ni] = cur; hPush(ni, ng + heur(cx + dx, cz + dz));
      }
    }
  }
  if (seen[g] !== stamp || done[g] !== stamp) return null;

  const pts = [];
  for (let c = g; c !== -1; c = parent[c]) pts.push([centerOf(c % N), centerOf((c / N) | 0)]);
  pts.reverse();
  // 직선으로 갈 수 있는 구간은 건너뛰어 경로를 다듬는다
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 24);
    while (j > i + 1 && !lineFree(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
    out.push(pts[j]); i = j;
  }
  return out;
}

export function randomReachablePoint() {
  for (let k = 0; k < 200; k++) {
    const cx = (Math.random() * N) | 0, cz = (Math.random() * N) | 0;
    if (reach[cz * N + cx]) return [centerOf(cx), centerOf(cz)];
  }
  return [0, -54];
}

// ───────── 봇 AI ─────────
const EYE = 1.55;
const SPEED = 4.6;          // m/s
const VIEW = 70;            // 시야 거리
const FOV_HALF = (75 * Math.PI) / 180; // 정면 ±75° (6m 이내는 소리로 감지)
const WEAPON_POOL = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6];
const PREF_RANGE = { m4: 22, ak: 22, mp5: 14, m870: 8, awm: 40, m249: 26, m9: 12 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export const BOT_NAMES = ['Rook', 'Viper', 'Ghost', 'Nomad', 'Havoc', 'Raven', 'Bishop', 'Cobra', 'Falcon', 'Mamba', 'Titan', 'Echo', 'Saber', 'Wolf', 'Jackal', 'Onyx'];

export class Bot {
  constructor(player, room) {
    this.p = player; this.room = room;
    this.skill = 0.5 + Math.random() * 0.35;
    this.reset([0, 0, -54]);
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
    this.path = findPath(this.x, this.z, x, z); this.pi = 0;
    return !!this.path;
  }

  tryMove(mx, mz) {
    const nx = this.x + mx, nz = this.z + mz;
    if (!isBlocked(nx, nz)) { this.x = nx; this.z = nz; return true; }
    if (!isBlocked(nx, this.z)) { this.x = nx; return true; }
    if (!isBlocked(this.x, nz)) { this.z = nz; return true; }
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

  hasLOS(o) {
    const tp = o.pos, cy = o.crouch ? 0.85 : 1.2;
    const dx = tp[0] - this.x, dy = tp[1] + cy - EYE, dz = tp[2] - this.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const r = rayWorld({ x: this.x, y: EYE, z: this.z }, { x: dx / dist, y: dy / dist, z: dz / dist }, COLLIDERS, dist);
    return r.t >= dist - 0.1;
  }

  update(dt) {
    const p = this.p;
    if (!p.alive) return;
    const w = WEAPONS[this.weapon];

    // 1) 시야: 가장 가까운 보이는 적
    let best = null, bestD = Infinity;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const o of this.room.players.values()) {
      if (o === p || !o.alive || !o.pos) continue;
      const dx = o.pos[0] - this.x, dz = o.pos[2] - this.z, d = Math.hypot(dx, dz);
      if (d > VIEW || d >= bestD) continue;
      if (d > 6 && (dx * fx + dz * fz) / d < Math.cos(FOV_HALF)) continue;
      if (!this.hasLOS(o)) continue;
      best = o; bestD = d;
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
      if (bestD > range + 4) 
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
      if (!this.followPath(dt, SPEED * 0.85)) {
        const g = randomReachablePoint();
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
      const tp = best.pos, dx = tp[0] - this.x, dz = tp[2] - this.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(tp[1] + (best.crouch ? 0.85 : 1.2) - EYE, Math.hypot(dx, dz));
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
        this.shoot(best, bestD, w);
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

  shoot(target, dist, w) {
    const wi = this.weapon, tp = target.pos, cy = target.crouch ? 0.85 : 1.2;
    const tx = tp[0], ty = tp[1] + cy, tz = tp[2];
    const ox = this.x, oy = EYE, oz = this.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const muzzle = [+(ox + fx * 0.6).toFixed(2), +(oy - 0.1).toFixed(2), +(oz + fz * 0.6).toFixed(2)];
    const pHit = Math.max(0.08, 0.82 - dist * 0.011) * this.skill * (w.pellets > 1 ? 0.85 : 1);

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
        const rw = rayWorld({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, COLLIDERS, 200);
        ends.push([+(ox + dx * rw.t).toFixed(2), +(oy + dy * rw.t).toFixed(2), +(oz + dz * rw.t).toFixed(2), rw.n >= 0 ? rw.n : 2]);
      }
    }
    this.room.broadcast({ t: 'shot', id: this.p.id, w: wi, o: muzzle, e: ends });
    if (dmg > 0) this.room.applyDamage(this.p, target, wi, Math.round(dmg), head);
  }
}
