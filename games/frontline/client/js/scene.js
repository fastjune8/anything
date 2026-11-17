// 렌더러, 장면, 카메라, 1인칭 무기용 별도 장면
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld } from './world.js';
import { getMap } from '/shared/maps/index.js';
import { getLook } from '/shared/looks.js';
import { $, BASE_FOV, MODE_CFG } from './util.js';

export const canvas = $('view');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.autoClear = false;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 1500);
camera.rotation.order = 'YXZ';
export const world = buildWorld(scene, renderer, getLook(getMap(MODE_CFG.map).look));
export const colliders = []; // 현재 맵의 충돌 박스 (맵을 바꿀 때 내용만 교체하므로, 다른 모듈은 이 배열을 그대로 쓰면 된다)
export let currentMap = '';

// 1인칭 무기는 벽에 파묻히지 않게 별도 장면/카메라로 위에 덧그린다
export const vmScene = new THREE.Scene();
export const vmCam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
vmScene.environmentIntensity = 0.6;
const vmFill = new THREE.HemisphereLight(0xcfe0f0, 0x4a4234, 1.2);
vmScene.add(vmFill);
export const vmSun = new THREE.DirectionalLight(0xfff0d8, 2.6);
vmScene.add(vmSun);
export const vm = new THREE.Group();
vmScene.add(vm);
// 손에 든 총도 맵 분위기의 빛을 받는다 (해 색, 그늘 색).
// 반사 환경: 하늘만 비추면 금속이 밋밋하다 → 실내 조명 같은 환경(빛 상자들)을 반사시켜 금속·코팅이 반짝이게
let vmEnv = null;
function lightViewmodel(lk) {
  if (!vmEnv) vmEnv = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  vmScene.environment = vmEnv; vmScene.environmentIntensity = 0.55;
  vmSun.color.set(lk.sun.color);
  vmFill.color.set(lk.fill.sky); vmFill.groundColor.set(lk.fill.ground);
}

// 맵을 새로고침 없이 바꾼다 (로비에서 모드를 고르거나, 다른 모드의 방에 들어갈 때). 분위기도 맵 것으로
export function loadMap(id) {
  if (id === currentMap) return;
  const map = getMap(id), look = getLook(map.look);
  if (world.look !== look) world.setLook(look);
  world.setMap(map.layout);
  lightViewmodel(look);
  colliders.length = 0;
  colliders.push(...map.layout.colliders);
  currentMap = id;
}
loadMap(MODE_CFG.map);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = vmCam.aspect = w / h;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
