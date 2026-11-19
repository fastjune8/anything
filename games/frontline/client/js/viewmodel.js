// 1인칭 무기(손에 든 총): 생성, 반동/흔들림/장전/꺼내기 포즈
//   라이플(charanim.js RIFLE_WEAPONS)이고 1인칭 팔 모델이 있으면: 팔 모델 + 클립(FPAnimator)이 총을 들고,
//   이 파일은 그 위에 마우스 흔들림·달릴 때 내림·꺼내기·점프 같은 코드 움직임만 얹는다.
//   그 밖의 무기(또는 팔 모델이 없을 때)는 예전처럼 총 위치를 코드로 계산한다.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { buildGun } from './guns.js';
import { onLoadoutChange, outfit, onOutfitChange } from './loadout.js';
import { passive } from '/shared/sim/player.js';
import { dress, setOutfit } from './outfit.js';
import { camera, vm, vmSun, world } from './scene.js';
import { flashTex } from './textures.js';
import { me, wp, inp, eff, hSpeed } from './state.js';
import { $, V3, lerp, clamp, smooth } from './util.js';
import { setDisplay } from './dom.js';
import { setGunFx } from './gunmat.js';
import { poseClip, reloadMotion } from './gunanim.js';
import { FPAnimator, RIFLE_WEAPONS, newCharState } from './charanim.js';

const scopeEl = $('scope');

const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
export const guns = WEAPONS.map((w, i) => {
  const g = buildGun(w.id, true, {});
  g.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  g.flash.position.set(0, 0.005, g.muzzleZ - 0.05);
  g.flash.visible = false;
  g.group.add(g.flash);
  g.group.visible = false;
  vm.add(g.group);
  return g;
});

// 1인칭 팔 (라이플용). arms.guns[i] = 팔이 드는 총 (팔 없이 만든 것, 총구 불빛 포함)
export const arms = { anim: FPAnimator.create(), guns: [], cs: newCharState() };
if (arms.anim) {
  vm.add(arms.anim.root);
  arms.anim.root.visible = false;
  WEAPONS.forEach((w, i) => {
    if (!RIFLE_WEAPONS.has(w.id)) return;
    const g = buildGun(w.id, false, {});
    g.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
    g.flash.position.set(0, 0.005, g.muzzleZ - 0.05); g.flash.visible = false; g.group.add(g.flash);
    arms.guns[i] = g;
  });
}
// 내 옷의 1인칭 모델(소매·장갑). 팔을 가리는 옷만 fp 모델이 있다
arms.outfit = arms.anim ? dress(arms.anim.inst, outfit.choice, { view: 'fp' }) : null;
onOutfitChange(c => setOutfit(arms.outfit, c));
const armsFor = i => !!(arms.anim && arms.guns[i]);

// 현재 무기만 보이게
export function showGun() {
  const useArms = armsFor(wp.cur);
  guns.forEach((g, i) => { g.group.visible = i === wp.cur && !useArms; if (g.mag) g.mag.position.copy(g.magRest); });
  if (leftGun) leftGun.group.visible = wp.cur === AKIMBO;
  if (arms.anim) { arms.anim.root.visible = useArms; if (useArms) arms.anim.setGun(arms.guns[wp.cur]); }
}
// 아킴보: 왼손에 드는 두 번째 권총 (오른손 총을 좌우로 뒤집은 복제)
const AKIMBO = WEAPONS.findIndex(w => w.kind === 'akimbo');
export const leftGun = AKIMBO >= 0 ? buildGun(WEAPONS[AKIMBO].id, false, {}) : null;
if (leftGun) {
  leftGun.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat); leftGun.flash.position.set(0, 0.005, leftGun.muzzleZ - 0.05); leftGun.flash.visible = false; leftGun.group.add(leftGun.flash);
  leftGun.group.visible = false; vm.add(leftGun.group);
}
// 출전 무기를 바꾸면 손에 든 무기도 바꾼다
onLoadoutChange(() => showGun());
showGun();

const _hip = new V3(), _ads = new V3(), _q = new THREE.Quaternion();
// 총 재질 효과: 과열 → 총열(metal 칸)이 달아오름, 차지 샷 충전·아드레날린·밀어내기 준비 → core 가 밝아짐
let fxT = 0;
function updateGunFx(dt, g) {
  fxT += dt;
  const ps = me.ps, slot = ps.cur, ws = ps.w[slot];
  const oh = passive(me.lo, slot, 'overheat'), ch = passive(me.lo, slot, 'charge') || passive(me.lo, slot, 'quickdraw');
  const pulse = 0.65 + 0.35 * Math.sin(fxT * 6);
  const charge = ps.st.adren > 0 || ps.st.shove > 0 || ps.st.bs > 0 ? pulse : ch && ws.idle >= ch.wait ? 0.5 + 0.2 * Math.sin(fxT * 3) : 0;
  setGunFx(g, { heat: oh ? ws.heat : 0, charge });
}

// 팔 모델로 그릴 때: 클립이 맡는 것(허리↔정조준 자세, 걸음 흔들림, 반동, 재장전)은 빼고 코드 움직임만 vm 그룹에 준다
function updateArms(dt, w) {
  const g = arms.guns[wp.cur], cs = arms.cs;
  updateGunFx(dt, g);
  const k = smooth(0, 1, wp.adsT);
  const p = vm.position.set(0, 0, 0);
  let rx = 0, ry = 0;
  wp.swayX = lerp(wp.swayX, clamp(-inp.mdx * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  wp.swayY = lerp(wp.swayY, clamp(-inp.mdy * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  const sw = 1 - 0.75 * k;
  ry += wp.swayX * sw; rx += wp.swayY * sw; p.x += wp.swayX * 0.12 * sw; p.y -= wp.swayY * 0.12 * sw;
  if (wp.drawT > 0) { const d = wp.drawT / w.draw; p.y -= d * d * 0.28; rx -= d * d * 0.9; }
  p.x -= 0.05 * wp.sprintT; p.y -= 0.03 * wp.sprintT; ry += 0.55 * wp.sprintT; rx -= 0.22 * wp.sprintT;
  if (!me.onGround) p.y += clamp(me.vel.y * 0.004, -0.03, 0.03);
  vm.rotation.set(rx, ry, 0);
  // 게임 상태 → 1인칭 클립
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  cs.fwd = -me.vel.x * sy - me.vel.z * cy; cs.side = me.vel.x * cy - me.vel.z * sy;
  cs.air = !me.onGround; cs.vy = me.vel.y; cs.ads = wp.adsT; cs.sprint = wp.sprintT > 0.5;
  cs.reloadF = wp.reload && !wp.reload.shell ? Math.min(1, wp.reload.t / wp.reload.total) : null;
  cs.shots = wp.shots; cs.pitch = me.pitch; cs.rifle = true;
  arms.anim.setGun(g);
  vm.updateMatrixWorld(true);
  arms.anim.update(dt, cs, vm);
  // 총구 불빛: weapon.js 가 예전 총(guns)의 불빛을 켜고 돌린다 → 팔이 든 총에 그대로 옮긴다
  const src = guns[wp.cur].flash;
  g.flash.visible = src.visible; g.flash.rotation.z = src.rotation.z; g.flash.scale.copy(src.scale);
}

export function updateViewmodel(dt) {
  const w = eff[wp.cur], g = guns[wp.cur];
  if (armsFor(wp.cur)) {
    if (!arms.anim.root.visible || g.group.visible) showGun();
    updateArms(dt, w);
    vm.visible = me.alive;
    setDisplay(scopeEl, false);
    vmSun.position.copy(world.sunDir).applyQuaternion(_q.copy(camera.quaternion).invert());
    return;
  }
  if (arms.anim && arms.anim.root.visible) showGun();
  updateGunFx(dt, g);
  const k = smooth(0, 1, wp.adsT);
  _hip.fromArray(g.hip); _ads.set(0, -g.sightY, g.adsZ);
  const p = vm.position.copy(_hip).lerp(_ads, k);
  let rx = 0, ry = 0, rz = 0;

  const sp = Math.min(1, hSpeed() / 4.6), bob = (1 - 0.88 * k) * sp * (me.onGround ? 1 : 0);
  p.x += Math.cos(wp.bobPhase) * 0.009 * bob; p.y -= Math.abs(Math.sin(wp.bobPhase)) * 0.011 * bob;

  wp.swayX = lerp(wp.swayX, clamp(-inp.mdx * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  wp.swayY = lerp(wp.swayY, clamp(-inp.mdy * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  const sw = 1 - 0.75 * k;
  ry += wp.swayX * sw; rx += wp.swayY * sw; p.x += wp.swayX * 0.12 * sw; p.y -= wp.swayY * 0.12 * sw;

  const kk = wp.vmKick * (1 - 0.45 * k) * Math.min(2.2, 0.6 + w.recoilV * 0.45);
  p.z += kk * 0.035; rx += kk * 0.045; p.y += kk * 0.004;

  // 근접 무기: 휘두르기 (오른쪽 위에서 왼쪽 아래로)
  if (w.kind === 'melee' && wp.swing > 0) {
    const a = Math.sin(Math.PI * (1 - wp.swing));
    p.x -= a * 0.16; p.y += a * 0.05; p.z -= a * 0.12; ry += a * 0.9; rz -= a * 0.7; rx -= a * 0.3;
  }
  // 아킴보: 쏜 손이 튄다
  if (leftGun && wp.cur === AKIMBO) {
    const lk = wp.side === 1 ? kk : 0;
    if (wp.side === 1) { p.z -= kk * 0.035; rx -= kk * 0.045; }
    leftGun.group.position.set(-2 * Math.max(p.x, 0.12), 0, lk * 0.035);
    leftGun.group.rotation.set(lk * 0.05, -2 * ry, -2 * rz);
    leftGun.flash.visible = wp.flashT > 0 && wp.side === 1;
    if (wp.side === 1) guns[wp.cur].flash.visible = false;
  }
  // 볼트 / 펌프 동작
  if ((w.bolt || w.shell) && wp.cooldown > 0 && !wp.reload) {
    const c = 1 - wp.cooldown / (60 / w.rpm);
    const a = Math.sin(Math.PI * smooth(0.25, 0.85, c));
    rz += a * 0.22 * (1 - 0.6 * k); p.y -= a * 0.02 * (1 - 0.6 * k); rx -= a * 0.05;
  }

  // 재장전: 총 전체의 움직임(공용 gunanim.js) + 모델의 "reload" 모션 클립 (없으면 탄창만 내렸다 올린다)
  if (wp.reload) {
    const f = wp.reload.t / wp.reload.total, m = reloadMotion(f, wp.reload.shell, wp.reload.first);
    p.x += m.x; p.y += m.y; p.z += m.z; rx += m.rx; ry += m.ry; rz += m.rz;
    if (wp.reload.shell || !poseClip(g, 'reload', f)) { if (g.mag) g.mag.position.set(g.magRest.x, g.magRest.y - 0.3 * m.magDrop, g.magRest.z); }
  } else if (!poseClip(g, 'reload', 0) && g.mag) g.mag.position.copy(g.magRest); // 쉴 때 자세 (탄창·노리쇠·왼팔 제자리)

  if (wp.drawT > 0) { const d = wp.drawT / w.draw; p.y -= d * d * 0.28; rx -= d * d * 0.9; }
  p.x -= 0.05 * wp.sprintT; p.y -= 0.03 * wp.sprintT; ry += 0.55 * wp.sprintT; rx -= 0.22 * wp.sprintT;
  if (!me.onGround) p.y += clamp(me.vel.y * 0.004, -0.03, 0.03);

  vm.rotation.set(rx, ry, rz);
  const scoped = !!w.scope && wp.adsT > 0.9;
  vm.visible = me.alive && !scoped;
  setDisplay(scopeEl, scoped && me.alive);

  // 뷰모델 조명을 월드 태양 방향에 맞춤
  vmSun.position.copy(world.sunDir).applyQuaternion(_q.copy(camera.quaternion).invert());
}
