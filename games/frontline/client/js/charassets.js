// 캐릭터 모델 (3인칭 전신 · 1인칭 팔). 처음 한 번 불러와 두고, 사람마다 복제해서 쓴다.
//   파일: content/characters/<id>.glb (모델링/character 에서 Blender 로 만든 것, docs/CHARACTER_MODELING.md)
//   클립 이름은 파일 안의 실제 이름을 읽어 확인한다. 없는 클립은 null → 컨트롤러가 그 동작만 건너뛴다.
//   불러오지 못하면 tpAsset/fpAsset 이 null → 다른 플레이어는 예전 상자 병사, 1인칭은 예전 총 포즈를 쓴다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLOR_SLOTS } from '/shared/cosmetics.js';

export const CHAR_FILES = { tp: 'hyperfps_thirdperson_v_8', fp: 'hyperfps_viewmodel_v_7' }; // v_8/v_7: 아래팔 꼬임 뼈 (손목 비틀림을 아래팔에 나눔). v_7/v_6: // v_7/v_6: 정점마다 몸 영역(_region, 옷 가리기용)

// 게임 상태 → 클립 이름 (실제 파일에 있는 이름. 모델링/character/animation_spec.md)
export const TP_CLIPS = {
  idle: 'TP_Idle',
  walk: { f: 'TP_Walk', b: 'TP_Walk_Back', l: 'TP_Walk_Left', r: 'TP_Walk_Right' },
  run: { f: 'TP_Run', b: 'TP_Run_Back', l: 'TP_Run_Left', r: 'TP_Run_Right' },
  jump: 'TP_Jump', fall: 'TP_Fall', land: 'TP_Landing',
  rifle: { idle: 'TP_Rifle_Idle', aim: 'TP_Rifle_Aim', fire: 'TP_Rifle_Fire', reload: 'TP_Rifle_Reload', walk: 'TP_Rifle_Walk' },
};
export const FP_CLIPS = { rifle: { idle: 'FP_Rifle_Idle', aim: 'FP_Rifle_Aim', fire: 'FP_Rifle_Fire', reload: 'FP_Rifle_Reload', walk: 'FP_Rifle_Walk' } };
// 이동 클립의 기준 속도 (m/s): 딛은 발이 이 속도로 뒤로 간다 → 재생 빠르기 = 실제 속도 / 기준 속도
export const REF_SPEED = { walk: 1.6, run: 4.6 };

// 하체 = 이동 클립이 맡는 뼈. 나머지(상체)는 이동 클립 또는 무기 클립이 맡는다 (같은 뼈를 두 층이 동시에 쓰지 않는다)
export const LOWER = new Set(['Root', 'Hips', 'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe']);
const NO_ROOT_MOTION = new Set(['Root', 'ViewmodelRoot']); // 제자리 이동: 이 뼈의 키는 쓰지 않는다

const boneOf = track => track.name.split('.')[0];
function subClip(clip, keep, name = clip.name) {
  return new THREE.AnimationClip(name, clip.duration, clip.tracks.filter(t => keep(boneOf(t))));
}

const loader = new GLTFLoader();
async function load(id) {
  try {
    const gltf = await loader.loadAsync(`/content/characters/${id}.glb`);
    const clips = new Map(gltf.animations.map(c => [c.name, subClip(c, b => !NO_ROOT_MOTION.has(b))]));
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); // 움직인 자세가 원래 경계 밖으로 나가도 사라지지 않게
    return { id, scene: gltf.scene, clips };
  } catch (e) { console.warn(`캐릭터 모델을 불러오지 못했습니다: ${id}`, e); return null; }
}

// 이름 목록에서 실제로 있는 클립만 (없는 것은 경고 한 번)
function pick(asset, names, out = {}) {
  for (const [k, v] of Object.entries(names)) {
    if (typeof v === 'object') { out[k] = pick(asset, v); continue; }
    out[k] = asset.clips.get(v) || null;
    if (!out[k]) console.warn(`[캐릭터] ${asset.id}: 클립 ${v} 이 없어 그 동작은 건너뜁니다`);
  }
  return out;
}

function prepareTP(asset) {
  if (!asset) return null;
  const c = pick(asset, TP_CLIPS);
  // 이동·공중 클립은 하체/상체로 나눈다. 라이플 클립은 원래 상체만 (하체 트랙이 있으면 버린다)
  const split = clip => clip && { lower: subClip(clip, b => LOWER.has(b), clip.name + '#lower'), upper: subClip(clip, b => !LOWER.has(b), clip.name + '#upper') };
  const loco = { idle: split(c.idle), jump: split(c.jump), fall: split(c.fall), land: split(c.land), walk: {}, run: {} };
  for (const g of ['walk', 'run']) for (const d of ['f', 'b', 'l', 'r']) loco[g][d] = split(c[g][d]);
  const rifle = {};
  for (const [k, clip] of Object.entries(c.rifle)) rifle[k] = clip && subClip(clip, b => !LOWER.has(b));
  if (rifle.fire) rifle.fireAdd = THREE.AnimationUtils.makeClipAdditive(rifle.fire.clone(), 0); // 반동 = 0프레임과의 차이 → 어떤 자세 위에도 더한다
  return { ...asset, loco, rifle };
}
function prepareFP(asset) {
  if (!asset) return null;
  const rifle = pick(asset, FP_CLIPS).rifle;
  if (rifle.fire) rifle.fireAdd = THREE.AnimationUtils.makeClipAdditive(rifle.fire.clone(), 0);
  return { ...asset, rifle };
}

const [tpRaw, fpRaw] = await Promise.all([load(CHAR_FILES.tp), load(CHAR_FILES.fp)]);
export const tpAsset = prepareTP(tpRaw);
export const fpAsset = prepareFP(fpRaw);

// 복제 하나: { root, bones(이름 → 뼈), meshes, mats(복제한 재질 — 팀 색을 따로 칠할 수 있게) }
export function makeInstance(asset) {
  if (!asset) return null;
  const root = cloneSkinned(asset.scene);
  const bones = new Map(), meshes = [], mats = [];
  root.traverse(o => {
    if (o.isBone) { bones.set(o.name, o); o.userData.rest = o.quaternion.clone(); } // 쉬는 회전 (팔 IK 가 손목 꺾임을 잰다)
    if (o.isMesh) { o.material = o.material.clone(); meshes.push(o); mats.push(o.material); }
  });
  return { root, bones, meshes, mats };
}

// 확인·테스트용: 불러온 클립 이름
export function clipNames() {
  return { tp: tpRaw ? [...tpRaw.clips.keys()] : [], fp: fpRaw ? [...fpRaw.clips.keys()] : [] };
}

// ───── 옷 모델 (content/wearables/*.glb, docs/CHARACTER_CUSTOMIZATION.md) ─────
// 경로마다 한 번만 받는다 (모든 캐릭터가 같은 형상을 쓴다). 반환: { path, parts: [...] } 또는 null(못 받음 → 그 옷만 빠진다)
//   part = { geometry, skinned, parent(붙일 노드/뼈 이름), matrix(그 노드 기준 위치), boneNames, boneInverses, bindMatrix }
//   한 아이템 안의 여러 재질(색 칸)은 메시 하나로 합치고, 색 칸 번호를 정점 속성 _slot 에 넣는다 → 아이템 하나 = draw call 하나
const wearCache = new Map();
export function loadWearable(path) {
  if (!wearCache.has(path)) wearCache.set(path, loader.loadAsync(`/content/${path}`).then(g => prepareWearable(path, g)).catch(e => { console.warn(`옷 모델을 불러오지 못했습니다: ${path}`, e); return null; }));
  return wearCache.get(path);
}
export const wearableCacheSize = () => wearCache.size;
// 스튜디오(의상 화면): 아직 content/ 에 없는 옷 .glb 를 메모리에서 바로 입혀 보기 위한 등록. path 는 가짜 이름 (예: tmp/x.glb) 이고 loadWearable 이 캐시에서 찾는다
export function registerWearableBuffer(path, buffer) {
  const p = loader.parseAsync(buffer, '').then(g => prepareWearable(path, g)).catch(e => { console.warn(`옷 모델을 읽을 수 없습니다: ${path}`, e); return null; });
  wearCache.set(path, p);
  return p;
}
export const forgetWearable = path => { wearCache.delete(path); };

function slotIndex(mat) {
  const name = (mat && mat.name || '').replace(/\.\d+$/, '');
  const i = COLOR_SLOTS.indexOf(name);
  if (i < 0) console.warn(`[옷] 재질 이름 ${name} 은 색 칸이 아닙니다 (fabric 으로 그립니다)`);
  return Math.max(0, i);
}
function prepareWearable(path, gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  // 같은 노드에서 나온 메시(= Blender 물체 하나, 재질별로 나뉜 primitive)를 묶는다
  const groups = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const node = o.parent && o.parent.isGroup && !o.parent.isBone && o.parent.children.every(c => c.isMesh) ? o.parent : o;
    if (!groups.has(node)) groups.set(node, []);
    groups.get(node).push(o);
  });
  const parts = [];
  for (const [node, meshes] of groups) {
    const geos = meshes.map(m => {
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
      const n = g.attributes.position.count;
      g.setAttribute('_slot', new THREE.BufferAttribute(new Float32Array(n).fill(slotIndex(m.material)), 1));
      if (!g.index) g.setIndex([...Array(n).keys()]);
      return g;
    });
    const geometry = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    geometry.computeBoundingSphere();
    const first = meshes[0];
    if (first.isSkinnedMesh) {
      // 노드 위치 = 아마추어 노드 기준 (게임 캐릭터의 같은 이름 노드 밑에 같은 상대 위치로 붙인다)
      const arm = findArmature(node);
      const rel = new THREE.Matrix4().copy(arm.matrixWorld).invert().multiply(first.matrixWorld);
      parts.push({ geometry, skinned: true, parent: arm.name, matrix: rel, boneNames: first.skeleton.bones.map(b => b.name), boneInverses: first.skeleton.boneInverses.map(m => m.clone()), bindMatrix: first.bindMatrix.clone() });
    } else {
      const bone = findBone(node);
      if (!bone) { console.warn(`[옷] ${path}: 뼈에 붙지 않은 물체는 쓰지 않습니다 (${node.name})`); continue; }
      const rel = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(first.matrixWorld);
      parts.push({ geometry, skinned: false, parent: bone.name, matrix: rel });
    }
  }
  return { path, parts };
}
function findArmature(o) { let p = o.parent; while (p && p.parent && !p.children.some(c => c.isBone)) p = p.parent; return p || o.parent; }
function findBone(o) { let p = o.parent; while (p && !p.isBone) p = p.parent; return p; }
