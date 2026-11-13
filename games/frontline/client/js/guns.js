import * as THREE from 'three';

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.85, roughness: 0.42 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x141516, metalness: 0.1, roughness: 0.75 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6a3d20, metalness: 0, roughness: 0.6 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x424a30, metalness: 0.05, roughness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0a1418, metalness: 0.9, roughness: 0.1 }),
  dot: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x4b5338, roughness: 0.95 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.85 }),
};

function bx(g, w, h, d, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
}
function cy(g, r, len, x, y, z, mat) {
  const geo = new THREE.CylinderGeometry(r, r, len, 12); geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
}
function rearSight(g, y, z) {
  bx(g, 0.005, 0.014, 0.006, -0.008, y, z, M.steel);
  bx(g, 0.005, 0.014, 0.006, 0.008, y, z, M.steel);
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
  m4(g) {
    bx(g, 0.045, 0.075, 0.2, 0, -0.01, 0, M.steel);
    bx(g, 0.05, 0.055, 0.24, 0, 0, -0.22, M.polymer);
    cy(g, 0.009, 0.2, 0, 0, -0.43, M.steel); cy(g, 0.012, 0.045, 0, 0, -0.545, M.steel);
    cy(g, 0.014, 0.16, 0, 0, 0.18, M.steel);
    bx(g, 0.04, 0.1, 0.1, 0, -0.02, 0.28, M.polymer);
    bx(g, 0.035, 0.09, 0.04, 0, -0.085, 0.07, M.polymer, 0.3);
    bx(g, 0.03, 0.012, 0.42, 0, 0.034, -0.1, M.steel);
    // 도트 사이트
    bx(g, 0.036, 0.012, 0.06, 0, 0.046, 0, M.steel);
    bx(g, 0.003, 0.04, 0.045, -0.018, 0.072, 0, M.steel);
    bx(g, 0.003, 0.04, 0.045, 0.018, 0.072, 0, M.steel);
    bx(g, 0.039, 0.003, 0.045, 0, 0.093, 0, M.steel);
    bx(g, 0.0018, 0.0018, 0.001, 0, 0.072, 0, M.dot);
    const mag = bx(g, 0.028, 0.15, 0.055, 0, -0.115, -0.04, M.steel, -0.12);
    return { mag, muzzleZ: -0.57, sightY: 0.072, hip: [0.19, -0.19, -0.42], adsZ: -0.3, gripZ: 0.07, supportZ: -0.24 };
  },
  ak(g) {
    bx(g, 0.045, 0.07, 0.24, 0, -0.01, 0, M.steel);
    bx(g, 0.04, 0.02, 0.2, 0, 0.033, 0.0, M.steel);
    bx(g, 0.048, 0.05, 0.16, 0, -0.005, -0.2, M.wood);
    bx(g, 0.035, 0.022, 0.14, 0, 0.032, -0.2, M.wood);
    cy(g, 0.009, 0.3, 0, 0, -0.42, M.steel); cy(g, 0.007, 0.2, 0, 0.028, -0.32, M.steel);
    bx(g, 0.02, 0.03, 0.02, 0, 0.018, -0.53, M.steel);
    bx(g, 0.004, 0.03, 0.004, 0, 0.045, -0.53, M.steel);
    rearSight(g, 0.052, -0.1);
    bx(g, 0.04, 0.09, 0.24, 0, -0.035, 0.25, M.wood, -0.1);
    bx(g, 0.035, 0.09, 0.04, 0, -0.085, 0.08, M.wood, 0.3);
    const mag = new THREE.Group(); g.add(mag);
    bx(mag, 0.028, 0.1, 0.06, 0, -0.09, -0.05, M.steel, -0.2);
    bx(mag, 0.028, 0.09, 0.058, 0, -0.165, -0.085, M.steel, -0.5);
    return { mag, muzzleZ: -0.58, sightY: 0.058, hip: [0.19, -0.19, -0.42], adsZ: -0.16, gripZ: 0.08, supportZ: -0.2 };
  },
  mp5(g) {
    bx(g, 0.045, 0.06, 0.26, 0, -0.005, 0, M.steel);
    bx(g, 0.05, 0.055, 0.13, 0, -0.01, -0.19, M.polymer);
    cy(g, 0.009, 0.08, 0, -0.005, -0.29, M.steel); cy(g, 0.012, 0.2, 0, 0.03, -0.17, M.steel);
    bx(g, 0.035, 0.07, 0.18, 0, -0.005, 0.22, M.polymer);
    bx(g, 0.035, 0.09, 0.04, 0, -0.08, 0.06, M.polymer, 0.3);
    bx(g, 0.004, 0.026, 0.004, 0, 0.045, -0.26, M.steel);
    rearSight(g, 0.05, 0.06);
    const mag = new THREE.Group(); g.add(mag);
    bx(mag, 0.024, 0.09, 0.04, 0, -0.075, -0.06, M.steel, -0.15);
    bx(mag, 0.024, 0.08, 0.04, 0, -0.145, -0.08, M.steel, -0.4);
    return { mag, muzzleZ: -0.34, sightY: 0.056, hip: [0.18, -0.18, -0.4], adsZ: -0.2, gripZ: 0.06, supportZ: -0.19 };
  },
  m870(g) {
    bx(g, 0.045, 0.07, 0.2, 0, -0.005, 0, M.steel);
    cy(g, 0.011, 0.5, 0, 0.012, -0.35, M.steel); cy(g, 0.011, 0.4, 0, -0.014, -0.3, M.steel);
    bx(g, 0.05, 0.045, 0.16, 0, -0.02, -0.25, M.wood);
    bx(g, 0.04, 0.09, 0.28, 0, -0.04, 0.26, M.wood, -0.12);
    bx(g, 0.004, 0.008, 0.004, 0, 0.028, -0.59, M.steel);
    return { mag: null, muzzleZ: -0.61, sightY: 0.036, hip: [0.19, -0.18, -0.42], adsZ: -0.2, gripZ: 0.12, supportZ: -0.25 };
  },
  awm(g) {
    bx(g, 0.05, 0.07, 0.5, 0, -0.03, 0, M.olive);
    bx(g, 0.045, 0.11, 0.18, 0, -0.04, 0.33, M.olive);
    bx(g, 0.04, 0.08, 0.04, 0, -0.08, 0.13, M.olive, 0.4);
    cy(g, 0.016, 0.3, 0, 0.012, -0.02, M.steel); cy(g, 0.011, 0.55, 0, 0.012, -0.5, M.steel);
    bx(g, 0.03, 0.025, 0.05, 0, 0.012, -0.79, M.steel);
    cy(g, 0.017, 0.28, 0, 0.065, 0, M.steel); cy(g, 0.024, 0.07, 0, 0.065, -0.17, M.steel); cy(g, 0.021, 0.05, 0, 0.065, 0.15, M.steel);
    cy(g, 0.0195, 0.002, 0, 0.065, 0.176, M.glass);
    bx(g, 0.012, 0.03, 0.015, 0, 0.04, 0.07, M.steel); bx(g, 0.012, 0.03, 0.015, 0, 0.04, -0.07, M.steel);
    bx(g, 0.012, 0.012, 0.04, 0.035, 0.005, 0.1, M.steel);
    const mag = bx(g, 0.03, 0.06, 0.08, 0, -0.085, -0.02, M.steel);
    return { mag, muzzleZ: -0.82, sightY: 0.065, hip: [0.2, -0.19, -0.4], adsZ: -0.26, gripZ: 0.13, supportZ: -0.2 };
  },
  m249(g) {
    bx(g, 0.06, 0.09, 0.3, 0, 0, 0, M.steel);
    bx(g, 0.055, 0.02, 0.22, 0, 0.05, -0.02, M.steel);
    bx(g, 0.055, 0.05, 0.2, 0, -0.012, -0.25, M.polymer);
    cy(g, 0.012, 0.4, 0, 0.012, -0.47, M.steel); cy(g, 0.009, 0.3, 0, -0.015, -0.42, M.steel);
    bx(g, 0.045, 0.1, 0.22, 0, -0.01, 0.27, M.polymer);
    bx(g, 0.035, 0.09, 0.04, 0, -0.09, 0.09, M.polymer, 0.3);
    bx(g, 0.004, 0.05, 0.004, 0, 0.045, -0.62, M.steel);
    rearSight(g, 0.068, 0.08);
    const mag = bx(g, 0.09, 0.11, 0.12, -0.02, -0.105, -0.05, M.olive);
    return { mag, muzzleZ: -0.68, sightY: 0.074, hip: [0.2, -0.2, -0.42], adsZ: -0.24, gripZ: 0.09, supportZ: -0.26 };
  },
  m9(g) {
    bx(g, 0.028, 0.03, 0.2, 0, 0.01, -0.03, M.steel);
    bx(g, 0.026, 0.02, 0.14, 0, -0.012, -0.02, M.polymer);
    bx(g, 0.03, 0.1, 0.045, 0, -0.07, 0.04, M.polymer, 0.2);
    bx(g, 0.008, 0.008, 0.05, 0, -0.04, -0.02, M.steel);
    bx(g, 0.004, 0.006, 0.004, 0, 0.028, -0.12, M.steel);
    rearSight(g, 0.027, 0.06);
    const mag = bx(g, 0.022, 0.1, 0.035, 0, -0.078, 0.042, M.steel, 0.2);
    return { mag, muzzleZ: -0.14, sightY: 0.03, hip: [0.15, -0.15, -0.44], adsZ: -0.36, gripZ: 0.04, supportZ: 0.045, pistol: true };
  },
};

// withArms: 1인칭 뷰모델용 팔 포함 여부
export function buildGun(id, withArms) {
  const group = new THREE.Group();
  const spec = BUILD[id](group);
  if (withArms) {
    limb(group, [0.005, -0.085, spec.gripZ], [0.13, -0.3, spec.gripZ + 0.42], 0.075);
    if (spec.pistol) limb(group, [-0.02, -0.09, spec.supportZ], [-0.22, -0.3, 0.42], 0.075);
    else limb(group, [-0.005, -0.05, spec.supportZ], [-0.24, -0.3, spec.supportZ + 0.4], 0.075);
  }
  if (spec.mag) spec.magRest = spec.mag.position.clone();
  return { group, ...spec };
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
