// 내 캐릭터 이동 (M1: 서버 권한 이동 + 브라우저 예측)
//   1/60초마다: 지금 누르고 있는 키 → 입력 하나 → 이동 물리(shared/movement.js)로 바로 움직여 보인다(예측) → 서버로 보낸다.
//   서버가 같은 입력으로 계산한 결과(`me`)를 보내 오면, 그 상태로 맞춘 뒤 서버가 아직 처리하지 않은 입력을 다시 적용한다(보정).
//   서버와 브라우저는 같은 코드·같은 입력·같은 시간 간격으로 계산하므로 보통은 결과가 같고, 다를 때(속도 핵, 순간 끊김)만 눈에 띈다.
//   화면에는 계산된 위치 사이를 부드럽게 이은 위치(rpos)를 그린다 (화면이 1/60초보다 자주 그려져도 끊겨 보이지 않게).
import * as THREE from 'three';
import { stepMovement, NO_INPUT, MAX_STEP_DT } from '/shared/movement.js';
import { colliders } from './scene.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, eff, adsInput, net } from './state.js';

const STEP = MAX_STEP_DT;
const FLAG = { jump: 1, crouch: 2, sprint: 4, leanL: 8, leanR: 16 }; // server/motion.js 와 같다
let acc = 0, seq = 0, tpWant = 0; // tpWant: 내가 보낸 순간이동 수 (서버가 그만큼 받기 전의 결과는 버린다)
const pending = []; // 서버가 아직 처리하지 않은 입력 { seq, move, yaw }
const outbox = [];  // 아직 보내지 않은 입력 (net.js 가 0.05초마다 보낸다)
export const rpos = new THREE.Vector3(); // 화면에 그릴 내 위치
const prev = new THREE.Vector3();

// 지금 누르고 있는 키 → [서버로 보낼 입력, 이동 함수에 넣을 입력]
function readInput(can) {
  const w = eff[wp.cur], ads = wp.adsT;
  if (!can) return [[0, 0, 0, me.yaw, me.pitch, wp.cur, ads], NO_INPUT];
  const k = inp.keys;
  const move = {
    fwd: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
    side: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
    jump: k.has('Space'), crouch: k.has('KeyC'),
    sprint: k.has('ShiftLeft') && !adsInput() && !inp.fireHeld && !wp.reload,
    leanL: k.has('KeyQ'), leanR: k.has('KeyE'),
    speedMul: w.move * (1 - 0.4 * ads), // 무거운 총·정조준 중에는 느리게 (서버도 같은 식)
  };
  const flags = (move.jump ? FLAG.jump : 0) | (move.crouch ? FLAG.crouch : 0) | (move.sprint ? FLAG.sprint : 0) | (move.leanL ? FLAG.leanL : 0) | (move.leanR ? FLAG.leanR : 0);
  return [[move.fwd, move.side, flags, me.yaw, me.pitch, wp.cur, ads], move];
}

// dt: 실제로 흐른 시간. 1/60초 단위로 나눠 계산한다
export function updateMovement(dt, active) {
  const can = active && me.alive && game.matchState !== 'ended';
  acc = Math.min(acc + dt, 0.25);
  const ev = { sprinting: wp.sprinting, moved: 0, landed: 0, vaultStart: false, vaultDone: false };
  while (acc >= STEP) {
    acc -= STEP;
    prev.copy(me.pos);
    const [a, move] = readInput(can);
    const e = stepMovement(me, move, colliders, STEP);
    ev.sprinting = e.sprinting; ev.moved += e.moved; ev.landed = Math.max(ev.landed, e.landed); ev.vaultStart ||= e.vaultStart; ev.vaultDone ||= e.vaultDone;
    if (game.joined) { pending.push({ seq, move, yaw: me.yaw }); outbox.push(a); seq++; }
  }
  rpos.lerpVectors(prev, me.pos, acc / STEP);
  wp.sprinting = ev.sprinting;
  if (ev.vaultStart) { wp.reload = null; sfx.step(0.8); } // 손을 짚어야 하므로 재장전은 끊긴다
  if (ev.vaultDone) sfx.land(0.45);
  if (ev.landed) sfx.land(ev.landed);
  if (ev.moved > 0.0005) { // 걸음: 화면 흔들림과 발소리
    wp.stepDist += ev.moved; wp.bobPhase += ev.moved * (wp.sprinting ? 2.6 : 3.1);
    if (wp.stepDist > (wp.sprinting ? 2.5 : me.crouch ? 1.6 : 2.0)) { wp.stepDist = 0; sfx.step(me.crouch ? 0.35 : wp.sprinting ? 1 : 0.7); }
  }
}

// 보낼 입력을 꺼낸다 (net.js). 반환: { s: 첫 번호, i: [입력…] } 또는 null
export function takeInputs() {
  if (!outbox.length) return null;
  const m = { s: seq - outbox.length, i: outbox.splice(0) };
  return m;
}

// 예측이 서버와 얼마나 어긋났는지 (디버그·테스트용): 보정 횟수, 가장 큰 어긋남(m)
export const netStats = { acks: 0, corrections: 0, maxErr: 0, lastErr: 0 };
const _before = new THREE.Vector3();

// 서버 상태로 맞추고, 서버가 아직 처리 안 한 입력을 다시 적용한다
export function reconcile(q, st, k = 0) {
  if (k < tpWant) return; // 순간이동하기 전에 서버가 계산한 결과 (곧 새 결과가 온다)
  _before.copy(me.pos);
  while (pending.length && pending[0].seq <= q) pending.shift();
  me.pos.set(st.p[0], st.p[1], st.p[2]); me.vel.set(st.v[0], st.v[1], st.v[2]);
  me.onGround = st.g; me.crouch = st.c; me.h = st.h; me.stepOff = st.so;
  me.lean = st.ln; me.leanOff = st.lo; me.vault = st.va ? { ...st.va } : null; me.vaultLock = st.vl; me.airT = st.at;
  const yaw = me.yaw;
  for (const p of pending) { me.yaw = p.yaw; stepMovement(me, p.move, colliders, STEP); }
  me.yaw = yaw;
  const err = _before.distanceTo(me.pos);
  netStats.acks++; netStats.lastErr = err; netStats.maxErr = Math.max(netStats.maxErr, err);
  if (err > 0.01) netStats.corrections++; // 1cm 넘게 어긋난 적 (눈에 띌 수 있는 보정)
}

// 새 방에 들어갈 때: 서버 쪽 기록(입력 번호·순간이동 수)이 새로 시작하므로 이쪽도 처음부터
export function resetSession() { tpWant = 0; resetPrediction(); }

// 태어나거나 순간이동했을 때: 예측 기록을 비운다
export function resetPrediction() {
  pending.length = 0; outbox.length = 0; acc = 0;
  prev.copy(me.pos); rpos.copy(me.pos);
}

// 개발·테스트용 순간이동 (서버도 같은 곳으로 옮긴다. 라이브 서버는 무시)
export function teleport(x, y, z, yaw) {
  const pre = takeInputs(); if (pre) net.send({ t: 'in', ...pre }); // 옮기기 전 입력을 먼저 보낸다
  me.pos.set(x, y, z); me.vel.set(0, 0, 0); me.vault = null; me.onGround = true;
  if (Number.isFinite(yaw)) me.yaw = yaw;
  net.send({ t: 'tp', p: [x, y, z], y: me.yaw }); tpWant++;
  resetPrediction();
}
