// 규칙(docs/GUN_MODELING.md)대로 만든 예시 총. 총기 뷰어의 "예시 총" 버튼과 자동 테스트가 쓴다.
// Blender 에서 만들 때 이 구조(이름·원점·색 칸)를 그대로 따라 하면 된다. 좌표는 게임 기준 (총구 = -Z, 위 = +Y, m)
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const mat = (name, color, extra = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: 0.75, metalness: 0.05, flatShading: true, ...extra });
const M = {
  body: mat('body', 0xe0a24a), body2: mat('body2', 0xc27f34), dark: mat('dark', 0x262b36),
  metal: mat('metal', 0x3a3f47, { metalness: 0.6, roughness: 0.45 }), accent: mat('accent', 0xd8382e),
  core: mat('core', 0x3ad7ff, { emissive: 0x3ad7ff, emissiveIntensity: 1.4 }),
};
function box(parent, name, w, h, d, x, y, z, m, rx = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.name = name;
  o.position.set(x, y, z); o.rotation.x = rx; parent.add(o); return o;
}
function cyl(parent, name, r, len, x, y, z, m) {
  const g = new THREE.CylinderGeometry(r, r, len, 8); g.rotateX(Math.PI / 2);
  const o = new THREE.Mesh(g, m); o.name = name; o.position.set(x, y, z); parent.add(o); return o;
}
function empty(parent, name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent.add(o); return o; }

export function buildSampleGun() {
  const g = new THREE.Group(); g.name = 'sample_rifle';
  // 몸통 (원점 = 방아쇠 위, 총열 높이)
  box(g, 'receiver', 0.05, 0.07, 0.3, 0, -0.005, 0.0, M.body);
  box(g, 'receiver_low', 0.046, 0.03, 0.2, 0, -0.05, 0.0, M.body2);
  box(g, 'rail_top', 0.03, 0.012, 0.42, 0, 0.036, -0.08, M.dark);
  box(g, 'handguard', 0.056, 0.056, 0.22, 0, -0.002, -0.27, M.dark);
  cyl(g, 'barrel', 0.009, 0.1, 0, 0, -0.42, M.metal);
  cyl(g, 'muzzle_brake', 0.014, 0.05, 0, 0, -0.495, M.metal);
  box(g, 'pistol_grip', 0.032, 0.1, 0.045, 0, -0.095, 0.06, M.body2, 0.3);
  box(g, 'trigger_guard', 0.008, 0.008, 0.07, 0, -0.07, 0.02, M.body);
  box(g, 'skill_core', 0.004, 0.016, 0.07, 0.026, 0.0, -0.03, M.core); // 스킬 코어: 옆면에 빛나는 줄
  box(g, 'selector', 0.004, 0.008, 0.008, 0.026, -0.02, 0.05, M.accent);
  // 따로 움직이는 부품
  const mag = empty(g, 'part_mag', 0, -0.035, -0.05);           // 원점 = 탄창 윗면
  box(mag, 'mag_body', 0.028, 0.14, 0.06, 0, -0.07, -0.006, M.dark, -0.12);
  const stock = empty(g, 'part_stock', 0, -0.01, 0.15);          // 원점 = 몸통과 붙는 곳
  box(stock, 'stock_body', 0.04, 0.08, 0.2, 0, 0, 0.1, M.body2);
  box(stock, 'stock_pad', 0.045, 0.11, 0.025, 0, -0.01, 0.21, M.dark);
  const front = empty(g, 'part_irons_front', 0, 0.042, -0.33);
  box(front, 'front_post', 0.004, 0.03, 0.006, 0, 0.015, 0, M.dark);
  const rear = empty(g, 'part_irons_rear', 0, 0.042, 0.09);
  box(rear, 'rear_l', 0.005, 0.03, 0.008, -0.009, 0.015, 0, M.dark); box(rear, 'rear_r', 0.005, 0.03, 0.008, 0.009, 0.015, 0, M.dark);
  // 부착 지점 (빈 물체)
  empty(g, 'socket_ads', 0, 0.064, 0.09);      // 가늠자 구멍 높이 (가늠쇠 끝과 같은 높이)
  empty(g, 'socket_muzzle', 0, 0, -0.52);
  empty(g, 'socket_hand_r', 0, -0.085, 0.07);
  empty(g, 'socket_hand_l', 0, -0.045, -0.26);
  empty(g, 'socket_optic', 0, 0.042, -0.02);
  empty(g, 'socket_grip', 0, -0.03, -0.27);
  return g;
}

// 예시 총을 .glb 로 (Blender 에서 내보낸 것과 같은 형태)
export async function sampleGunGlb() {
  return new GLTFExporter().parseAsync(buildSampleGun(), { binary: true });
}
