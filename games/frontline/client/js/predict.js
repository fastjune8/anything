// 내 캐릭터 예측 (서버 권한 + 브라우저 예측, 오버워치식) — 넷코드와 시뮬레이션 동기화만 한다:
//   1/60초마다 입력 → cmd → shared/sim/player.js 로 바로 계산해 반응(이동·사격·스킬·재장전)하고, cmd 를 서버로 보낸다.
//   서버가 같은 cmd 로 계산한 상태(`me`)가 오면 그 상태로 맞춘 뒤, 서버가 아직 처리하지 않은 cmd 를 다시 계산한다(보정).
//   보정으로 위치가 조금 어긋나면 화면에서는 순간이동 대신 짧게 미끄러지듯 맞춘다.
//   소리·궤적·반동·화염 같은 연출은 여기서 하지 않는다 — 사건을 onSimEvents 로 흘려보내면 playerfx.js 가 받아 그린다.
import * as THREE from 'three';
import { stepPlayer, copySim, respawnSim, encodeCmd, canSprintFire } from '/shared/sim/player.js';
import { eyeY, ROPE_MOTIONS } from '/shared/sim/movement.js';
import { BTN, DT, PF } from '/shared/sim/config.js';
import { colliders } from './scene.js';
import { clock } from './clock.js';
import { diag } from './netdiag.js';
import { resetRecoil } from './recoil.js';
import { me, wp, inp, game } from './state.js';
import { lerp } from './util.js';

let acc = 0, seq = 0, tpWant = 0;
const pending = [], outbox = [];
export const rpos = new THREE.Vector3();
const prev = new THREE.Vector3(), corr = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
export const netStats = { acks: 0, corrections: 0, maxErr: 0, lastErr: 0, sent: 0 };

function readCmd(can) {
  const k = inp.keys;
  let btn = 0;
  if (can) {
    if (k.has('Space')) btn |= BTN.jump;
    if (k.has('KeyC') || k.has('ControlLeft')) btn |= BTN.crouch;
    if (k.has('ShiftLeft')) btn |= BTN.sprint;
    if (inp.fireHeld) btn |= BTN.fire;
    if (inp.adsHeld || k.has('KeyT')) btn |= BTN.ads;
    if (inp.reloadPress) btn |= BTN.reload;
    if (inp.skillPress[0]) btn |= BTN.sk1;
    if (inp.skillPress[1]) btn |= BTN.sk2;
    if (inp.modePress) btn |= BTN.mode;
    if (inp.nodePress) btn |= BTN.node;
  }
  inp.reloadPress = false; inp.skillPress[0] = inp.skillPress[1] = false; inp.modePress = false; inp.nodePress = false;
  return {
    fwd: can ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0, side: can ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0,
    btn, yaw: me.yaw, pitch: me.pitch, slot: inp.wantSlot, vt: Math.round(clock.render() * 100) / 100,
  };
}

// dt: 실제로 흐른 시간. 1/60초 단위로 계산한다
export function updatePrediction(dt, active) {
  const can = active && me.alive && game.matchState === 'playing';
  acc = Math.min(acc + dt, 0.25);
  while (acc >= DT) {
    acc -= DT;
    prev.set(me.ps.x, me.ps.y, me.ps.z);
    const cmd = readCmd(can);
    const ev = stepPlayer(me.ps, cmd, me.lo, colliders, DT);
    if (game.joined) { pending.push({ seq, cmd }); outbox.push(encodeCmd(cmd)); seq++; }
    onSim(ev);
  }
  syncView();
  rpos.lerpVectors(prev, _a.set(me.ps.x, me.ps.y, me.ps.z), acc / DT).add(corr);
  corr.multiplyScalar(Math.exp(-dt * 14));
}
export function takeCmds() { if (!outbox.length) return null; netStats.sent += outbox.length; return { s: seq - outbox.length, c: outbox.splice(0) }; }

// 시뮬레이션 상태 → 화면용 값
function syncView() {
  const ps = me.ps, slot = ps.cur, ws = ps.w[slot], w = me.lo[slot].w;
  me.pos.set(ps.x, ps.y, ps.z); me.vel.set(ps.vx, ps.vy, ps.vz);
  me.onGround = ps.ground; me.crouch = ps.crouch; me.h = ps.h; me.stepOff = ps.stepOff; me.vault = ps.vault;
  me.stunT = ps.stun; me.slide = ps.slide;
  const dash = ps.mo && !ROPE_MOTIONS.has(ps.mo.k) ? ps.mo : null;
  me.dashT = dash ? Math.max(0, dash.dur - dash.t) : 0; me.dashV = dash ? { x: dash.vx, z: dash.vz } : me.dashV;
  wp.slot = slot; wp.cur = me.lo[slot].wi;
  wp.drawT = ps.drawT; wp.adsT = ps.adsT; wp.cooldown = ws.cd;
  wp.reload = ws.rl > 0 ? { t: ws.rlT - ws.rl, total: ws.rlT, shell: !!w.shell, first: true } : null;
  const fireHeld = inp.fireHeld && !!(ps.btn & BTN.fire);
  const lowered = (ps.sprinting && !(canSprintFire(me.lo, slot) && (fireHeld || wp.sinceShot < 0.4))) || !!ps.vault || (ps.slide > 0 && !w.slideFire);
  wp.sprinting = ps.sprinting;
  wp.sprintT = lerp(wp.sprintT, lowered ? 1 : 0, 1 - Math.exp(-DT * 9));
}

// ───── 사건 ─────
// 시뮬레이션이 낸 사건(발사·재장전·스킬·이동…)은 연출 쪽(playerfx.js)이 받아 소리·궤적·반동으로 바꾼다. 예측은 연출을 모른다.
let onSim = () => {};
export function onSimEvents(fn) { onSim = fn; }

// ───── 서버 상태로 보정 ─────
export function reconcile(m) {
  if ((m.k | 0) < tpWant) return;
  while (pending.length && pending[0].seq <= m.q) pending.shift();
  _a.set(me.ps.x, me.ps.y, me.ps.z);
  copySim(me.ps, m.ps);
  for (const p of pending) stepPlayer(me.ps, p.cmd, me.lo, colliders, DT); // 사건은 이미 연출했으므로 버린다
  me.hp = m.hp; me.alive = m.alive;
  const err = _a.distanceTo(_b.set(me.ps.x, me.ps.y, me.ps.z));
  diag.correction(err);
  netStats.acks++; netStats.lastErr = err; netStats.maxErr = Math.max(netStats.maxErr, err);
  if (err > 0.01) netStats.corrections++;
  if (err > 0.002 && err < 3) corr.add(_a.sub(_b)); // 작은 어긋남은 화면에서 부드럽게 (큰 것은 그냥 맞춘다: 넉백·순간이동)
}
export function resetPrediction() { pending.length = 0; outbox.length = 0; acc = 0; corr.set(0, 0, 0); rpos.set(me.ps.x, me.ps.y, me.ps.z); prev.copy(rpos); }
export function resetSession() { tpWant = 0; seq = 0; resetPrediction(); }
// 태어났다 (서버의 spawn)
export function placeMe(p, yaw) {
  respawnSim(me.ps, me.lo, p[0], p[1], p[2], yaw);
  me.yaw = yaw; me.pitch = 0; me.alive = true; me.deadT = 0; resetRecoil(); inp.wantSlot = 0;
  syncView(); resetPrediction();
}
export function teleport(x, y, z, yaw) {
  const pre = takeCmds(); if (pre) netSend({ t: 'cmd', ...pre });
  me.ps.x = x; me.ps.y = y; me.ps.z = z; me.ps.vx = me.ps.vy = me.ps.vz = 0; me.ps.vault = null; me.ps.mo = null;
  if (Number.isFinite(yaw)) me.yaw = yaw;
  netSend({ t: 'tp', p: [x, y, z], y: me.yaw }); tpWant++;
  resetPrediction();
}
let netSend = () => {};
export function bindSend(fn) { netSend = fn; }
export const myFlags = () => {
  const ps = me.ps, st = ps.st;
  return (st.protect > 0 ? PF.protect : 0) | (st.stealth > 0 ? PF.stealth : 0) | (st.invuln > 0 ? PF.invuln : 0) | (st.intro > 0 ? PF.intro : 0);
};
export const eye = () => eyeY(me.ps);
