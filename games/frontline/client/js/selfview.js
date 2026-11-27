// 내 화면: 카메라(1인칭·3인칭·로비 배경)와 3인칭에서 보이는 내 몸.
//   main.js 의 프레임 루프는 이 모듈의 함수를 순서대로 부르기만 한다 — 시야각·눈높이·흔들림·3인칭 카메라 계산은 여기서만.
//   조준 방식별 화면 흔들림 배율은 weaponview.js, 반동 수치는 recoil.js.
import * as THREE from 'three';
import { BODY } from '/shared/sim/config.js';
import { ROPE_MOTIONS } from '/shared/sim/movement.js';
import { WEAPONS } from '/shared/weapons.js';
import { scene, camera, vm } from './scene.js';
import { rpos } from './predict.js';
import { dashView } from './dashfx.js';
import { buildGun } from './guns.js';
import { TPAnimator, holdsGun, newCharState } from './charanim.js';
import { dress, setOutfit } from './outfit.js';
import { outfit, onOutfitChange } from './loadout.js';
import { viewOf } from './weaponview.js';
import { me, wp, inp, game, eff, PITCH_MAX } from './state.js';
import { params, BASE_FOV, lerp, clamp, smooth } from './util.js';

// ───── 3인칭 시점 (기획 11.2: 1인칭·3인칭 지원) ─────
// V 키: 어깨 너머 3인칭 카메라. 1인칭과 같은 게임 상태로 같은 캐릭터·무기를 그린다 (조준·사격 판정은 늘 눈 기준)
export const localTP = { anim: TPAnimator.create(), guns: [], cs: newCharState(), view: params.has('tpcam') };
const tpCam = new THREE.PerspectiveCamera(70, 1, 0.05, 1500); tpCam.rotation.order = 'YXZ';
if (localTP.anim) {
  localTP.anim.root.visible = false; scene.add(localTP.anim.root);
  localTP.guns = WEAPONS.map(w => {
    const g = buildGun(w.id, false, {}, false); g.group.visible = false;
    if (w.kind === 'akimbo') { g.twin = buildGun(w.id, false, {}, false); g.twin.group.visible = false; }
    return g;
  });
  localTP.outfit = dress(localTP.anim.inst, outfit.choice, { view: 'tp' });
  onOutfitChange(c => setOutfit(localTP.outfit, c));
}
addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && localTP.anim && game.joined && !inp.chatOpen) localTP.view = !localTP.view; });

let shellEnd = null;
// 3인칭에서 보이는 내 몸의 애니메이션 (1인칭일 때도 상태는 계속 갱신해 둔다)
export function updateBody(dt) {
  const L = localTP, cs = L.cs;
  if (!L.anim) return;
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  cs.fwd = -me.vel.x * sy - me.vel.z * cy; cs.side = me.vel.x * cy - me.vel.z * sy;
  cs.air = !me.onGround; cs.vy = me.vel.y; cs.ads = wp.adsT; cs.sprint = wp.sprinting;
  cs.rifle = holdsGun(WEAPONS[wp.cur]);
  cs.reloadF = wp.reload ? Math.min(1, wp.reload.t / wp.reload.total) : null; cs.shell = !!(wp.reload && wp.reload.shell);
  // 한 발씩 장전이 끝나면 마무리 동작 (쏘거나 무기를 바꾸면 그만)
  if (cs.shell) shellEnd = { wi: wp.cur, shots: wp.shots, t: 0 };
  else if (shellEnd) { shellEnd.t += dt; if (shellEnd.t >= 0.55 || shellEnd.wi !== wp.cur || shellEnd.shots !== wp.shots) shellEnd = null; }
  cs.endF = shellEnd && !cs.shell ? shellEnd.t / 0.55 : null;
  cs.shots = wp.shots; cs.pitch = me.pitch; cs.alive = me.alive;
  const root = L.anim.root;
  root.position.copy(rpos); root.rotation.set(me.slide > 0 ? -0.7 : 0, me.yaw, 0);
  root.scale.set(1, me.crouch && me.slide <= 0 ? 0.74 : 1, 1);
  L.anim.setGun(L.guns[wp.cur]);
  L.anim.update(dt, cs);
}

// 속도감: 달리기보다 빠를수록 시야가 넓어진다 (슬라이딩·슬라이딩 점프·반동 이동)
let fovBoost = 0;
function speedFov(dt) {
  const rope = me.ps.mo && ROPE_MOTIONS.has(me.ps.mo.k); // 줄 이동(그래플·쿠나이)은 위아래로 빠른 것도 속도감에 넣는다
  const v = rope ? Math.hypot(me.vel.x, me.vel.y, me.vel.z) : Math.hypot(me.vel.x, me.vel.z), want = Math.min(rope ? 11 : 9, Math.max(0, v - 7) * (rope ? 0.6 : 1.4)) + (me.slide > 0 ? 2 : 0);
  fovBoost += (want - fovBoost) * (1 - Math.exp(-dt * 6));
  return fovBoost;
}

// 1인칭 카메라: 시야각(조준·달리기·속도감) · 눈 위치(앉기·죽음·기절) · 방향(시선 + 시각 반동)
export function updateCamera(dt) {
  const w = eff[wp.cur];
  const fov = lerp(BASE_FOV, w.adsFov, smooth(0, 1, wp.adsT)) + wp.sprintT * 4 + dashView.fov + speedFov(dt);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  let eye = me.h - BODY.EYE, roll = dashView.roll;
  if (!me.alive) { me.deadT = Math.min(1, me.deadT + dt * 2.2); const e = smooth(0, 1, me.deadT); eye = lerp(eye, 0.3, e); roll = e * 0.6; }
  if (me.stunT > 0) { eye -= 0.35 * Math.min(1, me.stunT / 0.15); roll += 0.3 * Math.min(1, me.stunT / 0.15); }
  if (me.slide > 0) roll += 0.03;
  camera.position.set(rpos.x, rpos.y + eye + me.stepOff, rpos.z);
  const kd = 1 - viewOf(wp.cur).ads.cameraKick * smooth(0, 1, wp.adsT); // 시각 반동 배율 (조준 방식별, weaponview.js)
  camera.rotation.set(clamp(me.pitch + wp.kickP * kd, -PITCH_MAX, PITCH_MAX), me.yaw + wp.kickY * kd, roll);
  camera.updateMatrixWorld();
}

// 3인칭이면 어깨 너머 카메라를 계산해 돌려준다 (아니면 null → 1인칭 카메라로 그린다)
export function thirdPersonCamera() {
  if (!localTP.view || !localTP.anim) return null;
  // 어깨 너머: 뒤 2.8m · 오른쪽 0.55m, 벽에 막히면 당긴다
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw), cp = Math.cos(me.pitch), sp = Math.sin(me.pitch);
  const back = new THREE.Vector3(sy * cp, -sp, cy * cp), side = new THREE.Vector3(cy, 0, -sy);
  const pivot = new THREE.Vector3(rpos.x, rpos.y + me.h - 0.1, rpos.z).addScaledVector(side, 0.55);
  tpCam.position.copy(pivot).addScaledVector(back, 2.8);
  tpCam.rotation.set(me.pitch, me.yaw, 0); tpCam.aspect = camera.aspect; tpCam.fov = camera.fov; tpCam.updateProjectionMatrix();
  return tpCam;
}
export const isThirdPerson = cam => cam === tpCam;

// 로비 배경: 맵 위를 천천히 도는 카메라
let menuAngle = 0;
export function updateMenuCamera(dt) {
  menuAngle += dt * 0.05;
  camera.position.set(Math.sin(menuAngle) * 48, 16, Math.cos(menuAngle) * 48);
  camera.lookAt(0, 2, 0);
  vm.visible = false;
}
