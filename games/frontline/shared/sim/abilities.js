// 무기 스킬의 동작 (서버·브라우저 공용, 결정적). 수치는 content/skills.json.
//   액티브(Q/E): 쿨타임·충전은 플레이어 상태(ps.sk)에 있어 브라우저가 예측하고 서버가 같은 계산으로 확정한다.
//   이동 스킬(대쉬·구르기·백스텝·그래플·슬래시)은 shared/sim/movement.js 의 스킬 이동으로, 상태 효과(무적·투명·피해 감소·공격 속도)는 ps.st 로.
//   서버만 할 수 있는 일(유탄 비행, 슬래시 경로 피해, 넉백 적용, 출혈)은 사건(ev)으로 넘긴다.
import { startMotion, applyImpulse, wishDir, eyeY, ropeTarget, findLedge } from './movement.js';
import { rayWorld } from '../collision.js';
import { MOVE } from './config.js';
import { kunaiAbility } from './kunai.js';

// 그 무기를 손에 들고 있어야 쓰는 스킬 (안 들고 있으면 꺼내고, 다 꺼내면 바로 발동)
export const NEEDS_HELD = new Set(['slash', 'fanning', 'shove', 'grenade', 'kunai']);
// 쿨타임 대신 충전 수를 쓰는 스킬
export const CHARGED = new Set(['grenade']);

export const aimDir = (yaw, pitch) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });

// 자리별 스킬 상태 처음으로
export function resetSkillState(ps, lo) {
  ps.sk = lo.map(l => ({ cd: 0, ch: l.skill && CHARGED.has(l.skill.effect) ? l.skill.charges : 0, rech: 0 }));
}
// 쿨타임·충전 진행
export function tickSkills(ps, lo, dt) {
  for (let i = 0; i < lo.length; i++) {
    const s = ps.sk[i], sk = lo[i].skill;
    if (!sk) continue;
    if (CHARGED.has(sk.effect)) {
      if (s.ch < sk.charges) { s.rech += dt; if (s.rech >= sk.cd) { s.rech = 0; s.ch++; } } else s.rech = 0;
    } else s.cd = Math.max(0, s.cd - dt);
  }
}
export function skillReady(ps, lo, slot) {
  const sk = lo[slot] && lo[slot].skill, s = ps.sk[slot];
  if (!sk || sk.type !== 'active' || !s) return false;
  return CHARGED.has(sk.effect) ? s.ch > 0 : s.cd <= 0;
}

// 액티브 스킬 발동. 반환: 발동했나 (조건이 안 맞으면 쿨타임을 쓰지 않는다)
export function activate(ps, lo, slot, cs, ev, inp) {
  const sk = lo[slot].skill, s = ps.sk[slot];
  const fwd = inp.fwd, side = inp.side;
  let ok = true;
  switch (sk.effect) {
    case 'adrenaline': ps.st.adren = sk.dur; ps.adrenRate = sk.rate; break;
    case 'dash': startMotion(ps, 'dash', { dir: wishDir(ps, fwd, side), dist: sk.dist, dur: sk.dur, end: MOVE.sprint }); break;
    case 'roll': startMotion(ps, 'roll', { dir: wishDir(ps, fwd, side), dist: sk.dist, dur: sk.dur, end: MOVE.walk }); ps.st.invuln = sk.dur; break;
    case 'slash': {
      startMotion(ps, 'slash', { dir: { x: -Math.sin(ps.yaw), z: -Math.cos(ps.yaw) }, dist: sk.dist, dur: sk.dur, end: MOVE.walk });
      ps.st.dr = sk.dur; ps.drMul = sk.mul;
      ev.slash = { slot, dmg: sk.dmg };
      break;
    }
    case 'backstep': {
      const bx = Math.sin(ps.yaw), bz = Math.cos(ps.yaw); // 뒤
      ps.vx = bx * sk.force; ps.vz = bz * sk.force; ps.vy = Math.max(ps.vy, 3);
      applyImpulse(ps, 0, 0, 0, 0.35);
      ps.st.bs = sk.dur; ps.bsMul = sk.mul;
      break;
    }
    case 'grapple': {
      const d = aimDir(ps.yaw, ps.pitch), o = { x: ps.x, y: eyeY(ps), z: ps.z };
      const h = rayWorld(o, d, cs, sk.range);
      if (h.t >= sk.range || h.t < 2) { ok = false; ev.grappleMiss = true; break; }
      const hit = { x: o.x + d.x * h.t, y: o.y + d.y * h.t, z: o.z + d.z * h.t }, tg = ropeTarget(hit, h.n);
      // 위도우메이커식: 탁 당겨져 곧게 날아가고, 박힌 곳 위에 올라설 자리가 있으면 끝에서 턱을 넘겨 준다
      startMotion(ps, 'grapple', { tx: tg.x, ty: tg.y, tz: tg.z, dur: sk.dur, max: sk.speed, snap: 9, steer: 3, grav: 0.12, arrive: 1.2, kick: 0.6, ledge: findLedge(cs, hit, h.n) });
      ev.grapple = { x: o.x + d.x * h.t, y: o.y + d.y * h.t, z: o.z + d.z * h.t };
      break;
    }
    case 'stealth': ps.st.stealth = sk.dur; break;
    case 'shove': ps.st.shove = sk.dur; ps.shove = { force: sk.force, stun: sk.stun }; break;
    case 'fanning': {
      const w = ps.w[slot];
      if (w.ammo <= 0 || w.rl > 0) { ok = false; break; }
      w.burst = Math.min(sk.shots, w.ammo); w.burstCd = 0; ps.fanSpread = sk.spread; ps.fanGap = sk.gap;
      break;
    }
    case 'grenade': {
      const d = aimDir(ps.yaw, ps.pitch);
      ev.grenade = { slot, o: { x: ps.x, y: eyeY(ps), z: ps.z }, d };
      break;
    }
    case 'kunai': ok = kunaiAbility(ps, ev, cs); break; // 쿠나이: 기동 모드 = 앵커로 끌려가기, 설치 모드 = 와이어 (shared/sim/kunai.js)
    default: ok = false;
  }
  if (!ok) return false;
  if (CHARGED.has(sk.effect)) s.ch--; else s.cd = sk.cd;
  ps.st.protect = 0; // 부활 보호: 액티브 스킬을 쓰면 풀린다 (기획 5.3)
  (ev.skills || (ev.skills = [])).push({ slot, effect: sk.effect });
  return true;
}
