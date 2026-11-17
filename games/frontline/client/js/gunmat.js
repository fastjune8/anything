// 총 재질: 색 칸(재질 이름) 별 질감을 엔진이 입힌다 (content/gunmaterials.json). Blender 작업 없이 모든 총에 적용된다.
//   층 (레이어)
//   1) 재질 값  — 금속성·거칠기·반사·광택 코팅(도장면). Blender 의 값은 덮어쓴다 → 모든 총이 같은 기준
//   2) 미세 질감 — 금속의 브러시 결, 폴리머의 오돌토돌함 (텍스처 없이 셰이더의 잡음으로, 모델 좌표 기준이라 UV 필요 없음)
//   3) 모서리 닳음 — 각진 모서리(면이 꺾이는 곳)의 칠이 벗겨져 밝은 금속이 보인다. 모델 모양에서 자동으로 찾는다
//   4) 정점 색 AO — Blender 에서 구워 넣었으면 그대로 곱해진다
//   색(스킨)은 그대로 → 어떤 스킨이든 이 질감이 유지된다
//   총마다 재질을 복제해 갖는다 → 효과(과열로 달아오름, 충전으로 빛남)가 그 총에만 걸린다. setGunFx(gun, { heat, charge })
import * as THREE from 'three';
import data from '/content/gunmaterials.json' with { type: 'json' };
import { slotOf } from './modelrules.js';

let MATS = data;
export const gunMats = () => MATS;
// 코드로 만든 총의 재질 이름 → 색 칸 (guns.js 의 M)
const CODE_SLOT = { steel: 'metal', polymer: 'dark', wood: 'body2', olive: 'body', tube: 'dark' };
export const slotFor = m => { const s = slotOf(m.userData.slot || m.name); return MATS.slots[s] ? s : CODE_SLOT[s] || null; };
// 층을 켜고 끄기 (스튜디오 비교용). 게임은 모두 켜져 있다
export const LAYERS = { grain: true, wear: true, coat: true };

// ───── 모서리 찾기: 면이 꺾이는 모서리(또는 열린 테두리)를 삼각형마다 표시한다 ─────
// 삼각형마다 각 꼭짓점의 맞은편 변까지 거리(높이)와 그 변이 날카로운지를 정점 속성으로 넣는다 → 셰이더가 모서리까지 거리를 안다
const prepared = new WeakMap();
function prepEdges(geo) {
  if (prepared.has(geo)) return prepared.get(geo);
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position, n = pos.count / 3;
  const key = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const tri = i => [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, i * 3 + k));
  const normals = [], edges = new Map();
  for (let t = 0; t < n; t++) {
    const [a, b, c] = tri(t);
    normals.push(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize());
    for (let k = 0; k < 3; k++) { // 꼭짓점 k 의 맞은편 변 = (k+1, k+2)
      const ka = key(t * 3 + (k + 1) % 3), kb = key(t * 3 + (k + 2) % 3), ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(ek)) edges.set(ek, []);
      edges.get(ek).push([t, k]);
    }
  }
  const sharp = new Float32Array(n * 9), height = new Float32Array(n * 9), bary = new Float32Array(n * 9);
  const COS = Math.cos(THREE.MathUtils.degToRad(35));
  for (const list of edges.values()) {
    for (const [t, k] of list) {
      const others = list.filter(([u]) => u !== t);
      const isSharp = !others.length || others.some(([u]) => normals[t].dot(normals[u]) < COS); // 열린 테두리이거나 35° 넘게 꺾임
      for (let v = 0; v < 3; v++) sharp[(t * 3 + v) * 3 + k] = isSharp ? 1 : 0;
    }
  }
  for (let t = 0; t < n; t++) {
    const p = tri(t);
    const area2 = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).length();
    for (let k = 0; k < 3; k++) {
      const len = p[(k + 1) % 3].distanceTo(p[(k + 2) % 3]) || 1e-6, h = area2 / len; // 꼭짓점 k 에서 맞은편 변까지 높이
      for (let v = 0; v < 3; v++) { height[(t * 3 + v) * 3 + k] = h; bary[(t * 3 + v) * 3 + k] = v === k ? 1 : 0; }
    }
  }
  g.setAttribute('aSharp', new THREE.BufferAttribute(sharp, 3));
  g.setAttribute('aEdgeH', new THREE.BufferAttribute(height, 3));
  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  prepared.set(geo, g); prepared.set(g, g);
  return g;
}

// ───── 셰이더: 미세 질감 · 모서리 닳음 ─────
const NOISE = /* glsl */`
  float gmHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float gmNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gmHash(i), gmHash(i + vec3(1,0,0)), f.x), mix(gmHash(i + vec3(0,1,0)), gmHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(gmHash(i + vec3(0,0,1)), gmHash(i + vec3(1,0,1)), f.x), mix(gmHash(i + vec3(0,1,1)), gmHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;
function inject(m) {
  const u = m.userData.gm = {
    uGrain: { value: 0 }, uBrushed: { value: 0 }, uWear: { value: 0 }, uWearW: { value: 0.0025 }, uWearColor: { value: new THREE.Color() },
  };
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSharp; attribute vec3 aEdgeH; attribute vec3 aBary;\nvarying vec3 vGmPos; varying vec3 vGmEdge; varying vec3 vGmSharp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGmPos = position; vGmEdge = aBary * aEdgeH; vGmSharp = aSharp;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGrain; uniform float uBrushed; uniform float uWear; uniform float uWearW; uniform vec3 uWearColor;\nvarying vec3 vGmPos; varying vec3 vGmEdge; varying vec3 vGmSharp;\n${NOISE}\nfloat gmWear;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 모서리 닳음: 날카로운 변까지 거리 → 가까울수록 칠이 벗겨진다 (잡음으로 들쭉날쭉하게)
        vec3 gmD = vGmEdge + (1.0 - vGmSharp) * 1e3;
        float gmE = 1.0 - smoothstep(0.0, uWearW, min(gmD.x, min(gmD.y, gmD.z)));
        float gmN = gmNoise(vGmPos * 380.0);
        gmWear = uWear * smoothstep(0.35, 0.75, gmE * 0.85 + gmN * 0.45 * gmE + (gmN - 0.5) * 0.25);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, gmWear);
        // 미세 질감: 색을 아주 조금 흔든다
        float gmG = uBrushed > 0.5 ? gmNoise(vec3(vGmPos.x * 1400.0, vGmPos.y * 1400.0, vGmPos.z * 30.0)) : gmNoise(vGmPos * 700.0);
        diffuseColor.rgb *= 1.0 + (gmG - 0.5) * uGrain * 0.35;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (gmG - 0.5) * uGrain * 1.2), 0.04, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.32, gmWear);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, gmWear);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // 미세 질감의 결: 법선을 아주 조금 흔들어 빛이 결을 따라 반짝이게
        normal = normalize(normal + (vec3(gmG, fract(gmG * 7.13 + gmN), fract(gmG * 3.77 + 0.5)) - 0.5) * uGrain * 0.22); // 이미 구한 잡음을 다시 써서 가볍게`);
  };
  m.customProgramCacheKey = () => 'frontier-gunmat-2';
}

// 일반 재질 → 질감용 재질 (광택 코팅을 쓰려고 MeshPhysicalMaterial 로)
function toGunMaterial(src) {
  const m = new THREE.MeshPhysicalMaterial({
    name: src.name, color: src.color, vertexColors: src.vertexColors, flatShading: src.flatShading, side: src.side,
    transparent: src.transparent, opacity: src.opacity,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0), emissiveIntensity: src.emissiveIntensity ?? 1,
  });
  m.userData = { ...src.userData };
  inject(m);
  return m;
}

// 한 재질에 색 칸 값을 입힌다
function applyTo(m, slot) {
  const v = MATS.slots[slot];
  if (!v || !m.isMeshStandardMaterial) return;
  m.metalness = v.metal; m.roughness = v.rough; m.envMapIntensity = v.env;
  if (m.isMeshPhysicalMaterial) { m.clearcoat = LAYERS.coat ? v.coat || 0 : 0; m.clearcoatRoughness = 0.25; }
  const u = m.userData.gm;
  if (u) {
    u.uGrain.value = LAYERS.grain ? v.grain || 0 : 0; u.uBrushed.value = v.brushed ? 1 : 0;
    u.uWear.value = LAYERS.wear ? v.wear || 0 : 0; u.uWearW.value = MATS.wearWidth ?? 0.0025; u.uWearColor.value.set(MATS.wearColor || '#b9bcc0');
  }
  if (slot === 'core') {
    m.userData.glow = v.glow ?? 1.6;
    if (m.emissive && m.emissive.getHex() === 0) m.emissive.copy(m.color); // core 는 스스로 빛난다 (Blender 에서 발광을 안 켰어도)
    m.emissiveIntensity = m.userData.glow;
  }
}

// 공유 재질 하나에 재질 값만 입힌다 (코드로 만든 총의 파츠가 같이 쓰는 재질)
export function dressMaterial(m) { const slot = slotFor(m); if (slot) { m.userData.slot = slot; applyTo(m, slot); } }

// 가벼운 버전: 재질 값만 (공유 재질에 그대로). 다른 플레이어가 든 작은 총처럼 질감이 안 보이는 곳 — 셰이더·복제 없음
export function dressGunLite(gun) {
  const done = new Set();
  gun.group.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (!done.has(m)) { done.add(m); dressMaterial(m); } });
  return gun;
}

// 총 객체(guns.js 의 wrapGun 결과)의 재질을 복제해 질감을 입힌다. 팔(소매·장갑)은 건드리지 않는다
export function dressGun(gun) {
  const copies = new Map(), fx = { metal: [], core: [] };
  gun.group.traverse(o => {
    if (!o.isMesh || o.userData.socket) return;
    const src = [].concat(o.material);
    if (!src.some(m => slotFor(m))) return;
    const mats = src.map(m => {
      const slot = slotFor(m);
      if (!slot) return m;
      if (!copies.has(m)) {
        const c = toGunMaterial(m); c.userData.slot = slot; c.userData.baseEmissive = m.emissive ? m.emissive.getHex() : 0;
        applyTo(c, slot); copies.set(m, c);
        if (fx[slot]) fx[slot].push(c);
      }
      return copies.get(m);
    });
    o.userData.origMaterial = o.userData.origMaterial || o.material; // 비교용: Blender 에서 나온 그대로의 재질
    o.material = Array.isArray(o.material) ? mats : mats[0];
    o.userData.gunMaterial = o.material;
    if (!Array.isArray(o.material)) o.geometry = prepEdges(o.geometry); // 모서리 닳음용 정점 속성 (같은 모양은 한 번만)
  });
  gun.mats = [...copies.values()]; gun.fxMats = fx; gun.fx = { heat: 0, charge: 0 };
  return gun;
}

// 비교용: 엔진 질감을 끄고 Blender 에서 나온 재질로 (on = false)
export function useGunMaterials(gun, on) {
  gun.group.traverse(o => { if (o.isMesh && o.userData.gunMaterial) o.material = on ? o.userData.gunMaterial : o.userData.origMaterial; });
}

// 스튜디오에서 값이나 층을 바꿨을 때: 이미 만든 총에도 다시 입힌다
export function setGunMats(next, guns = []) {
  if (next) MATS = next;
  for (const g of guns) if (g && g.mats) { for (const m of g.mats) applyTo(m, m.userData.slot); setGunFx(g, g.fx); }
}

const _heat = new THREE.Color(), _base = new THREE.Color();
// 효과 값 (매 프레임 불러도 된다). heat = 과열로 총열(metal)이 달아오름, charge = core 가 밝아짐
export function setGunFx(gun, fx = {}) {
  if (!gun || !gun.fxMats) return;
  const heat = Math.max(0, Math.min(1, fx.heat || 0)), charge = Math.max(0, Math.min(1, fx.charge || 0));
  gun.fx = { heat, charge };
  _heat.set(MATS.heatColor);
  for (const m of gun.fxMats.metal) {
    const k = heat * heat; // 열이 높을 때 급하게 달아오른다
    m.emissive.setHex(m.userData.baseEmissive || 0).lerp(_heat, Math.min(1, k)); m.emissiveIntensity = k * MATS.heatGlow;
  }
  for (const m of gun.fxMats.core) {
    _base.setHex(m.userData.baseEmissive || 0); if (_base.getHex() === 0) _base.copy(m.color);
    m.emissive.copy(_base); m.emissiveIntensity = (m.userData.glow ?? 1.6) + charge * MATS.chargeGlow;
  }
}
