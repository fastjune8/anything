// 캐릭터 모델 규칙 (리깅된 .glb): 뼈 이름·부착 지점·웨이트·크기·클립 이름을 검사한다.
//   기준: docs/CHARACTER_MODELING.md (모델링/character/rigging_specification.md 의 요약)
//   종류: 3인칭 전신(tp, 뼈대 HyperFPS_Skeleton) · 1인칭 팔(fp, 뼈대 Viewmodel_Skeleton) — 뼈 이름으로 알아낸다
import * as THREE from 'three';

const SIDES = ['Left', 'Right'];
const ARM = ['Shoulder', 'UpperArm', 'ForeArm', 'Hand'];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const sided = parts => SIDES.flatMap(s => parts.map(p => s + p));
const fingers = () => SIDES.flatMap(s => FINGERS.flatMap(f => [1, 2, 3].map(n => `${s}${f}${n}`)));

export const RIGS = {
  tp: {
    label: '3인칭 전신',
    bones: ['Root', 'Hips', 'Spine', 'Spine1', 'Chest', 'Neck', 'Head', ...sided(ARM), ...sided(['UpperLeg', 'LowerLeg', 'Foot', 'Toe'])],
    fingers: fingers(),
    sockets: { RightHandGrip: '오른손 무기 그립 (무기를 붙이는 곳)', LeftHandGrip: '왼손바닥 받침점', WeaponRoot: '무기 자체의 움직임', LeftHandIK: '애니메이션이 기록한 왼손 위치', BackWeaponSocket: '등에 멘 주무기', HipWeaponSocket: '허리 권총집' },
    grip: { right: 'RightHandGrip', left: 'LeftHandGrip' },
    tris: { good: 20000, max: 40000 }, clipPrefix: 'TP_',
  },
  fp: {
    label: '1인칭 팔 (뷰모델)',
    bones: ['ViewmodelRoot', 'ViewmodelChest', ...sided(ARM)],
    fingers: fingers(),
    sockets: { ViewmodelRightGrip: '오른손 무기 그립', ViewmodelLeftGrip: '왼손바닥 받침점', ViewmodelWeaponRoot: '무기 자체의 움직임', ViewmodelLeftHandIK: '애니메이션이 기록한 왼손 위치' },
    grip: { right: 'ViewmodelRightGrip', left: 'ViewmodelLeftGrip' },
    tris: { good: 12000, max: 20000 }, clipPrefix: 'FP_',
  },
};
export const WEAPON_CLASSES = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'melee'];

// 뼈 이름으로 종류를 알아낸다 (없으면 null)
export function detectRig(root) {
  const names = new Set(); root.traverse(o => names.add(o.name));
  if (names.has('ViewmodelRoot') || names.has('ViewmodelChest')) return 'fp';
  if (names.has('Hips')) return 'tp';
  return null;
}
export const isCharacter = root => { let s = false; root.traverse(o => { if (o.isSkinnedMesh) s = true; }); return s; };

// 뼈 목록 (이름 → 뼈)
export function bonesOf(root) { const m = new Map(); root.traverse(o => { if (o.isBone) m.set(o.name, o); }); return m; }

// 웨이트 검사: 한 정점에 뼈 4개까지, 합이 1, 웨이트 없는 정점
function weightInfo(meshes) {
  let unweighted = 0, unnormal = 0, verts = 0;
  for (const m of meshes) {
    const w = m.geometry.attributes.skinWeight;
    if (!w) continue;
    for (let i = 0; i < w.count; i++) {
      const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
      verts++;
      if (s < 1e-4) unweighted++;
      else if (Math.abs(s - 1) > 0.01) unnormal++;
    }
  }
  return { unweighted, unnormal, verts };
}

// 규칙 검사. 반환: [{ level, text }] (총 규칙과 같은 모양)
export function checkCharacter(root, { bytes = 0, clips = [] } = {}) {
  const out = [], ok = t => out.push({ level: 'ok', text: t }), warn = t => out.push({ level: 'warn', text: t }), fail = t => out.push({ level: 'fail', text: t });
  const kind = detectRig(root), rig = RIGS[kind];
  const skinned = []; root.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) { fail('스킨 메시(뼈대에 붙은 메시)가 없습니다'); return out; }
  if (!rig) { fail('뼈 이름이 규칙과 다릅니다 — Hips(3인칭) 또는 ViewmodelRoot(1인칭)가 있어야 합니다 (docs/CHARACTER_MODELING.md)'); return out; }
  ok(`종류: ${rig.label} (뼈 ${bonesOf(root).size}개)`);
  root.updateMatrixWorld(true);
  const bones = bonesOf(root);
  const missing = rig.bones.filter(n => !bones.has(n));
  if (missing.length) fail(`필수 뼈가 없습니다: ${missing.join(', ')}`); else ok(`몸 뼈 ${rig.bones.length}개가 규칙 이름대로 있습니다`);
  const noFinger = rig.fingers.filter(n => !bones.has(n));
  if (noFinger.length) warn(`손가락 뼈 ${noFinger.length}개가 없습니다 — 손가락 포즈를 쓸 수 없습니다 (${noFinger.slice(0, 4).join(', ')}…)`);
  const noSock = Object.keys(rig.sockets).filter(n => !bones.has(n) && !root.getObjectByName(n));
  if (noSock.length) fail(`부착 지점이 없습니다: ${noSock.join(', ')} — 무기를 붙일 수 없습니다`); else ok(`부착 지점 ${Object.keys(rig.sockets).length}개 (무기 그립·왼손·무기 움직임 …)`);

  // 웨이트
  const w = weightInfo(skinned);
  if (w.unweighted) fail(`웨이트가 없는 정점 ${w.unweighted}개 — 움직이면 제자리에 남습니다`);
  if (w.unnormal) warn(`웨이트 합이 1 이 아닌 정점 ${w.unnormal}개 (Blender: Weights → Normalize All)`);
  if (!w.unweighted && !w.unnormal) ok(`웨이트 정상 (정점 ${w.verts.toLocaleString()}개, 한 정점에 뼈 4개까지)`);

  // 크기·방향 (레스트 = T-포즈)
  const box = new THREE.Box3(); for (const m of skinned) box.expandByObject(m);
  const size = box.getSize(new THREE.Vector3());
  if (kind === 'tp') {
    if (size.y > 3) fail(`키가 ${size.y.toFixed(2)}m — 단위가 cm 로 내보내졌을 수 있습니다`);
    else if (size.y < 1.4 || size.y > 2.2) warn(`키가 ${size.y.toFixed(2)}m — 게임 병사(약 1.8m)와 다릅니다`);
    else ok(`키 ${size.y.toFixed(2)}m (팔 너비 ${size.x.toFixed(2)}m — T-포즈)`);
    if (Math.abs(box.min.y) > 0.05) warn(`발바닥이 바닥(y = 0)에서 ${box.min.y.toFixed(2)}m 떨어져 있습니다 — 원점은 두 발 사이 바닥`);
    const head = bones.get('Head'), toeL = bones.get('LeftToe');
    if (toeL && head && toeL.getWorldPosition(new THREE.Vector3()).z < head.getWorldPosition(new THREE.Vector3()).z - 0.02) warn('발끝이 뒤(−Z)를 향합니다 — 정면은 +Z (Blender 에서 정면 −Y)');
  } else {
    const chest = bones.get('ViewmodelChest');
    if (chest && chest.getWorldPosition(new THREE.Vector3()).z > 0.2) warn('가슴이 카메라 뒤에 있지 않습니다 — 1인칭은 원점 = 눈, 정면 −Z');
    ok(`크기 ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}m (카메라 공간)`);
  }
  let scaled = false;
  root.traverse(o => { if (o.isBone && (Math.abs(o.scale.x - 1) > 1e-3 || Math.abs(o.scale.y - 1) > 1e-3 || Math.abs(o.scale.z - 1) > 1e-3)) scaled = true; });
  if (scaled) warn('크기가 1 이 아닌 뼈가 있습니다 (Blender: 아마추어에 Ctrl+A → 모두 적용)');

  // 삼각형·재질·용량
  let tris = 0;
  for (const m of skinned) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  if (tris > rig.tris.max) fail(`삼각형 ${Math.round(tris).toLocaleString()}개 — 최대 ${rig.tris.max.toLocaleString()}개`);
  else if (tris > rig.tris.good) warn(`삼각형 ${Math.round(tris).toLocaleString()}개 — 권장 ${rig.tris.good.toLocaleString()}개 이하`);
  else ok(`삼각형 ${Math.round(tris).toLocaleString()}개`);
  if (bytes > 4 * 1024 * 1024) fail(`파일 ${(bytes / 1024 / 1024).toFixed(1)}MB — 최대 4MB`);
  else if (bytes) ok(`파일 ${(bytes / 1024).toFixed(0)}KB`);

  // 클립
  if (!clips.length) ok(`애니메이션 클립 없음 — 따로 내보낸 애니메이션 파일(.glb)을 "애니메이션 불러오기" 로 붙여 볼 수 있습니다`);
  for (const c of clips) {
    // 클립 이름: TP_<동작>[_<방향|무기종류>...] — 각 단어는 대문자로 시작 (예: TP_Walk_Left, FP_Reload_Rifle)
    const re = new RegExp(`^${rig.clipPrefix}[A-Z][A-Za-z0-9]*(_[A-Z0-9][A-Za-z0-9]*)*$`);
    if (!re.test(c.name)) warn(`클립 이름 "${c.name}" — ${rig.clipPrefix}<동작>[_<방향|무기종류>] 규칙과 다릅니다 (예: ${rig.clipPrefix}Walk_Left, ${rig.clipPrefix}Idle_Rifle)`);
    const unknown = [...new Set(c.tracks.map(t => t.name.split('.')[0]).filter(n => !bones.has(n) && !root.getObjectByName(n)))];
    if (unknown.length) warn(`클립 ${c.name}: 없는 뼈를 움직입니다 — ${unknown.slice(0, 5).join(', ')}`);
    if (c.tracks.some(t => t.name.endsWith('.scale'))) warn(`클립 ${c.name}: 크기(scale)에 키가 있습니다 — 규칙상 회전·(Root/Hips/WeaponRoot)이동만`);
  }
  return out;
}
