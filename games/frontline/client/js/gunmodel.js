// Blender 로 만든 총 모델(.glb) 읽기: 이름 규칙(docs/GUN_MODELING.md)에 맞춰 부착 지점·부품·색 칸을 찾고,
// 게임의 총 기준점(spec, guns.js 의 BUILD 가 돌려주는 것과 같은 모양)으로 바꾼다. 규칙 검사도 여기서 한다.
//   축: glTF 로 내보내면 Blender 의 +Y(앞)가 -Z, +Z(위)가 +Y 가 된다 → 게임과 같은 방향 (총구 = -Z, 위 = +Y, 오른쪽 = +X)
import * as THREE from 'three';

// 부착 지점 (Blender 의 빈 물체(Empty) 이름: socket_<이름>)
export const SOCKETS = {
  ads: { required: true, label: '가늠자 (정조준 때 눈이 보는 선)', color: 0xffd23a },
  muzzle: { required: true, label: '총구 끝 (총구 화염·소음기)', color: 0xff5a48 },
  hand_r: { required: true, label: '오른손 (손잡이)', color: 0x5aa9ff },
  hand_l: { required: true, label: '왼손 (총열 덮개 / 권총은 받치는 손)', color: 0x7fe0a0 },
  optic: { required: false, label: '조준경 받침 (레일 윗면)', color: 0xd18cff },
  grip: { required: false, label: '앞 손잡이 (총열 덮개 아랫면)', color: 0xffa04a },
};
// 따로 움직이거나 바뀌는 부품 (물체 이름: part_<이름>)
export const PARTS = {
  mag: '탄창 (재장전 때 빠짐, 원점 = 탄창 윗면)',
  stock: '개머리판 (파츠에 따라 크기가 바뀜, 원점 = 몸통과 붙는 곳)',
  irons: '가늠자·가늠쇠 (조준경을 달면 숨김, part_irons_앞 / part_irons_뒤 처럼 여러 개)',
  scope: '붙박이 스코프 (저격총)',
  bolt: '노리쇠·슬라이드 (나중에 동작용)',
};
// 색 칸 (Blender 재질 이름). 스킨은 이 칸들의 색만 바꾼다
export const SLOTS = {
  body: '주 색',
  body2: '보조 색 (주 색보다 조금 어둡게)',
  dark: '어두운 부분 (손잡이·레일·탄창)',
  metal: '금속 (총열·볼트)',
  accent: '포인트 (작은 표시)',
  core: '스킬 코어 (빛나는 부분)',
};
// 미리 보기용 스킨 (색 칸 → 색). 기본 = 모델에 칠한 색
export const SKINS = {
  기본: null,
  사막: { body: '#c8a878', body2: '#a88a5c', dark: '#4a4234', metal: '#5a5a55', accent: '#e8e0c8', core: '#ffb43a' },
  야간: { body: '#2c3138', body2: '#23272d', dark: '#121417', metal: '#3a3f47', accent: '#5aa9ff', core: '#5aa9ff' },
  숲: { body: '#5b6b3a', body2: '#48552e', dark: '#22261b', metal: '#3a3f37', accent: '#d8c070', core: '#9cff5a' },
  네온: { body: '#ff3fa4', body2: '#c42a7e', dark: '#1a1030', metal: '#40305a', accent: '#3af0ff', core: '#3af0ff' },
};

const EYE = { rifle: 0.12, pistol: 0.4 }; // 정조준 때 눈과 가늠자 사이 거리 (m). socket_ads 에 eye 속성을 넣으면 그 값
const PISTOL_LEN = 0.35;                  // 이보다 짧으면 권총으로 본다 (한 손 들기, 파츠 작게)
const TRI = { good: 6000, max: 12000 };

export const slotOf = name => String(name || '').toLowerCase().replace(/[._]\d+$/, ''); // body.001 → body
const keyOf = (name, prefix) => { const n = String(name || '').toLowerCase(); return n.startsWith(prefix) ? n.slice(prefix.length).replace(/[._]?\d+$/, '') : null; };

// 모델 안의 지점·부품·메시 찾기
export function scanModel(root) {
  root.updateMatrixWorld(true);
  const sockets = {}, parts = { irons: [] }, meshes = [], materials = new Map();
  root.traverse(o => {
    const s = keyOf(o.name, 'socket_');
    if (s !== null) { sockets[s] = o; return; }
    const p = keyOf(o.name, 'part_');
    if (p !== null) {
      if (p.startsWith('irons')) parts.irons.push(o);
      else if (!parts[p]) parts[p] = o;
    }
    if (o.isMesh) {
      meshes.push(o);
      for (const m of [].concat(o.material)) if (m) materials.set(m.uuid, m);
    }
  });
  return { sockets, parts, meshes, materials: [...materials.values()] };
}

const posOf = o => o.getWorldPosition(new THREE.Vector3());
function boxOf(meshes) {
  const b = new THREE.Box3();
  for (const m of meshes) b.expandByObject(m);
  return b;
}

// 게임용 기준점 (guns.js 의 wrapGun 에 그대로 넣는다). 필수 지점이 없으면 null
export function gunSpec(root, scan = scanModel(root)) {
  const { sockets: S, parts: P, meshes } = scan;
  if (!S.ads || !S.muzzle || !S.hand_r || !S.hand_l) return null;
  const ads = posOf(S.ads), mz = posOf(S.muzzle), hr = posOf(S.hand_r), hl = posOf(S.hand_l);
  const len = boxOf(meshes).getSize(new THREE.Vector3()).z;
  const pistol = len < PISTOL_LEN;
  const eye = Number(S.ads.userData && S.ads.userData.eye) || (pistol ? EYE.pistol : EYE.rifle);
  const spec = {
    mag: P.mag || null, magPivotTop: true, stock: P.stock || null, scope: P.scope || null, irons: P.irons,
    muzzleZ: mz.z, barrelY: mz.y, sightY: ads.y, adsZ: -eye - ads.z,
    hip: pistol ? [0.15, -0.15, -0.44] : [0.19, -0.19, -0.42],
    gripZ: hr.z, gripY: hr.y, supportZ: hl.z, supportY: hl.y, pistol,
  };
  if (S.optic) { const o = posOf(S.optic); spec.optic = [o.y, o.z]; }
  if (S.grip) { const g = posOf(S.grip); spec.grip = [g.y, g.z]; }
  if (pistol) spec.small = 0.72;
  return spec;
}

// 규칙 검사. 반환: [{ level: 'ok'|'warn'|'fail', text }]
export function checkModel(root, { bytes = 0 } = {}, scan = scanModel(root)) {
  const out = [], ok = t => out.push({ level: 'ok', text: t }), warn = t => out.push({ level: 'warn', text: t }), fail = t => out.push({ level: 'fail', text: t });
  const { sockets: S, parts: P, meshes, materials } = scan;
  if (!meshes.length) { fail('모양(메시)이 하나도 없습니다'); return out; }

  // 1) 필수 지점
  const missing = Object.entries(SOCKETS).filter(([k, v]) => v.required && !S[k]).map(([k]) => `socket_${k}`);
  if (missing.length) fail(`필수 부착 지점이 없습니다: ${missing.join(', ')}`);
  else ok('필수 부착 지점 4개가 있습니다');
  const unknown = Object.keys(S).filter(k => !SOCKETS[k]);
  if (unknown.length) warn(`모르는 부착 지점 (무시됨): ${unknown.map(k => 'socket_' + k).join(', ')}`);
  if (!S.optic) warn('socket_optic 이 없어 조준경 파츠를 달 수 없습니다');
  if (!S.grip) warn('socket_grip 이 없어 앞 손잡이 파츠를 달 수 없습니다 (권총이면 괜찮음)');

  // 2) 크기·방향
  const box = boxOf(meshes), size = box.getSize(new THREE.Vector3()), len = size.z;
  if (len > 3) fail(`길이가 ${len.toFixed(2)}m 입니다 — 단위가 cm 로 내보내졌을 수 있습니다 (Blender 단위 배율 1.0, 크기 적용 Ctrl+A)`);
  else if (len < 0.1) fail(`길이가 ${len.toFixed(3)}m 입니다 — 너무 작습니다 (1 = 1m)`);
  else if (size.x > len || size.y > len) fail(`총이 앞(-Z)을 향하지 않습니다 (가로 ${size.x.toFixed(2)} · 높이 ${size.y.toFixed(2)} · 길이 ${len.toFixed(2)}m). Blender 에서 총구가 +Y 쪽이어야 합니다`);
  else ok(`크기 ${len.toFixed(2)}m (가로 ${size.x.toFixed(2)} · 높이 ${size.y.toFixed(2)})${len < PISTOL_LEN ? ' — 권총으로 다룹니다' : ''}`);
  if (S.ads && S.muzzle) {
    const a = posOf(S.ads), m = posOf(S.muzzle);
    if (m.z >= a.z) fail('총구가 가늠자보다 뒤에 있습니다 — 총이 거꾸로 향합니다 (Blender: 총구 = +Y)');
    if (S.hand_r && posOf(S.hand_r).y >= a.y) fail('오른손이 가늠자보다 위에 있습니다 — 위아래가 뒤집혔을 수 있습니다 (Blender: 위 = +Z)');
    const off = Math.max(Math.abs(a.x), Math.abs(m.x));
    if (off > 0.005) warn(`가늠자·총구가 가운데에서 ${(off * 100).toFixed(1)}cm 벗어났습니다 (x = 0 에 두세요)`);
    const c = (box.min.z + box.max.z) / 2;
    if (Math.abs(c - (S.hand_r ? posOf(S.hand_r).z : c)) > len * 0.45) warn('원점이 총에서 멀리 떨어져 있습니다 — 방아쇠 위 총열 높이에 두세요');
  }
  let scaled = false;
  root.traverse(o => { if (o !== root && (Math.abs(o.scale.x - 1) > 1e-3 || Math.abs(o.scale.y - 1) > 1e-3 || Math.abs(o.scale.z - 1) > 1e-3) && !keyOf(o.name, 'socket_')) scaled = true; });
  if (scaled) warn('크기가 적용되지 않은 물체가 있습니다 (Blender 에서 Ctrl+A → 모두 적용)');

  // 3) 부품
  if (P.mag) {
    const mb = new THREE.Box3().setFromObject(P.mag), top = posOf(P.mag).y;
    if (Math.abs(mb.max.y - top) > 0.02) warn('part_mag 의 원점이 탄창 윗면에 있지 않습니다 (확장 탄창이 위로도 늘어납니다)');
    else ok('탄창(part_mag) 이 따로 있습니다');
  } else warn('part_mag 가 없어 재장전 때 탄창이 빠지는 동작이 없습니다');
  if (!P.irons.length) warn('part_irons 가 없습니다 — 조준경을 달아도 가늠자가 그대로 보입니다');

  // 4) 삼각형 수·재질·용량
  let tris = 0;
  for (const m of meshes) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  if (tris > TRI.max) fail(`삼각형 ${Math.round(tris).toLocaleString()}개 — 최대 ${TRI.max.toLocaleString()}개`);
  else if (tris > TRI.good) warn(`삼각형 ${Math.round(tris).toLocaleString()}개 — 권장 ${TRI.good.toLocaleString()}개 이하`);
  else ok(`삼각형 ${Math.round(tris).toLocaleString()}개`);
  const names = [...new Set(materials.map(m => slotOf(m.name)))];
  const bad = names.filter(n => !SLOTS[n]);
  if (bad.length) warn(`색 칸 이름이 아닌 재질: ${bad.join(', ')} — 스킨이 적용되지 않습니다 (${Object.keys(SLOTS).join(' / ')})`);
  else ok(`색 칸: ${names.join(', ')}`);
  if (materials.some(m => m.map)) warn('텍스처 이미지를 쓰고 있습니다 — 이 게임의 총은 단색 재질만 씁니다 (용량·스킨 때문)');
  if (bytes > 800 * 1024) fail(`파일 ${(bytes / 1024).toFixed(0)}KB — 최대 800KB`);
  else if (bytes > 300 * 1024) warn(`파일 ${(bytes / 1024).toFixed(0)}KB — 권장 300KB 이하`);
  else if (bytes) ok(`파일 ${(bytes / 1024).toFixed(0)}KB`);
  return out;
}

// 스킨 적용 (색 칸별 색). palette = null 이면 모델 원래 색
export function applySkin(root, palette) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = [].concat(o.material);
    for (const m of mats) {
      if (!m.userData.orig) m.userData.orig = { color: m.color.getHex(), emissive: m.emissive ? m.emissive.getHex() : 0 };
      const slot = slotOf(m.userData.slot || m.name);
      m.userData.slot = slot;
      const c = palette && palette[slot];
      m.color.setHex(c ? parseInt(c.slice(1), 16) : m.userData.orig.color);
      if (m.emissive && slot === 'core') { m.emissive.setHex(c ? parseInt(c.slice(1), 16) : m.userData.orig.emissive || m.userData.orig.color); m.emissiveIntensity = 1.4; }
    }
  });
}
