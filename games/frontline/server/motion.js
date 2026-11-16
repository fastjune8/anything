// 서버 권한 이동 (M1): 사람 플레이어의 위치를 서버가 정한다.
//   브라우저는 1/60초마다의 입력(키·시선)만 보내고(`in`), 서버는 같은 이동 함수(shared/movement.js)로 계산한다.
//   결과는 본인에게 `me`(전체 상태 + 어디까지 처리했는지)로, 다른 사람에게 `s`(위치·시선)로 보낸다.
//   브라우저는 자기 입력으로 먼저 움직여 보이고(예측), `me` 를 받으면 서버 상태로 맞춘 뒤 아직 처리 안 된 입력을 다시 적용한다(보정).
// 속도 핵 방지: 실제로 흐른 시간만큼의 입력만 받는다 (1초에 60개 + 잠깐 몰리는 것을 위한 여유).
import { newMoveState, stepMovement, MAX_STEP_DT } from '../shared/movement.js';
import { LEAN_DIST } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';

export const STEP = MAX_STEP_DT;     // 입력 하나 = 1/60초
export const FLAG = { jump: 1, crouch: 2, sprint: 4, leanL: 8, leanR: 16 };
const BURST = 30;                    // 한꺼번에 몰려와도 받아 주는 입력 수 (0.5초 분량)
const MAX_PER_MSG = 120;             // 메시지 하나에 들어올 수 있는 입력 수
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// 입력 하나: [앞뒤, 좌우, 플래그, yaw, pitch, 무기번호, 정조준 정도 0~1]
export function decodeInput(a, wstats) {
  const flags = a[2] | 0, wi = a[5] | 0;
  const w = (wstats && wstats[wi]) || WEAPONS[wi] || WEAPONS[0];
  return {
    move: { fwd: clamp(Math.round(num(a[0])), -1, 1), side: clamp(Math.round(num(a[1])), -1, 1),
      jump: !!(flags & FLAG.jump), crouch: !!(flags & FLAG.crouch), sprint: !!(flags & FLAG.sprint), leanL: !!(flags & FLAG.leanL), leanR: !!(flags & FLAG.leanR),
      speedMul: w.move * (1 - 0.4 * clamp(num(a[6]), 0, 1)) },
    yaw: num(a[3]), pitch: clamp(num(a[4]), -1.6, 1.6), wi,
  };
}

// 태어날 때: 이동 상태를 새로
export function resetMotion(p, pos, now = Date.now()) {
  p.ms = newMoveState({ x: pos[0], y: pos[1], z: pos[2] }, { x: 0, y: 0, z: 0 });
  p.ms.yaw = Math.atan2(pos[0], pos[2]) || 0;
  p.pitch = 0; p.budget = BURST; p.budgetAt = now; p.msDirty = true;
  if (p.lastSeq === undefined) p.lastSeq = -1;
  syncPublic(p);
}

// 서버 상태 → 다른 코드(봇 시야, 거점, 명중 거리)가 쓰는 값
function syncPublic(p) {
  const s = p.ms;
  p.pos = [s.pos.x, s.pos.y, s.pos.z];
  p.crouch = s.crouch || !!s.vault ? 1 : 0;
  p.yaw = s.yaw; p.lean = s.leanOff / LEAN_DIST;
}

// `in` 메시지 처리. m = { s: 첫 입력 번호, i: [입력, …] }. 반환: 실제로 계산한 입력 수
export function applyInputs(p, m, colliders, now = Date.now()) {
  if (!p.ms || !Array.isArray(m.i) || !Number.isInteger(m.s)) return 0;
  p.budget = Math.min(BURST, p.budget + ((now - p.budgetAt) / 1000) * 60); p.budgetAt = now;
  let done = 0;
  const list = m.i.slice(0, MAX_PER_MSG);
  for (let k = 0; k < list.length; k++) {
    const seq = m.s + k;
    if (seq <= p.lastSeq || !Array.isArray(list[k])) continue; // 이미 처리한 것
    p.lastSeq = seq;                                           // 버린 입력도 "처리함" 으로 친다 → 브라우저는 서버 상태로 돌아간다
    if (p.budget < 1) continue;                                // 시간보다 많이 보냄 (속도 핵) → 버린다
    p.budget -= 1;
    const inp = decodeInput(list[k], p.wstats);
    p.ms.yaw = inp.yaw; p.pitch = inp.pitch; p.wcur = inp.wi;
    if (p.alive) stepMovement(p.ms, inp.move, colliders, STEP);
    done++;
  }
  syncPublic(p); p.msDirty = true;
  return done;
}

// 본인에게: 서버 상태 전체 (브라우저가 그대로 덮어쓰고 남은 입력을 다시 적용한다)
export function selfState(p) {
  const s = p.ms;
  return {
    t: 'me', q: p.lastSeq, k: p.tpn | 0, // k: 지금까지 받은 순간이동 수 (브라우저가 순간이동 전에 계산된 결과를 버리는 데 쓴다)
    st: { p: [s.pos.x, s.pos.y, s.pos.z], v: [s.vel.x, s.vel.y, s.vel.z], g: s.onGround, c: s.crouch, h: s.h, so: s.stepOff, ln: s.lean, lo: s.leanOff, va: s.vault, vl: s.vaultLock, at: s.airT },
  };
}
// 다른 사람에게: 위치·시선 (예전 `s` 와 같은 모양)
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
export function publicState(p) {
  return { t: 's', id: p.id, p: p.pos.map(r3), y: r3(p.ms.yaw), x: r3(p.pitch || 0), c: p.crouch, w: p.wcur | 0, l: r2(p.lean) };
}

// 개발·테스트용 순간이동 (라이브에서는 꺼져 있다)
export function teleport(p, pos, yaw) {
  if (!p.ms) return;
  const s = p.ms;
  s.pos.x = pos[0]; s.pos.y = pos[1]; s.pos.z = pos[2];
  s.vel.x = s.vel.y = s.vel.z = 0; s.vault = null; s.onGround = true; s.stepOff = 0;
  if (Number.isFinite(yaw)) s.yaw = yaw;
  p.tpn = (p.tpn | 0) + 1;
  syncPublic(p); p.msDirty = true;
}
