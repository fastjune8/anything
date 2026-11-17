// 이펙트: 총알 궤적, 탄흔, 파편/피, 총구 불빛 (풀링해서 매번 새로 만들지 않는다)
import * as THREE from 'three';
import { normalOf } from '/shared/collision.js';
import { scene, colliders } from './scene.js';
import { stepGrenade } from '/shared/skills.js';
import { playFx } from './vfx.js';
import { softTex } from './textures.js';
import { V3 } from './util.js';

export const muzzleLight = new THREE.PointLight(0xffb060, 0, 16, 2);
scene.add(muzzleLight);

// ───── 총알 궤적 ─────
const tracers = [];
const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(tracerGeo, tracerMat); m.visible = false; m.frustumCulled = false; scene.add(m);
  tracers.push({ m, a: new V3(), d: new V3(), len: 0, head: 0, on: false });
}
let tracerI = 0;
export function addTracer(a, b) {
  const t = tracers[tracerI = (tracerI + 1) % tracers.length];
  t.a.copy(a); t.d.copy(b).sub(a); t.len = t.d.length();
  if (t.len < 1.5) return;
  t.d.divideScalar(t.len); t.head = Math.min(3, t.len); t.on = true;
}
const _tp = new V3();
export function updateTracers(dt) {
  for (const t of tracers) {
    if (!t.on) continue;
    const TL = 9;
    const tail = Math.max(0, t.head - TL), head = Math.min(t.len, t.head);
    if (tail >= t.len) { t.on = false; t.m.visible = false; continue; }
    const seg = Math.max(0.05, head - tail);
    t.m.visible = true;
    t.m.position.copy(t.a).addScaledVector(t.d, tail + seg / 2);
    t.m.lookAt(_tp.copy(t.m.position).add(t.d));
    t.m.scale.set(0.022, 0.022, seg);
    t.head += 420 * dt;
  }
}

// ───── 탄흔 ─────
const decals = [];
const decalGeo = new THREE.CircleGeometry(0.045, 8);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
for (let i = 0; i < 120; i++) { const m = new THREE.Mesh(decalGeo, decalMat); m.visible = false; scene.add(m); decals.push(m); }
let decalI = 0;

// ───── 파편/연기/피 ─────
const parts = [];
for (let i = 0; i < 160; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, transparent: true, depthWrite: false }));
  s.visible = false; scene.add(s);
  parts.push({ s, v: new V3(), life: 0, max: 1, size: 0.1, grow: 0, grav: 0, op: 1 });
}
let partI = 0;
function puff(pos, vel, color, size, grow, life, grav, op) {
  const p = parts[partI = (partI + 1) % parts.length];
  p.s.position.copy(pos); p.v.copy(vel); p.s.material.color.setHex(color);
  p.size = size; p.grow = grow; p.life = p.max = life; p.grav = grav; p.op = op; p.s.visible = true;
}
export function updateParts(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    p.v.y -= p.grav * dt; p.v.multiplyScalar(1 - 2.2 * dt);
    p.s.position.addScaledVector(p.v, dt);
    const k = 1 - p.life / p.max;
    p.s.scale.setScalar(p.size + p.grow * k);
    p.s.material.opacity = p.op * (1 - k);
  }
}

// 총알이 닿은 곳: n = 면 방향 번호(탄흔+먼지), 6 = 사람(피), 음수 = 아무것도 안 함
const _n = new V3(), _v = new V3();
export function impact(point, n) {
  if (n === 6) { // 피격
    for (let i = 0; i < 6; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(2.2);
      puff(point, _v, 0x6a0808, 0.05, 0.22, 0.35, 5, 0.85);
    }
    return;
  }
  if (n < 0) return;
  _n.fromArray(normalOf(n));
  const d = decals[decalI = (decalI + 1) % decals.length];
  d.position.copy(point).addScaledVector(_n, 0.012);
  d.lookAt(_v.copy(d.position).add(_n));
  d.scale.setScalar(0.7 + Math.random() * 0.7);
  d.visible = true;
  const ground = n === 2 && point.y < 0.02;
  for (let i = 0; i < 5; i++) {
    _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6).addScaledVector(_n, 1.6 + Math.random() * 1.5);
    puff(point, _v, ground ? 0x8a7c62 : 0xa39e94, 0.07, 0.5 + Math.random() * 0.4, 0.5 + Math.random() * 0.35, 1.5, 0.55);
  }
}

// ───── 유탄 (스킬) ─────
// 서버가 알려 준 시작점·속도로 같은 계산(shared/skills.js)을 해서 그린다. 터지는 순간은 서버의 boom 이 정한다
const grenades = new Map();
const glGeo = new THREE.SphereGeometry(0.07, 10, 8), glMat = new THREE.MeshStandardMaterial({ color: 0x2b2f2a, roughness: 0.6, metalness: 0.4 });
export function spawnGrenade(id, o, v) {
  const m = new THREE.Mesh(glGeo, glMat); m.position.fromArray(o); scene.add(m);
  grenades.set(id, { m, g: { p: { x: o[0], y: o[1], z: o[2] }, v: { x: v[0], y: v[1], z: v[2] }, t: 0 } });
}
const boomLight = new THREE.PointLight(0xffa040, 0, 30, 2); scene.add(boomLight);
export function explode(id, p, r = 4) {
  const gr = grenades.get(id);
  if (gr) { scene.remove(gr.m); grenades.delete(id); }
  const at = new V3().fromArray(p);
  if (playFx('grenade_explode', at, { scale: r / 5 })) return; // 효과 에디터에서 만든 폭발 (없으면 아래 예전 효과)
  _v.set(0, 0, 0);
  puff(at, _v, 0xffc070, 0.4, r * 1.3, 0.22, 0, 1); // 섬광
  for (let i = 0; i < 18; i++) {
    _v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * r);
    puff(at, _v, i < 6 ? 0xff9a3a : 0x4a4640, 0.3, 1.2 + Math.random() * r * 0.4, 0.6 + Math.random() * 0.8, i < 6 ? 0 : -0.6, i < 6 ? 0.9 : 0.6);
  }
  boomLight.position.copy(at); boomLight.intensity = 400;
}
export function updateGrenades(dt) {
  for (const [id, gr] of grenades) {
    if (!gr.g.done) stepGrenade(gr.g, dt, colliders);
    gr.m.position.set(gr.g.p.x, gr.g.p.y, gr.g.p.z);
    if (gr.g.t > 6) { scene.remove(gr.m); grenades.delete(id); } // 서버 소식이 끊겼을 때 정리
  }
  boomLight.intensity *= Math.exp(-dt * 10);
}
export function clearGrenades() { for (const gr of grenades.values()) scene.remove(gr.m); grenades.clear(); }
