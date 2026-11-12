// 이펙트: 총알 궤적, 탄흔, 파편/피, 총구 불빛 (풀링해서 매번 새로 만들지 않는다)
import * as THREE from 'three';
import { normalOf } from '/shared/collision.js';
import { scene } from './scene.js';
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
