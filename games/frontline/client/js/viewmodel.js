// 1인칭 무기(손에 든 총): 생성, 반동/흔들림/장전/꺼내기 포즈
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { buildGun } from './guns.js';
import { camera, vm, vmSun, world } from './scene.js';
import { flashTex } from './textures.js';
import { me, wp, inp, hSpeed } from './state.js';
import { $, V3, lerp, clamp, smooth } from './util.js';
import { setDisplay } from './dom.js';

const scopeEl = $('scope');

const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
export const guns = WEAPONS.map(w => {
  const g = buildGun(w.id, true);
  g.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  g.flash.position.set(0, 0.005, g.muzzleZ - 0.05);
  g.flash.visible = false;
  g.group.add(g.flash);
  g.group.visible = false;
  vm.add(g.group);
  return g;
});

// 현재 무기만 보이게
export function showGun() { guns.forEach((g, i) => { g.group.visible = i === wp.cur; if (g.mag) g.mag.position.copy(g.magRest); }); }
showGun();

const _hip = new V3(), _ads = new V3(), _q = new THREE.Quaternion();
export function updateViewmodel(dt) {
  const w = WEAPONS[wp.cur], g = guns[wp.cur];
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

  // 볼트 / 펌프 동작
  if ((w.bolt || w.shell) && wp.cooldown > 0 && !wp.reload) {
    const c = 1 - wp.cooldown / (60 / w.rpm);
    const a = Math.sin(Math.PI * smooth(0.25, 0.85, c));
    rz += a * 0.22 * (1 - 0.6 * k); p.y -= a * 0.02 * (1 - 0.6 * k); rx -= a * 0.05;
  }

  if (wp.reload) {
    let down, magDrop = 0;
    if (wp.reload.shell) {
      const f = wp.reload.t / wp.reload.total;
      down = wp.reload.first ? smooth(0, 0.8, f) : 1;
      p.z += Math.sin(Math.PI * f) * 0.015 * (wp.reload.first ? 0 : 1);
    } else {
      const f = wp.reload.t / wp.reload.total;
      down = smooth(0, 0.14, f) * (1 - smooth(0.86, 1, f));
      magDrop = smooth(0.15, 0.28, f) * (1 - smooth(0.5, 0.62, f));
      rz += Math.sin(f * Math.PI * 3) * 0.05 * down;
    }
    p.y -= 0.075 * down; p.x -= 0.03 * down; rz += 0.42 * down; rx += 0.32 * down; ry += 0.15 * down;
    if (g.mag) g.mag.position.set(g.magRest.x, g.magRest.y - 0.3 * magDrop, g.magRest.z);
  } else if (g.mag) g.mag.position.copy(g.magRest);

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
