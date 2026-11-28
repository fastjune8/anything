// 1인칭 무기(손에 든 총): 생성, 반동/흔들림/장전/꺼내기 포즈
//   라이플(charanim.js RIFLE_WEAPONS)이고 1인칭 팔 모델이 있으면: 팔 모델 + 클립(FPAnimator)이 총을 들고,
//   이 파일은 그 위에 마우스 흔들림·달릴 때 내림·꺼내기·점프 같은 코드 움직임만 얹는다.
//   그 밖의 무기(또는 팔 모델이 없을 때)는 예전처럼 총 위치를 코드로 계산한다.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { buildGun } from './guns.js';
import { onLoadoutChange, outfit, onOutfitChange, gunSkin } from './loadout.js';
import { passive } from '/shared/sim/player.js';
import { dress, setOutfit } from './outfit.js';
import { camera, vm, vmSun, world } from './scene.js';
import { flashTex } from './textures.js';
import { me, wp, inp, eff, hSpeed } from './state.js';
import { $, V3, lerp, clamp, smooth } from './util.js';
import { setDisplay } from './dom.js';
import { setGunFx } from './gunmat.js';
import { viewOf, bindSight, sightFor, defaultParts } from './weaponview.js';
import { applySkin, SKINS } from './modelrules.js';
import { poseClip, hasClip, reloadMotion } from './gunanim.js';
import { createHands } from './viewmodel/hands.js';
import { createOffhands } from './viewmodel/offhand.js';
import { applyWeaponPose } from './viewmodel/poses.js';
import { FPAnimator, RIFLE_WEAPONS, newCharState } from './charanim.js';

const scopeEl = $('scope');

// 기본 무기의 조준은 도트 사이트(weaponview.js): 총을 만들 때 기본 부품을 달고, 만들어진 총 모델이 조준경을 받을 수 있는지로 조준 방식을 정해 알려 준다

const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
// 총구 불빛(화염) 메시를 총에 달아 준다. 평소엔 숨겨 두고 playerfx.js 가 쏠 때 켠다
const newFlash = g => {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  f.position.set(0, 0.005, g.muzzleZ - 0.05); f.visible = false; g.group.add(f);
  return f;
};
export const guns = WEAPONS.map((w, i) => {
  const g = buildGun(w.id, true, defaultParts(w));
  bindSight(i, sightFor(w, g));
  g.flash = newFlash(g);
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
    const g = buildGun(w.id, false, defaultParts(w));
    g.flash = newFlash(g);
    arms.guns[i] = g;
  });
}
// 내 옷의 1인칭 모델(소매·장갑). 팔을 가리는 옷만 fp 모델이 있다
arms.outfit = arms.anim ? dress(arms.anim.inst, outfit.choice, { view: 'fp' }) : null;
onOutfitChange(c => setOutfit(arms.outfit, c));
const armsFor = i => !!(arms.anim && arms.guns[i]);
// 팔 모델(AR)을 쓰지 않는 장전 총: 캐릭터 팔이 총을 쥐고 따라간다 (viewmodel/hands.js). 상자 팔은 숨긴다
const hands = createHands(vm.parent);
const handsFor = i => !!(hands && !armsFor(i) && (hasClip(guns[i], 'reload') || hasClip(guns[i], 'reload_shell')));
// 왼손이 쉬는 자리에서 얼마나 옮겨 갔는지 (클립의 anim_hand_l, 총 그룹 좌표)
const handOff = new THREE.Vector3();
function readHand(g) {
  if (g.handTarget) handOff.subVectors(g.handTarget.position, g.handRest).multiplyScalar(g.modelScale || 1);
  else handOff.set(0, 0, 0);
}
function hideBoxArms(g) {
  if (g.armL) g.armL.visible = false;
  const r = g.group.userData.armR; if (r) r.visible = false;
}

// 한 발씩 장전이 끝난 뒤의 마무리 동작(클립 reload_end): endT = 지난 시간(초), -1 = 없음
const END_SEC = 0.55;
let endT = -1, shellRl = false, endShots = 0;
const shellHand = new V3(); // 마지막 장전 때 왼팔 자리 (마무리 동작으로 부드럽게 잇는다)

// 현재 무기만 보이게
let shownCur = -1;
export function showGun() {
  shownCur = wp.cur;
  const useArms = armsFor(wp.cur);
  endT = -1; shellRl = false;
  guns.forEach((g, i) => { g.group.visible = i === wp.cur && !useArms; if (g.mag) g.mag.position.copy(g.magRest); });
  offhands.show(wp.cur);
  if (arms.anim) { arms.anim.root.visible = useArms; if (useArms) arms.anim.setGun(arms.guns[wp.cur]); }
}
// 왼손 무기 (아킴보 권총·쿠나이): 종류별 규칙은 viewmodel/offhand.js
const offhands = createOffhands({ guns, vm, newFlash });

// 로비에서 고른 총기 스킨(loadout.js gunSkin)을 1인칭 총 모델에 입힌다. 오른손 총 · 팔이 드는 총 · 왼손 총이 모두 대상
function applyGunSkins() {
  const paint = (g, i) => { if (g) applySkin(g.group, SKINS[gunSkin.choice[WEAPONS[i].id]] || null); };
  guns.forEach(paint); arms.guns.forEach(paint); offhands.each((wi, g) => paint(g, wi));
}
// 출전 무기·스킨을 바꾸면 손에 든 무기도 바꾼다
onLoadoutChange(() => { applyGunSkins(); showGun(); });
applyGunSkins();
showGun();

const _hip = new V3(), _ads = new V3(), _q = new THREE.Quaternion(), _pose = { p: null, rx: 0, ry: 0, rz: 0 };
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
  arms.anim.root.quaternion.identity();
  // 장전 클립이 있는 총은 팔의 장전 동작 대신 총의 클립을 쓴다 (왼손은 anim_hand_l 을 따라간다)
  const own = hasClip(g, 'reload'), rf = wp.reload && !wp.reload.shell ? Math.min(1, wp.reload.t / wp.reload.total) : null;
  // 게임 상태 → 1인칭 클립
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  cs.fwd = -me.vel.x * sy - me.vel.z * cy; cs.side = me.vel.x * cy - me.vel.z * sy;
  cs.air = !me.onGround; cs.vy = me.vel.y; cs.ads = wp.adsT; cs.sprint = wp.sprintT > 0.5;
  cs.reloadF = own ? null : rf;
  cs.shots = wp.shots; cs.pitch = me.pitch; cs.rifle = true; cs.fireDamp = viewOf(wp.cur).ads.fireClip;
  arms.anim.setGun(g);
  vm.updateMatrixWorld(true);
  arms.anim.update(dt, cs, vm);
  if (own) armsReload(g, rf);
  // 총구 불빛: weapon.js 가 예전 총(guns)의 불빛을 켜고 돌린다 → 팔이 든 총에 그대로 옮긴다
  const src = guns[wp.cur].flash;
  g.flash.visible = src.visible; g.flash.rotation.z = src.rotation.z; g.flash.scale.copy(src.scale);
}

// 팔 모델 + 총의 장전 클립: 부품을 맞추고, 총 전체 동작은 팔까지 총 원점 둘레로 돌리고, 왼손을 목표로 옮긴다
const _p = new V3(), _d = new V3(), _qg = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _hm = new THREE.Matrix4(), _one = new V3(1, 1, 1);
function armsReload(g, f) {
  if (g.mag) g.mag.visible = true;
  poseClip(g, 'reload', f === null ? 0 : f, false);
  if (f === null) return;
  const root = arms.anim.root;
  vm.updateMatrixWorld(true);
  if (g.motion) {
    vm.worldToLocal(g.group.getWorldPosition(_p));
    vm.getWorldQuaternion(_q).invert(); g.group.getWorldQuaternion(_qg).premultiply(_q); // 총 방향 (vm 기준)
    _qd.copy(_qg).multiply(g.motion.q).multiply(_qg.clone().invert());
    _d.copy(root.position).sub(_p).applyQuaternion(_qd);
    root.position.copy(_p).add(_d).add(_d.copy(g.motion.p).applyQuaternion(_qg));
    root.quaternion.premultiply(_qd);
    root.updateMatrixWorld(true);
  }
  if (g.handTarget) {
    _hm.compose(g.handTarget.getWorldPosition(_p), g.group.getWorldQuaternion(_qg), _one); // 왼손 그립 = 목표 자리 + 총 방향
    arms.anim.reachLeft(_hm, smooth(0, 0.08, f) * (1 - smooth(0.92, 1, f)), vm);
  }
}

// 한 발씩 장전하는 동안 총을 들어 올려 눕혀서 장전구와 왼손이 보이게 한다 (k 0~1)
function shellPose(P, k) {
  P.p.x -= 0.06 * k; P.p.y += 0.065 * k; P.p.z -= 0.07 * k;
  P.rx += 0.28 * k; P.ry += 0.12 * k; P.rz -= 0.55 * k;
}

export function updateViewmodel(dt) {
  const w = eff[wp.cur], g = guns[wp.cur];
  // 들고 있는 무기가 바뀌면(자리 전환) 보이는 총도 바꾼다. 예전에는 팔 모델을 쓰는 무기가 끼어 있을 때만 다시 골라서,
  //   주·보조가 둘 다 팔 모델을 안 쓰는 무기(SMG + 산탄총·리볼버 등)면 보조로 바꿔도 주무기 모델이 그대로 보였다
  if (shownCur !== wp.cur) showGun();
  if (armsFor(wp.cur)) {
    if (hands) hands.hide();
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
  const P = _pose; P.p = p; P.rx = P.ry = P.rz = 0;

  const sp = Math.min(1, hSpeed() / 4.6), bob = (1 - 0.88 * k) * sp * (me.onGround ? 1 : 0);
  p.x += Math.cos(wp.bobPhase) * 0.009 * bob; p.y -= Math.abs(Math.sin(wp.bobPhase)) * 0.011 * bob;

  wp.swayX = lerp(wp.swayX, clamp(-inp.mdx * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  wp.swayY = lerp(wp.swayY, clamp(-inp.mdy * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  const sw = 1 - 0.75 * k;
  P.ry += wp.swayX * sw; P.rx += wp.swayY * sw; p.x += wp.swayX * 0.12 * sw; p.y -= wp.swayY * 0.12 * sw;

  const kk = wp.vmKick * (1 - viewOf(wp.cur).ads.vmKick * k) * Math.min(2.2, 0.6 + w.recoilV * 0.45);
  p.z += kk * 0.035; P.rx += kk * 0.045; p.y += kk * 0.004;

  applyWeaponPose(w, P, k);                 // 근접 휘두르기·볼트·펌프 (viewmodel/poses.js)
  offhands.pose(wp.cur, P, { kk, g });      // 왼손 무기 (viewmodel/offhand.js)

  // 재장전: 모델의 모션 클립("reload", 한 발씩 장전은 "reload_shell" → 끝나면 "reload_end").
  //   클립에 총 전체 동작(anim_gun)이 없으면 코드 동작(gunanim.js reloadMotion)을 더하고, 클립이 없으면 탄창만 내렸다 올린다
  const rl = wp.reload;
  if (rl) {
    const f = Math.min(1, rl.t / rl.total), name = rl.shell ? 'reload_shell' : 'reload', clip = hasClip(g, name);
    if (!clip || !g.whole) {
      const m = reloadMotion(f, rl.shell, rl.first);
      p.x += m.x; p.y += m.y; p.z += m.z; P.rx += m.rx; P.ry += m.ry; P.rz += m.rz;
      if (!clip && g.mag) g.mag.position.set(g.magRest.x, g.magRest.y - 0.3 * m.magDrop, g.magRest.z);
    }
    if (rl.shell && clip) shellPose(P, rl.first ? smooth(0, 0.3, f) : 1);
    if (clip) {
      poseClip(g, name, f); readHand(g);
      if (rl.shell) {
        if (rl.first) handOff.multiplyScalar(smooth(0, 0.3, f)); // 첫 발: 왼손이 쉬는 자리에서 옮겨 간다
        shellHand.copy(handOff);
      }
    }
    shellRl = !!rl.shell; endT = -1; endShots = wp.shots;
  } else {
    // 산탄총: 장전이 끝나면 총을 내리며 한 손 펌프. 쏘면 바로 그만둔다
    if (shellRl) { shellRl = false; if (hasClip(g, 'reload_end') && wp.shots === endShots) endT = 0; }
    if (endT >= 0) { endT += dt; if (endT >= END_SEC || wp.shots !== endShots) endT = -1; }
    if (endT >= 0) {
      shellPose(P, 1 - smooth(0, 0.35, endT / END_SEC));
      poseClip(g, 'reload_end', endT / END_SEC); readHand(g);
      handOff.lerp(shellHand, 1 - smooth(0, 0.18, endT / END_SEC));
    }
    else {
      if (!poseClip(g, 'reload', 0) && !poseClip(g, 'reload_shell', 0) && g.mag) g.mag.position.copy(g.magRest); // 쉴 때 자세
      readHand(g);
    }
  }
  offhands.reload(wp.cur, rl ? Math.min(1, rl.t / rl.total) : null); // 왼손 무기의 장전 동작

  if (wp.drawT > 0) { const d = wp.drawT / w.draw; p.y -= d * d * 0.28; P.rx -= d * d * 0.9; }
  p.x -= 0.05 * wp.sprintT; p.y -= 0.03 * wp.sprintT; P.ry += 0.55 * wp.sprintT; P.rx -= 0.22 * wp.sprintT;
  if (!me.onGround) p.y += clamp(me.vel.y * 0.004, -0.03, 0.03);

  vm.rotation.set(P.rx, P.ry, P.rz);
  const scoped = !!w.scope && wp.adsT > 0.9;
  vm.visible = me.alive && !scoped;
  setDisplay(scopeEl, scoped && me.alive);
  if (handsFor(wp.cur) && vm.visible) {
    const off = offhands.gun(wp.cur);
    hideBoxArms(g); if (off) hideBoxArms(off);
    vm.updateMatrixWorld(true); hands.update(g, off, handOff);
  } else if (hands) hands.hide();

  // 뷰모델 조명을 월드 태양 방향에 맞춤
  vmSun.position.copy(world.sunDir).applyQuaternion(_q.copy(camera.quaternion).invert());
}
