// 봇 AI: 사람과 똑같은 입력(cmd)을 만든다 → 이동·사격·스킬이 사람과 같은 시뮬레이션(shared/sim/player.js)으로 돌아간다.
//   시야(시야각·벽) → 목표 고르기(반응 시간) → 조준(부드럽게 돌리고, 오래 볼수록 정확) → 거리 유지·좌우 무빙·점프·슬라이딩
//   → 무기 바꾸기(거리) → 스킬(상황별) → 목표가 없으면 거점·소리 난 곳·아무 곳으로 길찾기(nav.js)
import { WEAPONS } from '../../shared/weapons.js';
import { skillsFor } from '../../shared/skills.js';
import { eyeY, hSpeed } from '../../shared/sim/movement.js';
import { skillReady } from '../../shared/sim/abilities.js';
import { rayWorld } from '../../shared/collision.js';
import { BTN, HEALTH } from '../../shared/sim/config.js';

const PAIRS = [['ar', 'revolver'], ['mp5', 'knife'], ['m870', 'akimbo'], ['awm', 'mp5'], ['m249', 'revolver'], ['ar', 'm870'], ['akimbo', 'knife'], ['revolver', 'mp5'], ['awm', 'akimbo'], ['ar', 'knife']];
// 무기 종류별 좋아하는 거리 [가까이, 멀리] · 조준 오차(도) · 반응 시간(초)
const STYLE = {
  ar: [10, 32, 2.2, 0.3], smg: [4, 16, 2.6, 0.26], shotgun: [2, 8, 3.2, 0.24], sniper: [25, 60, 1.6, 0.45], melee: [0, 2, 4, 0.2],
  revolver: [8, 26, 1.8, 0.32], akimbo: [4, 15, 2.8, 0.26], lmg: [12, 38, 2.6, 0.34],
};
export function botLoadout(id) {
  const pair = PAIRS[id % PAIRS.length];
  return pair.map((wid, n) => { const w = WEAPONS.find(x => x.id === wid), list = skillsFor(w, n); return { id: wid, skill: list.length ? list[(id * 7 + n * 3) % list.length].id : null }; });
}
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class Brain {
  constructor(P, room) { this.P = P; this.room = room; this.skill = 0.75 + ((P.id * 37) % 25) / 100; this.reset(); }
  reset() {
    const ps = this.P.ps;
    this.yaw = ps.yaw; this.pitch = 0; this.target = null; this.react = 0; this.track = 0; this.seenT = 0;
    this.path = null; this.goal = null; this.repath = 0; this.strafe = 1; this.strafeT = 0; this.jumpT = 1 + Math.random() * 3;
    this.lookT = 0; this.stuckT = 0; this.lastX = ps.x; this.lastZ = ps.z; this.firePulse = 0; this.slot = 0; this.skT = 1 + Math.random() * 2;
    this.heard = null; this.offX = (Math.random() - 0.5) * 2; this.offY = (Math.random() - 0.5) * 2;
  }
  style() { return STYLE[this.P.lo[this.P.ps.cur].w.kind] || STYLE.ar; }

  canSee(Q) {
    const ps = this.P.ps, o = { x: ps.x, y: eyeY(ps), z: ps.z };
    const tx = Q.ps.x, ty = Q.ps.y + Q.ps.h * 0.7, tz = Q.ps.z;
    const dx = tx - o.x, dy = ty - o.y, dz = tz - o.z, d = Math.hypot(dx, dy, dz);
    if (d > 75 || d < 0.01) return d < 0.01;
    return rayWorld(o, { x: dx / d, y: dy / d, z: dz / d }, this.room.map.layout.colliders, d).t >= d - 0.15;
  }
  perceive(dt) {
    this.lookT -= dt;
    if (this.lookT > 0 && this.target) return;
    this.lookT = 0.12;
    const P = this.P, ps = P.ps;
    let best = null, bd = Infinity;
    for (const Q of this.room.players.values()) {
      if (!Q.alive || !this.room.isEnemy(P, Q)) continue;
      const dx = Q.ps.x - ps.x, dz = Q.ps.z - ps.z, d = Math.hypot(dx, dz);
      if (Q.ps.st.stealth > 0 && d > 4) continue;                   // 투명한 적은 가까워야 보인다
      const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - ps.yaw));
      const aware = ang < 1.4 || (this.target === Q) || (P.hitBy && P.hitBy.id === Q.id && this.room.time - P.hitBy.t < 2) || d < 6;
      if (!aware || !this.canSee(Q)) continue;
      const score = d - (this.target === Q ? 8 : 0);
      if (score < bd) { bd = score; best = Q; }
    }
    if (best !== this.target) { this.target = best; this.react = best ? this.style()[3] * (1.3 - this.skill * 0.4) : 0; this.track = 0; this.offX = (Math.random() - 0.5) * 2; this.offY = (Math.random() - 0.5) * 2; }
    if (best) this.seenT = this.room.time;
  }

  think(dt) {
    const P = this.P, ps = P.ps, room = this.room;
    const cmd = { fwd: 0, side: 0, btn: 0, yaw: this.yaw, pitch: this.pitch, slot: this.slot, vt: room.tickN };
    if (!P.alive) return cmd;
    this.perceive(dt);
    const T = this.target && this.target.alive ? this.target : null;
    let wantYaw = this.yaw, wantPitch = 0, moveYaw = null, sprint = false;
    const [near, far, errDeg] = this.style();

    if (T) {
      const tp = T.ps, dist = Math.hypot(tp.x - ps.x, tp.z - ps.z);
      this.track += dt; this.react -= dt;
      // 조준: 가슴(잘하는 봇·저격은 가끔 머리) + 움직임을 조금 앞서 본다 + 오차(오래 볼수록 줄어든다)
      const lead = Math.min(0.12, dist / 300);
      const ax = tp.x + tp.vx * lead, az = tp.z + tp.vz * lead, ay = tp.y + tp.h * (this.skill > 0.9 ? 0.85 : 0.65);
      const e = errDeg * (Math.PI / 180) * (1.6 - this.skill) / (1 + this.track * 1.8);
      wantYaw = Math.atan2(-(ax - ps.x), -(az - ps.z)) + this.offX * e;
      wantPitch = Math.atan2(ay - eyeY(ps), Math.max(0.1, dist)) + this.offY * e * 0.6;
      // 거리 유지 + 좌우 무빙
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.5 + Math.random() * 0.9; }
      cmd.side = this.strafe;
      if (dist > far) { cmd.fwd = 1; sprint = dist > far + 8; }
      else if (dist < near) cmd.fwd = -1;
      // 무기: 거리에 더 맞는 쪽으로
      const other = 1 - ps.cur, ok = l => dist >= STYLE[l.w.kind][0] - 2 && dist <= STYLE[l.w.kind][1] + 6;
      if (!ok(P.lo[ps.cur]) && ok(P.lo[other]) && ps.drawT <= 0) this.slot = other;
      if (ps.w[ps.cur].ammo <= 0 && ps.w[other].ammo > 0 && P.lo[ps.cur].w.kind !== 'melee') this.slot = other;
      // 사격: 반응 시간이 지났고, 조준이 충분히 맞으면
      const aimErr = Math.abs(wrap(wantYaw - this.yaw)) + Math.abs(wantPitch - this.pitch);
      const w = P.lo[ps.cur].w;
      const inRange = w.kind === 'melee' ? dist < w.range + 0.4 : dist < w.range;
      if (this.react <= 0 && inRange && aimErr < 0.06 + (w.pellets > 1 ? 0.06 : 0) + (w.kind === 'melee' ? 0.3 : 0)) {
        this.firePulse++;
        if (w.auto || this.firePulse % 6 < 3) cmd.btn |= BTN.fire;
      }
      if ((w.kind === 'sniper' || ((w.kind === 'ar' || w.kind === 'lmg' || w.kind === 'revolver') && dist > 14)) && this.react <= 0.15) cmd.btn |= BTN.ads;
      if (w.kind === 'melee' || w.kind === 'shotgun') { cmd.fwd = dist > 1.5 ? 1 : 0; sprint = dist > 5; }
      // 가끔 점프 · 슬라이딩으로 다가간다
      this.jumpT -= dt;
      if (this.jumpT <= 0) { cmd.btn |= BTN.jump; this.jumpT = 1.5 + Math.random() * 3.5; }
      if (sprint && hSpeed(ps) > 6 && dist < 18 && Math.random() < 0.04) cmd.btn |= BTN.crouch;
      this.useSkills(cmd, T, dist);
      this.goal = null; this.path = null;
    } else {
      // 목표가 없음: 거점 → 들은 소리 → 아무 곳
      if (ps.w[ps.cur].ammo < P.lo[ps.cur].w.mag * 0.4 && ps.w[ps.cur].rl <= 0 && P.lo[ps.cur].w.kind !== 'melee') cmd.btn |= BTN.reload;
      this.repath -= dt;
      if (!this.goal || this.repath <= 0 || this.reached()) this.pickGoal();
      const wp = this.path && this.path[0];
      if (wp) {
        moveYaw = Math.atan2(-(wp[0] - ps.x), -(wp[1] - ps.z));
        wantYaw = moveYaw; wantPitch = 0;
        cmd.fwd = 1; sprint = true;
        if (Math.hypot(wp[0] - ps.x, wp[1] - ps.z) < 1.2) this.path.shift();
      }
      this.useSkills(cmd, null, 0);
      // 막혔으면 점프하고 다른 곳으로
      this.stuckT += dt;
      if (this.stuckT > 1) {
        if (Math.hypot(ps.x - this.lastX, ps.z - this.lastZ) < 0.5 && cmd.fwd) { cmd.btn |= BTN.jump; this.goal = null; }
        this.stuckT = 0; this.lastX = ps.x; this.lastZ = ps.z;
      }
    }
    if (sprint && !(cmd.btn & BTN.ads)) cmd.btn |= BTN.sprint;
    // 시선을 부드럽게 (초당 최대 회전 + 지수 감쇠)
    const turn = Math.min(1, dt * (T ? 9 + this.skill * 6 : 6));
    this.yaw = wrap(this.yaw + wrap(wantYaw - this.yaw) * turn);
    this.pitch += (wantPitch - this.pitch) * turn;
    cmd.yaw = this.yaw; cmd.pitch = Math.max(-1.4, Math.min(1.4, this.pitch)); cmd.slot = this.slot;
    return cmd;
  }
  reached() { const ps = this.P.ps; return this.goal && Math.hypot(this.goal[0] - ps.x, this.goal[1] - ps.z) < (this.goal[2] || 2); }
  pickGoal() {
    const P = this.P, ps = P.ps, nav = this.room.nav;
    const obj = this.room.rules.objectiveFor(P);
    let g = null;
    if (obj) { const p = nav.pointNear(obj.x + (Math.random() - 0.5) * obj.r, obj.z + (Math.random() - 0.5) * obj.r, 3); if (p) g = [p[0], p[1], obj.r * 0.6]; }
    if (!g) { // 소리가 난 쪽의 적 (개인전·팀 데스매치)
      let near = null, nd = Infinity;
      for (const Q of this.room.players.values()) if (Q.alive && this.room.isEnemy(P, Q)) { const d = Math.hypot(Q.ps.x - ps.x, Q.ps.z - ps.z); if (d < nd) { nd = d; near = Q; } }
      if (near && Math.random() < 0.6) { const p = nav.pointNear(near.ps.x, near.ps.z, 4); if (p) g = [p[0], p[1], 3]; }
    }
    if (!g) { const p = nav.randomReachablePoint(); g = [p[0], p[1], 2]; }
    this.goal = g; this.repath = 2.5 + Math.random() * 2;
    this.path = nav.findPath(ps.x, ps.z, g[0], g[1]) || [[g[0], g[1]]];
  }
  // 스킬: 상황에 맞으면 Q/E
  useSkills(cmd, T, dist) {
    const P = this.P, ps = P.ps;
    this.skT -= 1 / 60;
    if (this.skT > 0) return;
    for (let slot = 0; slot < 2; slot++) {
      const sk = P.lo[slot].skill;
      if (!sk || sk.type !== 'active' || !skillReady(ps, P.lo, slot)) continue;
      const hurt = P.hp < HEALTH.max * 0.55, e = sk.effect;
      let use = false;
      if (T) {
        if (e === 'adrenaline' || e === 'fanning') use = dist < 25 && ps.cur === slot;
        else if (e === 'dash') use = dist > 8 && dist < 22;
        else if (e === 'roll') use = hurt;
        else if (e === 'backstep') use = dist < 10;
        else if (e === 'slash') use = dist < 6.5;
        else if (e === 'shove') use = dist < 7 && ps.cur === slot;
        else if (e === 'grenade') use = dist > 8 && dist < 30 && ps.cur === slot;
        else if (e === 'stealth') use = hurt;
      } else {
        if (e === 'stealth') use = Math.random() < 0.3;
        else if (e === 'dash') use = Math.random() < 0.2 && cmd.fwd > 0;
      }
      if (use) { cmd.btn |= slot ? BTN.sk2 : BTN.sk1; this.skT = 1.2 + Math.random() * 2; return; }
    }
    this.skT = 0.4;
  }
}
