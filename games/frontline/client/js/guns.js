// 총과 병사 모델. 총은 상자/원통을 조합해 만들고, 파츠(조준경·총열·손잡이·탄창·개머리판)는 setGunParts 로 갈아 끼운다.
// 조준경·총구 장치·앞 손잡이는 Blender 파츠 모델(content/parts/<id>.glb, partmodels.js)이 있으면 그것을 쓴다.
import * as THREE from 'three';
import { modelFor, modelIdFor } from './gunmodels.js';
import { gunSpec } from './modelrules.js';
import { dressGun, dressGunLite, dressMaterial } from './gunmat.js';
import { attachClips } from './gunanim.js';
import { partModel } from './partmodels.js';

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.85, roughness: 0.42 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x141516, metalness: 0.1, roughness: 0.75 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6a3d20, metalness: 0, roughness: 0.6 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x424a30, metalness: 0.05, roughness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0a1418, metalness: 0.9, roughness: 0.1 }),
  dot: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  tube: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, metalness: 0, roughness: 1, side: THREE.DoubleSide }), // 속이 빈 조준경 통 (안쪽 면도 보인다)
  sleeve: new THREE.MeshStandardMaterial({ color: 0x4b5338, roughness: 0.95 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.85 }),
};
for (const [k, m] of Object.entries(M)) { m.name = k; dressMaterial(m); } // 색 칸 재질 값 (steel = metal, polymer = dark …)

function bx(g, w, h, d, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
}
function cy(g, r, len, x, y, z, mat) {
  const geo = new THREE.CylinderGeometry(r, r, len, 12); geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
}
// 가늠자(두 갈래). 반환한 부품들은 조준경을 달면 숨긴다 (irons)
function rearSight(g, y, z) {
  return [bx(g, 0.005, 0.014, 0.006, -0.008, y, z, M.steel), bx(g, 0.005, 0.014, 0.006, 0.008, y, z, M.steel)];
}
function limb(g, from, to, thick) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), M.sleeve);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  g.add(m);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.85, thick * 0.95, thick * 1.1), M.glove);
  hand.position.copy(a); hand.quaternion.copy(m.quaternion); g.add(hand);
}

const BUILD = {
  ar(g) { // 기본 돌격소총 (모델을 못 불러왔을 때의 코드 모양)
    bx(g, 0.045, 0.075, 0.2, 0, -0.01, 0, M.steel);
    bx(g, 0.05, 0.055, 0.24, 0, 0, -0.22, M.polymer);
    cy(g, 0.009, 0.2, 0, 0, -0.43, M.steel); cy(g, 0.012, 0.045, 0, 0, -0.545, M.steel);
    cy(g, 0.014, 0.16, 0, 0, 0.18, M.steel);
    const stock = bx(g, 0.04, 0.1, 0.1, 0, -0.02, 0.28, M.polymer);
    bx(g, 0.035, 0.09, 0.04, 0, -0.085, 0.07, M.polymer, 0.3);
    bx(g, 0.03, 0.012, 0.42, 0, 0.034, -0.1, M.steel);
    // 기본 가늠자/가늠쇠 (조준경은 무기고에서 단다)
    const irons = [...rearSight(g, 0.05, 0.08), bx(g, 0.004, 0.022, 0.004, 0, 0.051, -0.29, M.steel)];
    const mag = bx(g, 0.028, 0.15, 0.055, 0, -0.115, -0.04, M.steel, -0.12);
    return { mag, stock, irons, muzzleZ: -0.57, sightY: 0.058, hip: [0.19, -0.19, -0.42], adsZ: -0.2, gripZ: 0.07, supportZ: -0.24, optic: [0.04, 0], barrelY: 0, grip: [-0.0275, -0.24] };
  },
  mp5(g) {
    bx(g, 0.045, 0.06, 0.26, 0, -0.005, 0, M.steel);
    bx(g, 0.05, 0.055, 0.13, 0, -0.01, -0.19, M.polymer);
    cy(g, 0.009, 0.08, 0, -0.005, -0.29, M.steel); cy(g, 0.012, 0.2, 0, 0.03, -0.17, M.steel);
    const stock = bx(g, 0.035, 0.07, 0.18, 0, -0.005, 0.22, M.polymer);
    bx(g, 0.035, 0.09, 0.04, 0, -0.08, 0.06, M.polymer, 0.3);
    const irons = [bx(g, 0.004, 0.026, 0.004, 0, 0.045, -0.26, M.steel), ...rearSight(g, 0.05, 0.06)];
    const mag = new THREE.Group(); g.add(mag);
    bx(mag, 0.024, 0.09, 0.04, 0, -0.075, -0.06, M.steel, -0.15);
    bx(mag, 0.024, 0.08, 0.04, 0, -0.145, -0.08, M.steel, -0.4);
    return { mag, stock, irons, muzzleZ: -0.34, sightY: 0.056, hip: [0.18, -0.18, -0.4], adsZ: -0.2, gripZ: 0.06, supportZ: -0.19, optic: [0.034, -0.01], barrelY: -0.005, grip: [-0.0375, -0.19] };
  },
  m870(g) {
    bx(g, 0.045, 0.07, 0.2, 0, -0.005, 0, M.steel);
    cy(g, 0.011, 0.5, 0, 0.012, -0.35, M.steel); cy(g, 0.011, 0.4, 0, -0.014, -0.3, M.steel);
    bx(g, 0.05, 0.045, 0.16, 0, -0.02, -0.25, M.wood);
    const stock = bx(g, 0.04, 0.09, 0.28, 0, -0.04, 0.26, M.wood, -0.12);
    bx(g, 0.004, 0.008, 0.004, 0, 0.028, -0.59, M.steel);
    return { mag: null, stock, muzzleZ: -0.61, sightY: 0.036, hip: [0.19, -0.18, -0.42], adsZ: -0.2, gripZ: 0.12, supportZ: -0.25, optic: [0.03, 0.02], barrelY: 0.012, tube: [-0.014, -0.5] };
  },
  awm(g) {
    bx(g, 0.05, 0.07, 0.5, 0, -0.03, 0, M.olive);
    const stock = bx(g, 0.045, 0.11, 0.18, 0, -0.04, 0.33, M.olive);
    bx(g, 0.04, 0.08, 0.04, 0, -0.08, 0.13, M.olive, 0.4);
    cy(g, 0.016, 0.3, 0, 0.012, -0.02, M.steel); cy(g, 0.011, 0.55, 0, 0.012, -0.5, M.steel);
    bx(g, 0.03, 0.025, 0.05, 0, 0.012, -0.79, M.steel);
    const scope = new THREE.Group(); g.add(scope); // 스코프 (조준경 파츠에 따라 길이가 달라진다)
    cy(scope, 0.017, 0.28, 0, 0.065, 0, M.steel); cy(scope, 0.024, 0.07, 0, 0.065, -0.17, M.steel); cy(scope, 0.021, 0.05, 0, 0.065, 0.15, M.steel);
    cy(scope, 0.0195, 0.002, 0, 0.065, 0.176, M.glass);
    bx(g, 0.012, 0.03, 0.015, 0, 0.04, 0.07, M.steel); bx(g, 0.012, 0.03, 0.015, 0, 0.04, -0.07, M.steel);
    bx(g, 0.012, 0.012, 0.04, 0.035, 0.005, 0.1, M.steel);
    const mag = bx(g, 0.03, 0.06, 0.08, 0, -0.085, -0.02, M.steel);
    return { mag, stock, scope, muzzleZ: -0.82, sightY: 0.065, hip: [0.2, -0.19, -0.4], adsZ: -0.26, gripZ: 0.13, supportZ: -0.2, barrelY: 0.012 };
  },
  m249(g) {
    bx(g, 0.06, 0.09, 0.3, 0, 0, 0, M.steel);
    bx(g, 0.055, 0.02, 0.22, 0, 0.05, -0.02, M.steel);
    bx(g, 0.055, 0.05, 0.2, 0, -0.012, -0.25, M.polymer);
    cy(g, 0.012, 0.4, 0, 0.012, -0.47, M.steel); cy(g, 0.009, 0.3, 0, -0.015, -0.42, M.steel);
    const stock = bx(g, 0.045, 0.1, 0.22, 0, -0.01, 0.27, M.polymer);
    bx(g, 0.035, 0.09, 0.04, 0, -0.09, 0.09, M.polymer, 0.3);
    const irons = [bx(g, 0.004, 0.05, 0.004, 0, 0.045, -0.62, M.steel), ...rearSight(g, 0.068, 0.08)];
    const mag = bx(g, 0.09, 0.11, 0.12, -0.02, -0.105, -0.05, M.olive);
    return { mag, stock, irons, muzzleZ: -0.68, sightY: 0.074, hip: [0.2, -0.2, -0.42], adsZ: -0.24, gripZ: 0.09, supportZ: -0.26, optic: [0.06, -0.04], barrelY: 0.012, grip: [-0.037, -0.26] };
  },
  m9(g) {
    bx(g, 0.028, 0.03, 0.2, 0, 0.01, -0.03, M.steel);
    bx(g, 0.026, 0.02, 0.14, 0, -0.012, -0.02, M.polymer);
    bx(g, 0.03, 0.1, 0.045, 0, -0.07, 0.04, M.polymer, 0.2);
    bx(g, 0.008, 0.008, 0.05, 0, -0.04, -0.02, M.steel);
    const irons = [bx(g, 0.004, 0.006, 0.004, 0, 0.028, -0.12, M.steel), ...rearSight(g, 0.027, 0.06)];
    const mag = bx(g, 0.022, 0.1, 0.035, 0, -0.078, 0.042, M.steel, 0.2);
    return { mag, irons, muzzleZ: -0.14, sightY: 0.03, hip: [0.15, -0.15, -0.44], adsZ: -0.36, gripZ: 0.04, supportZ: 0.045, pistol: true, optic: [0.025, 0.03], barrelY: 0.01, small: 0.72 };
  },
};

// ───────── 파츠 모델 ─────────
// 각 총의 BUILD 가 돌려주는 기준점: optic [윗면 높이, z], barrelY(총열 높이), grip [총열덮개 아랫면 높이, z], stock/mag/scope(크기를 바꿀 부품)
// 조준경: o = 받침 윗면이 원점인 그룹. 반환 = 조준선 높이
const OPTIC = {
  reddot(o) {
    bx(o, 0.03, 0.016, 0.05, 0, -0.002, 0, M.steel);
    bx(o, 0.003, 0.04, 0.042, -0.0175, 0.026, 0, M.steel); bx(o, 0.003, 0.04, 0.042, 0.0175, 0.026, 0, M.steel);
    bx(o, 0.038, 0.003, 0.042, 0, 0.047, 0, M.steel);
    bx(o, 0.0018, 0.0018, 0.001, 0, 0.028, 0, M.dot);
    return 0.028;
  },
  acog(o) {
    // 앞이 넓은 속 빈 통: 눈을 대면 안쪽 벽이 얇은 테두리로만 보여서 시야가 넓다
    const geo = new THREE.CylinderGeometry(0.019, 0.028, 0.06, 24, 1, true); geo.rotateX(Math.PI / 2);
    const tube = new THREE.Mesh(geo, M.tube); tube.position.set(0, 0.036, 0); o.add(tube);
    bx(o, 0.024, 0.02, 0.06, 0, 0.002, -0.01, M.steel);
    bx(o, 0.0012, 0.0012, 0.001, 0, 0.036, -0.03, M.dot);
    return 0.036;
  },
};
// 총구 장치: 반환 = 총구가 앞으로 나간 길이
const BARREL = {
  suppressor(a, y, z, s) { cy(a, 0.019 * s, 0.17 * s, 0, y, z - 0.08 * s, M.polymer); cy(a, 0.0205 * s, 0.012 * s, 0, y, z - 0.012 * s, M.steel); return 0.165 * s; },
  comp(a, y, z, s) { cy(a, 0.0145 * s, 0.05 * s, 0, y, z - 0.02 * s, M.steel); bx(a, 0.034 * s, 0.006 * s, 0.012 * s, 0, y, z - 0.03 * s, M.steel); return 0.045 * s; },
  long(a, y, z, s) { cy(a, 0.0095 * s, 0.13 * s, 0, y, z - 0.06 * s, M.steel); cy(a, 0.0125 * s, 0.02 * s, 0, y, z - 0.118 * s, M.steel); return 0.128 * s; },
};
const GRIP = {
  vertical(a, y, z) { bx(a, 0.026, 0.085, 0.028, 0, y - 0.04, z, M.polymer); },
  angled(a, y, z) { bx(a, 0.028, 0.03, 0.1, 0, y - 0.014, z, M.polymer, 0.35); },
  stubby(a, y, z) { bx(a, 0.03, 0.045, 0.032, 0, y - 0.02, z, M.polymer); },
};
const MAG_SCALE = { ext: 1.32, fast: 0.84 };

// 총에 파츠를 단다 (이미 달린 것은 떼고 새로). parts = { optic, barrel, grip, mag, stock } 중 있는 것만.
// 조준선 높이·총구 위치 등 파츠에 따라 달라지는 값(sightY, adsZ, muzzleZ, magRest)도 함께 갱신한다.
export function setGunParts(gun, parts = {}) {
  const a = gun.att, b = gun.base;
  for (const c of [...a.children]) { c.traverse(o => { if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); }); a.remove(c); }
  gun.muzzleZ = b.muzzleZ; gun.sightY = b.sightY; gun.adsZ = b.adsZ;
  const hasOptic = !gun.scope && !!gun.optic && !!OPTIC[parts.optic];
  for (const m of gun.irons || []) m.visible = !hasOptic; // 조준경을 달면 가늠자/가늠쇠는 접는다

  if (gun.scope) { // 저격소총: 달려 있는 스코프의 모양만 바뀐다
    gun.scope.scale.z = parts.optic === 'scope_lo' ? 0.72 : 1;
    if (parts.optic === 'scope_hi') cy(a, 0.027, 0.1, 0, 0.065, -0.25, M.steel);
  } else if (hasOptic) {
    const o = new THREE.Group(), s = gun.small || 1;
    o.position.set(0, gun.optic[0], gun.optic[1]); o.scale.setScalar(s); a.add(o);
    const pm = partModel(parts.optic); // Blender 파츠 모델이 있으면 그것, 없으면 코드로 만든 모양
    if (pm) o.add(pm.root);
    gun.sightY = gun.optic[0] + (pm ? (pm.sockets.sight ? pm.sockets.sight.position.y : 0.03) : OPTIC[parts.optic](o)) * s;
    if (parts.optic === 'acog') gun.adsZ = -0.09 - gun.optic[1]; // 접안부가 눈 가까이 오도록
  }
  const pb = BARREL[parts.barrel] && partModel(parts.barrel);
  if (pb) { // 총구 장치 모델: 원점 = 총구 끝, socket_muzzle = 새 총구 끝
    const s = gun.small || 1, g = new THREE.Group();
    g.position.set(0, gun.barrelY, b.muzzleZ); g.scale.setScalar(s); g.add(pb.root); a.add(g);
    gun.muzzleZ -= (pb.sockets.muzzle ? -pb.sockets.muzzle.position.z : 0.1) * s;
  } else if (BARREL[parts.barrel]) gun.muzzleZ -= BARREL[parts.barrel](a, gun.barrelY, b.muzzleZ, gun.small || 1);
  const pg = gun.grip && GRIP[parts.grip] && partModel(parts.grip);
  if (pg) { pg.root.position.set(0, gun.grip[0], gun.grip[1]); a.add(pg.root); } // 앞 손잡이 모델: 원점 = 총열 덮개 아랫면
  else if (gun.grip && GRIP[parts.grip]) GRIP[parts.grip](a, gun.grip[0], gun.grip[1]);

  const ms = MAG_SCALE[parts.mag] || 1;
  if (gun.mag) { // 탄창: 윗부분은 그대로 두고 아래로 길어지거나 짧아진다 (Blender 모델은 원점이 탄창 윗면이라 그냥 늘리면 된다)
    const prm = gun.mag.geometry && gun.mag.geometry.parameters;
    const h = !gun.magPivotTop && prm ? prm.height : 0;
    gun.mag.scale.y = ms; gun.mag.position.copy(b.magPos); gun.mag.position.y -= h * (ms - 1) / 2;
    gun.magRest = gun.mag.position.clone();
  } else if (gun.tube && parts.mag === 'ext') cy(a, 0.012, 0.1, 0, gun.tube[0], gun.tube[1] - 0.045, M.steel); // 산탄총: 연장 튜브

  if (gun.stock) {
    const st = gun.stock, p = st.geometry && st.geometry.parameters; // p: 코드로 만든 총의 상자 크기 (Blender 모델은 없음)
    if (parts.stock === 'light') st.scale.set(0.5, 0.62, 1);
    else if (parts.stock === 'heavy') { st.scale.set(1.22, 1.12, 1.05); if (p) bx(a, 0.034, 0.02, p.depth * 0.6, 0, st.position.y + p.height * 0.56 + 0.008, st.position.z, M.polymer, st.rotation.x); }
    else st.scale.set(1, 1, 1);
  }
}

// 1인칭 팔 (손 위치: spec.gripZ/gripY = 오른손, supportZ/supportY = 왼손)
// 반환: 왼팔 그룹 (모션 클립의 anim_hand_l 을 따라 움직일 수 있게 따로 묶는다)
export function attachArms(group, spec) {
  const gy = spec.gripY ?? -0.085, armL = new THREE.Group();
  group.add(armL);
  limb(group, [0.005, gy, spec.gripZ], [0.13, gy - 0.215, spec.gripZ + 0.42], 0.075);
  if (spec.pistol) limb(armL, [-0.02, (spec.supportY ?? -0.09), spec.supportZ], [-0.22, -0.3, 0.42], 0.075);
  else limb(armL, [-0.005, spec.supportY ?? -0.05, spec.supportZ], [-0.24, -0.3, spec.supportZ + 0.4], 0.075);
  return armL;
}

// 총 모델 그룹 + 기준점(spec) → 파츠를 달 수 있는 총 객체. 코드로 만든 총과 Blender 모델(modelrules.js)이 같이 쓴다
// detail = false: 질감 셰이더 없이 재질 값만 (다른 플레이어가 든 총 — 작게 보이고 수가 많다)
export function wrapGun(group, spec, parts, detail = true) {
  const att = new THREE.Group(); group.add(att); // 파츠 모델이 들어가는 곳
  const gun = { group, att, ...spec, base: { muzzleZ: spec.muzzleZ, sightY: spec.sightY, adsZ: spec.adsZ, magPos: spec.mag ? spec.mag.position.clone() : null } };
  setGunParts(gun, parts);
  return detail ? dressGun(gun) : dressGunLite(gun); // 색 칸별 질감 + 총마다 자기 재질 (효과용)
}

// 등록된 모델(.glb)로 총 만들기. 부착 지점이 모자라면 null (→ 코드로 만든 총)
function buildFromModel(src, modelId, withArms, parts, detail) {
  const group = new THREE.Group(), root = src.clone(true);
  group.add(root); group.updateMatrixWorld(true);
  const spec = gunSpec(group);
  if (!spec) return null;
  const armL = withArms ? attachArms(group, spec) : null;
  const gun = wrapGun(group, spec, parts, detail);
  gun.model = modelId; // 어떤 모델로 만들었는지 (확인·테스트용)
  return attachClips(gun, root, root.animations, armL); // 모션 클립 (재장전 등, docs/GUN_MODELING.md 11). anim_hand_l = 왼손 목표
}

// withArms: 1인칭 뷰모델용 팔 포함 여부
// 무기 데이터에 등록된 모델이 연결돼 있으면 그 모델로, 아니면 코드로 만든 총
// detail: 질감 셰이더까지 (1인칭·무기고). 다른 플레이어의 총은 false
export function buildGun(id, withArms, parts, detail = true) {
  const src = modelFor(id);
  if (src) { const g = buildFromModel(src, modelIdFor(id), withArms, parts, detail); if (g) return g; }
  const group = new THREE.Group();
  const spec = (BUILD[id] || BUILD.ar)(group); // 모델도 코드 모양도 없는 무기(모델을 못 불러온 새 무기)는 소총 모양으로
  const armL = withArms ? attachArms(group, spec) : null;
  const gun = wrapGun(group, spec, parts, detail);
  gun.armL = armL;
  return gun;
}

// ───────── 3인칭 병사 모델 ─────────
export function buildSoldier(colorSet) {
  const uniform = new THREE.MeshStandardMaterial({ color: colorSet.uniform, roughness: 0.95 });
  const vest = new THREE.MeshStandardMaterial({ color: colorSet.vest, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.85 });

  const root = new THREE.Group();
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.1, 0.86, 0);
    bx(leg, 0.16, 0.76, 0.19, 0, -0.38, 0, uniform);
    bx(leg, 0.17, 0.12, 0.27, 0, -0.8, -0.03, dark);
    root.add(leg); legs.push(leg);
  }
  const upper = new THREE.Group(); upper.position.y = 0.86; root.add(upper);
  bx(upper, 0.4, 0.6, 0.22, 0, 0.3, 0, uniform);
  bx(upper, 0.44, 0.42, 0.27, 0, 0.34, 0, vest);
  bx(upper, 0.3, 0.16, 0.08, 0, 0.2, -0.17, vest);
  bx(upper, 0.1, 0.09, 0.1, 0, 0.64, 0, skin);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin);
  head.position.set(0, 0.76, 0); upper.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), vest);
  helmet.position.set(0, 0.775, 0.005); upper.add(helmet);

  // 어깨 축 (상하 조준)
  const aim = new THREE.Group(); aim.position.set(0, 0.52, 0); upper.add(aim);
  const armGeo = (from, to) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, a.distanceTo(b)), uniform);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
    aim.add(m);
  };
  armGeo([0.24, 0, 0], [0.14, -0.1, -0.3]);
  armGeo([-0.24, 0, 0], [0.08, -0.08, -0.5]);
  const gunSlot = new THREE.Group(); gunSlot.position.set(0.12, -0.03, -0.38); aim.add(gunSlot);

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { root, legs, upper, aim, gunSlot, mats: { uniform, vest } };
}
