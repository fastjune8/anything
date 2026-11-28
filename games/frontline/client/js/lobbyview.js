// 로비의 무기 3D 미리보기: 게임에 등록된 총 모델(.glb)을 그대로 불러와 천천히 흔들며 보여 주고, 끌면 돌려 볼 수 있다.
//   메인 화면(scene.js)과 따로 작은 렌더러를 쓴다 (로비 창이 보일 때만 그린다). 스킨은 modelrules.js 의 applySkin 으로 색 칸별 색을 입힌다.
//   총 모델은 guns.js 의 buildGun 으로 만든다 (1인칭 뷰모델과 같은 재질 처리, 단 재질은 이 화면 것만 따로 복제).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildGun } from './guns.js';
import { applySkin, SKINS } from './modelrules.js';

const PAIR = { akimbo: 0.2, kunai: 0.16 }; // 두 자루를 나란히 보여 주는 무기 (간격 m) — 실제로 양손에 하나씩 든다

export function createGunView(canvas, host) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x3a3a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(2.5, 3.5, 3); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6aa9ff, 1.4); rim.position.set(-3, 1.2, -2.5); scene.add(rim);

  const FOV = 26, camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  const pivot = new THREE.Group(); scene.add(pivot);
  const cache = new Map(); // 무기 id → { holder, size } (한 번 만든 총은 다시 쓴다)
  let cur = null, userYaw = 0, dragging = false, lastX = 0, w = 0, h = 0;

  function make(id) {
    const holder = new THREE.Group(), n = PAIR[id] ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const gun = buildGun(id, false);
      if (n === 2) gun.group.position.set((i ? -1 : 1) * PAIR[id] / 2, i ? 0.075 : -0.075, i ? -0.1 : 0.1); // 나란히, 위아래·앞뒤로 어긋나게 (옆에서 봐도 두 자루가 다 보인다)
      holder.add(gun.group);
    }
    pivot.add(holder); holder.visible = false;
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    for (const c of holder.children) c.position.sub(new THREE.Vector3(mid.x, mid.y, mid.z).setX(0)); // 길이(z)·높이(y) 가운데로 (좌우 x 는 쌍 간격 유지)
    const e = { holder, size: size.clone(), yaw: n === 2 ? 0.35 : 0 }; // 쌍으로 든 무기는 살짝 비스듬히 보여 준다
    cache.set(id, e); return e;
  }

  function fit() {
    if (!cur || !w || !h) return;
    const aspect = w / h, t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const lenZ = cur.size.z, hgt = Math.max(cur.size.y, 0.05);
    const dist = Math.max((lenZ * 0.56) / (t * aspect), (hgt * 0.85) / t) + cur.size.x * 0.5;
    camera.position.set(dist, hgt * 0.22, 0); // 총의 오른쪽 옆면을 본다 (총구가 화면 오른쪽)
    camera.lookAt(0, 0, 0);
    camera.aspect = aspect; camera.updateProjectionMatrix();
  }

  function resize() {
    const r = host.getBoundingClientRect(), nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
    if (nw === w && nh === h) return;
    w = nw; h = nh; renderer.setSize(w, h, false); fit();
  }
  new ResizeObserver(resize).observe(host); resize();

  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => { if (dragging) { userYaw += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
  const up = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => { userYaw = 0; });
  canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none';

  const t0 = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    if (!canvas.offsetParent || document.hidden || !cur) return; // 로비가 안 보이면(경기 중) 그리지 않는다
    if (!dragging && Math.abs(userYaw) > 0.001) userYaw *= 0.985;  // 놓으면 천천히 제자리로
    const t = (performance.now() - t0) / 1000;
    pivot.rotation.y = userYaw + cur.yaw + Math.sin(t * 0.55) * 0.5;
    pivot.position.y = Math.sin(t * 1.1) * 0.004;
    renderer.render(scene, camera);
  }
  frame();

  return {
    // 무기 id 와 스킨 이름(modelrules.js SKINS 의 키)으로 보여 준다
    show(id, skin) {
      const e = cache.get(id) || make(id);
      if (cur && cur !== e) cur.holder.visible = false;
      cur = e; e.holder.visible = true;
      applySkin(e.holder, SKINS[skin] || null);
      fit();
    },
  };
}
