// 캐릭터 옷 입히기: 장착·해제·교체, 몸 가리기, 색(팔레트·팀·피부), 정리.
//   inst = charassets.makeInstance() 결과 (TPAnimator/FPAnimator 의 .inst). 애니메이션 코드는 옷을 모른다:
//   옷 메시는 그 캐릭터의 뼈에 뼈 이름으로 묶이므로 클립·IK·총 부착이 그대로 옷도 움직인다.
//
//   const h = dress(inst, choice, { view: 'tp' | 'fp' })   choice = { items: { 슬롯: id | null }, palette, skin }
//   setOutfit(h, choice)        바뀐 슬롯만 다시 입힌다 (나머지 슬롯은 그대로)
//   equip(h, slot, id | null)   슬롯 하나 교체 / 벗기 (null)
//   setTeamColor(h, hex | null) team 색 칸 (null = 팔레트 색)
//   undress(h)                  옷을 떼고 몸 가리기를 끈다 (형상은 캐시가 갖고 있어 지우지 않는다)
//
// 그리기 비용: 아이템 하나 = 메시 하나 = draw call 하나 (아이템 안의 색 칸은 정점 속성 + 색 배열 uniform 으로 한 재질).
// 캐릭터 하나의 옷은 재질 하나를 같이 쓴다 (색이 캐릭터마다 다르므로 캐릭터마다 복제, 셰이더 프로그램은 모두 공유).
import * as THREE from 'three';
import { SLOTS, COLOR_SLOTS, MATERIALS, PALETTES, SKINS, resolveOutfit, modelPath } from '/shared/cosmetics.js';
import { loadWearable } from './charassets.js';

const N_COL = 8;
const TEAM_I = COLOR_SLOTS.indexOf('team');

// ───── 몸 가리기 (몸 재질에 한 번 설치) ─────
// 몸 정점의 _region 번호의 비트가 uHide 에 켜져 있으면 그 픽셀을 버린다. 그림자도 같은 규칙 (customDepthMaterial)
function maskPatch(shader, u) {
  shader.uniforms.uHide = u;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float _region;\nuniform int uHide;\nvarying float vHide;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = float((uHide >> int(_region + 0.5)) & 1);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vHide;')
    .replace('void main() {', 'void main() {\n  if (vHide > 0.5) discard;');
}
function installMask(inst) {
  if (inst.mask) return inst.mask;
  const body = inst.meshes.find(m => m.isSkinnedMesh && m.geometry.attributes._region);
  if (!body) { inst.mask = { u: { value: 0 }, ok: false }; return inst.mask; } // 옛 몸 파일: 가리기 없음 (옷은 입힌다)
  const u = { value: 0 };
  const m = body.material;
  m.onBeforeCompile = s => maskPatch(s, u);
  m.customProgramCacheKey = () => 'regionmask';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = s => maskPatch(s, u);
  depth.customProgramCacheKey = () => 'regionmask-depth';
  body.customDepthMaterial = depth;
  m.needsUpdate = true;
  inst.mask = { u, ok: true, body, depth };
  return inst.mask;
}

// ───── 옷 재질: 색 칸 번호(_slot 정점 속성) → 색·거칠기·금속성 배열 ─────
function makeWearMaterial() {
  const u = {
    uCol: { value: Array.from({ length: N_COL }, () => new THREE.Color()) },
    uRM: { value: Array.from({ length: N_COL }, () => new THREE.Vector2(0.8, 0)) },
  };
  COLOR_SLOTS.forEach((c, i) => u.uRM.value[i].set(MATERIALS[c].rough, MATERIALS[c].metal));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, side: THREE.DoubleSide });
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _slot;\nflat varying int vSlot;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlot = int(_slot + 0.5);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nflat varying int vSlot;\nuniform vec3 uCol[${N_COL}];\nuniform vec2 uRM[${N_COL}];`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = uCol[vSlot];')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = uRM[vSlot].x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = uRM[vSlot].y;');
  };
  mat.customProgramCacheKey = () => 'wear-slots';
  mat.userData.u = u;
  return mat;
}

function applyColors(h) {
  const pal = PALETTES[h.resolved.palette];
  const cols = h.mat.userData.u.uCol.value;
  COLOR_SLOTS.forEach((c, i) => cols[i].set(pal[c]));
  if (h.team != null && TEAM_I >= 0) cols[TEAM_I].set(h.team);
  if (h.inst.mask && h.inst.mask.body) h.inst.mask.body.material.color.set(SKINS[h.resolved.skin]);
}

// ───── 아이템 하나를 이 캐릭터에 붙인다 ─────
function attach(h, slot, item, asset) {
  const out = [];
  for (const p of asset.parts) {
    let obj;
    if (p.skinned) {
      const parent = h.inst.root.getObjectByName(p.parent) || h.inst.root;
      obj = new THREE.SkinnedMesh(p.geometry, h.mat);
      const body = h.inst.mask && h.inst.mask.body;
      // 뼈 목록·순서·역바인드가 몸과 같으면 몸의 Skeleton 을 그대로 쓴다 (뼈 행렬 계산·업로드 한 번)
      let skel = body && sameSkeleton(body.skeleton, p) ? body.skeleton : null;
      if (!skel) {
        const bones = p.boneNames.map(n => h.inst.bones.get(n));
        if (bones.some(b => !b)) { console.warn(`[옷] ${item.id}: 캐릭터에 없는 뼈가 있어 입히지 않습니다`); continue; }
        skel = new THREE.Skeleton(bones, p.boneInverses);
      }
      obj.matrix.copy(p.matrix); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      parent.add(obj);
      obj.bind(skel, p.bindMatrix);
      obj.frustumCulled = false;                       // 몸과 같다: 움직인 자세가 원래 경계 밖으로 나가도 그린다
    } else {
      const bone = h.inst.bones.get(p.parent);
      if (!bone) { console.warn(`[옷] ${item.id}: 뼈 ${p.parent} 가 없어 입히지 않습니다`); continue; }
      obj = new THREE.Mesh(p.geometry, h.mat);
      obj.matrix.copy(p.matrix); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      bone.add(obj);
    }
    obj.name = `wear:${slot}:${item.id}`;
    obj.castShadow = h.view === 'tp'; obj.receiveShadow = true;
    obj.userData.wear = { slot, id: item.id };
    out.push(obj);
  }
  return out;
}
function sameSkeleton(skel, p) {
  if (skel.bones.length !== p.boneNames.length) return false;
  for (let i = 0; i < skel.bones.length; i++) {
    if (skel.bones[i].name !== p.boneNames[i]) return false;
    const a = skel.boneInverses[i].elements, b = p.boneInverses[i].elements;
    for (let k = 0; k < 16; k++) if (Math.abs(a[k] - b[k]) > 1e-4) return false;
  }
  return true;
}
function detach(objs) {
  for (const o of objs) { if (o.isSkinnedMesh) o.skeleton = null; o.removeFromParent(); }
}

// ───── 공개 함수 ─────
export function dress(inst, choice, { view = 'tp', team = null } = {}) {
  if (!inst) return null;
  installMask(inst);
  const h = { inst, view, team, choice: null, resolved: null, mat: makeWearMaterial(), worn: {}, want: {}, gen: 0, pending: 0 };
  setOutfit(h, choice);
  return h;
}

export function setOutfit(h, choice) {
  if (!h) return;
  h.choice = choice ? JSON.parse(JSON.stringify(choice)) : { items: {} };
  h.resolved = resolveOutfit(h.choice);
  applyColors(h);
  const gen = ++h.gen;
  for (const slot of SLOTS) {
    const it = h.resolved.items[slot];
    const path = it ? modelPath(it, h.view) : null;
    const key = path ? `${it.id}|${path}` : null;
    h.want[slot] = key;                                                    // 마지막 요청이 이긴다 (A→B→A 를 연달아 요청해도 B 가 늦게 붙지 않게, 아래 비교보다 먼저)
    if ((h.worn[slot] && h.worn[slot].key) === key) continue;             // 그대로인 슬롯은 건드리지 않는다
    if (!key) { if (h.worn[slot]) { detach(h.worn[slot].objs); delete h.worn[slot]; } continue; }
    h.pending++;
    loadWearable(path).then(asset => {
      h.pending--;
      if (h.gen < 0 || h.want[slot] !== key) return;                     // 그사이 다른 옷으로 바뀌었거나 벗겼다
      if (h.worn[slot]) detach(h.worn[slot].objs);
      h.worn[slot] = asset ? { key, objs: attach(h, slot, it, asset) } : { key, objs: [] };
      updateMask(h);
    });
  }
  updateMask(h);
  return gen;
}

// 실제로 붙어 있는 옷만 몸을 가린다 (불러오는 중인 옷의 자리는 몸이 보인다 → 구멍이 생기지 않음)
function updateMask(h) {
  if (!h.inst.mask || h.gen < 0) return;
  let bits = 0;
  for (const slot of SLOTS) {
    const w = h.worn[slot]; const it = h.resolved.items[slot];
    if (!w || !w.objs.length || !it || w.key !== h.want[slot]) continue;
    const m = resolveOutfit({ items: { ...Object.fromEntries(SLOTS.map(s => [s, null])), [slot]: it.id } });
    bits |= h.view === 'fp' ? m.fpMask : m.mask;
  }
  h.inst.mask.u.value = bits;
}

export function equip(h, slot, id) {
  if (!h) return;
  const items = { ...(h.choice.items || {}) };
  items[slot] = id;
  setOutfit(h, { ...h.choice, items });
}

export function setTeamColor(h, hex) {
  if (!h) return;
  h.team = hex;
  applyColors(h);
}

export function undress(h) {
  if (!h || h.gen < 0) return;
  for (const slot of Object.keys(h.worn)) detach(h.worn[slot].objs);
  h.worn = {}; h.want = {}; h.gen = -1;
  if (h.inst.mask) h.inst.mask.u.value = 0;
  h.mat.dispose();
}

// 확인·테스트용
export function outfitState(h) {
  if (!h) return null;
  return {
    view: h.view, pending: h.pending, mask: h.inst.mask ? h.inst.mask.u.value : 0, maskOk: !!(h.inst.mask && h.inst.mask.ok),
    worn: Object.fromEntries(Object.entries(h.worn).map(([s, w]) => [s, { id: w.key && w.key.split('|')[0], meshes: w.objs.length, skinned: w.objs.filter(o => o.isSkinnedMesh).length, sharedSkeleton: w.objs.some(o => o.isSkinnedMesh && h.inst.mask && h.inst.mask.body && o.skeleton === h.inst.mask.body.skeleton) }])),
  };
}
