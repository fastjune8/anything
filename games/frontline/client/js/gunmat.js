// 총 재질: 색 칸(재질 이름) 별 금속성·거칠기·반사·발광을 엔진이 입힌다 (content/gunmaterials.json).
//   - Blender 에서 넣은 금속성·거칠기 값은 덮어쓴다 → 모든 총이 같은 기준. 색(스킨)과 정점 색 AO 는 그대로
//   - 총마다 재질을 복제해 갖는다 → 효과(과열로 달아오름, 충전으로 빛남)가 그 총에만 걸린다
//   - 효과: setGunFx(gun, { heat 0~1, charge 0~1 }). 앞으로의 시각 효과(스킬 연출 등)도 여기에 값을 더해 간다
import * as THREE from 'three';
import data from '/content/gunmaterials.json' with { type: 'json' };
import { slotOf } from './gunmodel.js';

let MATS = data;
export const gunMats = () => MATS;
// 코드로 만든 총의 재질 이름 → 색 칸 (guns.js 의 M)
const CODE_SLOT = { steel: 'metal', polymer: 'dark', wood: 'body2', olive: 'body', tube: 'dark' };
export const slotFor = m => { const s = slotOf(m.userData.slot || m.name); return MATS.slots[s] ? s : CODE_SLOT[s] || null; };

// 한 재질에 색 칸 값을 입힌다
function applyTo(m, slot) {
  const v = MATS.slots[slot];
  if (!v || !m.isMeshStandardMaterial) return;
  m.metalness = v.metal; m.roughness = v.rough; m.envMapIntensity = v.env;
  if (slot === 'core') {
    m.userData.glow = v.glow ?? 1.6;
    if (m.emissive && m.emissive.getHex() === 0) m.emissive.copy(m.color); // core 는 스스로 빛난다 (Blender 에서 발광을 안 켰어도)
    m.emissiveIntensity = m.userData.glow;
  }
}

// 공유 재질 하나에 그대로 입힌다 (코드로 만든 총·파츠가 같이 쓰는 재질)
export function dressMaterial(m) { const slot = slotFor(m); if (slot) { m.userData.slot = slot; applyTo(m, slot); } }

// 총 객체(guns.js 의 wrapGun 결과)의 재질을 복제해 색 칸 값을 입힌다. 팔(소매·장갑)은 건드리지 않는다
export function dressGun(gun) {
  const copies = new Map(), fx = { metal: [], core: [] };
  gun.group.traverse(o => {
    if (!o.isMesh || o.userData.socket) return;
    const mats = [].concat(o.material).map(m => {
      const slot = slotFor(m);
      if (!slot) return m;
      if (!copies.has(m)) {
        const c = m.clone(); c.userData = { ...m.userData, slot, baseEmissive: m.emissive ? m.emissive.getHex() : 0 };
        applyTo(c, slot); copies.set(m, c);
        if (fx[slot]) fx[slot].push(c);
      }
      return copies.get(m);
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
  gun.mats = [...copies.values()]; gun.fxMats = fx; gun.fx = { heat: 0, charge: 0 };
  return gun;
}

// 스튜디오에서 값을 고쳤을 때: 새 값을 이미 만든 총에도 다시 입힌다
export function setGunMats(next, guns = []) {
  MATS = next;
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
