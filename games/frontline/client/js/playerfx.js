// 내 시뮬레이션 사건의 연출: 걸음·착지·재장전·스킬·사격 → 소리, 궤적, 탄흔, 총구 불빛, 총 모델 반동, 맞힌 표시.
//   predict.js(예측·넷코드)는 이 모듈을 모른다 — 사건만 onSimEvents 로 흘려보내고, 여기서 받아 그린다. 피해는 서버가 판정한다.
//   시선·화면 흔들림 수치는 recoil.js, 조준 방식별 배율은 weaponview.js.
import * as THREE from 'three';
import { castRay, castMelee } from '/shared/sim/hitscan.js';
import { KIND_NAME } from '/shared/sim/thread.js';
import { colliders, camera } from './scene.js';
import { sfx } from './sfx.js';
import { impact, addTracer, muzzleLight } from './fx.js';
import { playFx } from './vfx.js';
import { startDashFx } from './dashfx.js';
import { showHit, flashSkill } from './hud.js';
import { liveTargets } from './remotes.js';
import { guns } from './viewmodel.js';
import { onSimEvents } from './predict.js';
import { noteShot, applyRecoil, updateRecoil } from './recoil.js';
import { viewOf } from './weaponview.js';
import { me, wp } from './state.js';
import { lerp } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _mz = new THREE.Vector3();

const RELOAD_EV = [[0.15, 'magout'], [0.62, 'magin'], [0.88, 'bolt']];
let reloadEv = 0;
// 시뮬레이션 사건 → 소리·궤적·반동·화면 표시 (predict.js 의 onSimEvents 로 받는다)
function onEvents(ev) {
  const mv = ev.move;
  if (mv) {
    if (mv.vaultStart) sfx.step(0.8);
    if (mv.vaultDone) sfx.land(0.45);
    if (mv.landed) sfx.land(mv.landed);
    if (mv.slideStart) { sfx.whoosh(0); sfx.step(0.9); if (mv.slideBoost > 1) startDashFx(); }
    if (mv.jumped) sfx.step(0.5);
    if (mv.slideJump) sfx.whoosh(0);
    if (mv.ledgePop) { sfx.whoosh(0); sfx.step(0.7); } // 줄 끝에서 턱 넘기
    if (mv.ledgeDone) sfx.land(0.35);
    if (mv.moved > 0.0005) {
      wp.stepDist += mv.moved; wp.bobPhase += mv.moved * (wp.sprinting ? 2.6 : 3.1);
      if (wp.stepDist > (wp.sprinting ? 2.4 : me.crouch ? 1.6 : 2.0)) { wp.stepDist = 0; if (me.slide <= 0) sfx.step(me.crouch ? 0.3 : wp.sprinting ? 1 : 0.7); }
    }
  }
  if (ev.swap) { sfx.mech('draw'); reloadEv = 0; }
  if (ev.reload) reloadEv = 0;
  if (ev.dry) sfx.mech('dry');
  if (ev.shell) sfx.mech('shell');
  const ws = me.ps.w[me.ps.cur];
  if (ws.rl > 0 && !me.lo[me.ps.cur].w.shell) {
    const f = 1 - ws.rl / ws.rlT;
    while (reloadEv < RELOAD_EV.length && f >= RELOAD_EV[reloadEv][0]) sfx.mech(RELOAD_EV[reloadEv++][1]);
  }
  if (ev.skills) for (const s of ev.skills) onSkill(s.effect);
  if (ev.grappleMiss) flashSkill('닿는 곳이 없다');
  // 쿠나이 (shared/sim/kunai.js 의 사건)
  if (ev.kuThrow) for (const h of ev.kuThrow) { sfx.whoosh(h ? 0.3 : -0.3); wp.kThrow[h] = 1; }
  if (ev.kuAnchor) for (const h of ev.kuAnchor) { const k = me.ps.ku[h]; _b.set(k.x, k.y, k.z); impact(_b, k.n); sfx.mech('magin', 0.45); }
  if (ev.kuRecall) sfx.whoosh(0);
  if (ev.kuReady) sfx.mech('draw', 0.35);
  if (ev.kmode !== undefined) { flashSkill(ev.kmode ? '설치 모드 — 와이어' : '기동 모드 — 끌려가기'); sfx.mech('dry', 0.6); }
  if (ev.kunaiFail) flashSkill(ev.kunaiFail);
  if (ev.wire) { sfx.mech('bolt', 1); flashSkill(KIND_NAME[ev.threadKind] ? `${KIND_NAME[ev.threadKind]} 설치` : '와이어 설치'); }
  if (ev.pin) { sfx.mech('magin', 0.6); for (const s of ev.pin) { const p = me.ps.pins[s]; _b.set(p.x, p.y, p.z); impact(_b, p.n); } }
  if (ev.areaEnd) flashSkill('영역이 풀렸다');
  for (const shot of ev.shots) onShot(shot);
}
function onSkill(effect) {
  if (effect === 'dash' || effect === 'roll' || effect === 'slash' || effect === 'backstep') { sfx.whoosh(0); startDashFx(); }
  else if (effect === 'adrenaline') { sfx.whoosh(0); playFx('skill_adrenaline', me.pos); }
  else if (effect === 'grapple') sfx.mech('bolt', 1);
  else if (effect === 'grenade') { sfx.mech('pump', 1, 0, 0.3); wp.vmKick = 1.4; }
  else if (effect === 'kunai') { if (me.ps.mo && me.ps.mo.k === 'kpull') { sfx.whoosh(0); startDashFx(); } }
  else sfx.whoosh(0);
}
function muzzleWorld(out) { const k = wp.adsT; return out.set(lerp(0.13, 0, k) * (wp.side ? -1 : 1), lerp(-0.11, -0.04, k), -0.75).applyQuaternion(camera.quaternion).add(camera.position); }

function onShot(shot) {
  const w = me.lo[shot.slot].w, targets = liveTargets();
  noteShot(); wp.shots++; wp.side = w.kind === 'akimbo' ? shot.n % 2 : 0;
  if (shot.melee) {
    wp.swing = 1; sfx.whoosh(0);
    const h = castMelee(shot.o, me.ps.yaw, me.ps.pitch, shot.range, colliders, targets);
    if (h) { impact(_b.set(h.end.x, h.end.y, h.end.z), 6); showHit(false); sfx.impact(1, 0); }
    return;
  }
  muzzleWorld(_mz);
  let hit = false, head = false;
  for (const d of shot.dirs) {
    const r = castRay(shot.o, d, shot.range, colliders, targets, shot.pierce);
    _b.set(r.end.x, r.end.y, r.end.z);
    impact(_b, r.hits.length ? 6 : r.n);
    addTracer(_mz, _b);
    if (r.hits.length) { hit = true; if (r.hits.some(h => h.part === 'head')) head = true; }
  }
  if (hit) showHit(head);
  applyRecoil(w); // 시선·화면 반동 (recoil.js)
  wp.vmKick = shot.charged ? 1.6 : 1; wp.flashT = 0.045;
  const ads = viewOf(wp.cur).ads, g = guns[wp.cur]; // 조준 방식별 화염 배율 (weaponview.js)
  if (g) { g.flash.rotation.z = Math.random() * Math.PI; g.flash.scale.setScalar((w.pellets > 1 || w.scope ? 1.5 : 1) * (0.8 + Math.random() * 0.5) * (1 - ads.flash * wp.adsT) * (shot.charged ? 1.6 : 1)); }
  muzzleLight.position.copy(_mz); muzzleLight.intensity = 60 * (1 - ads.light * wp.adsT);
  sfx.shot(w);
  if (shot.charged) { sfx.mech('bolt', 1); playFx('charge_shot', _mz, { dir: camera.getWorldDirection(_a) }); }
  if (w.bolt) sfx.mech('bolt', 1, 0, 0.5);
  if (w.shell) sfx.mech('pump', 1, 0, 0.28);
}

// 매 프레임: 반동·흔들림·총구 불빛이 풀린다
export function updatePlayerFx(dt) {
  updateRecoil(dt);
  wp.vmKick *= Math.exp(-dt * 16); wp.swing = Math.max(0, wp.swing - dt * 3.2);
  wp.flashT -= dt;
  const g = guns[wp.cur];
  if (g) g.flash.visible = wp.flashT > 0;
  muzzleLight.intensity *= Math.exp(-dt * 40);
  if (muzzleLight.intensity < 0.05) muzzleLight.intensity = 0;
}

onSimEvents(onEvents);
