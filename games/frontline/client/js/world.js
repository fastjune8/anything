import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetModel } from './mapassets.js';
import { rng, canvasTex } from './world/proctex.js';
import { drawMat } from './world/matstyle.js';
import { presetOf, derivedMaps } from './world/materials.js';
import { INDOOR, INDOOR_BOXES, MAX_INDOOR, patchIndoor } from './world/indoor.js';
import { boxGeo, rampGeo } from './world/geometry.js';

export { MAT_PRESETS } from './world/materials.js';

// 월드(하늘·빛·그림자·지면·맵 물체)를 장면에 만든다. 절차적 텍스처·재질·실내 조명·지오메트리는 world/ 아래 모듈이 맡고, 여기는 그것들을 조립한다.
// (게임과 스튜디오가 같은 코드로 그린다 — 에디터에서 본 그대로 게임에 나온다)
const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };

// 하늘·조명·지면·먼 산을 만들고, 맵(구조물)은 setMap(layout) 으로 올린다. layout = shared/maps 의 { boxes, trees, colliders }
// look = content/looks.json 의 분위기 하나. 나중에 setLook 으로 바꿀 수 있다 (스튜디오에서 고치는 즉시 보기)
// opts.fogScale: 안개 짙기 배율 (맵 에디터는 위에서 내려다보므로 옅게)
export function buildWorld(scene, renderer, look, opts = {}) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let textures = {}, derived = {}, MAT_DEF = {};
  const matCache = new Map();
  const getMat = (name, tint) => {
    const key = name + ':' + (tint ?? '');
    if (matCache.has(key)) return matCache.get(key);
    const d = MAT_DEF[name] || MAT_DEF.concrete;
    const tex = textures[name] || textures.concrete;
    const P = presetOf(name, d), dm = derived[name] || derived.concrete;
    const m = new THREE.MeshStandardMaterial({ // 색 + Normal + Roughness/Metalness (값은 맵에 들어 있으므로 배율 1)
      map: tex, normalMap: dm.normal, normalScale: new THREE.Vector2(d.bump * P.nrm, d.bump * P.nrm),
      roughnessMap: dm.orm, metalnessMap: dm.orm, roughness: 1, metalness: 1,
      envMapIntensity: P.env, color: tint ?? 0xffffff,
    });
    patchIndoor(m);
    matCache.set(key, m);
    return m;
  };

  // ── 하늘 / 조명 (값은 setLook 에서) ──
  const sunDir = new THREE.Vector3();
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  const envScene = new THREE.Scene();
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(3000, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }));
  envGround.position.y = -2; envScene.add(envGround);
  const _grey = new THREE.Color(0.32, 0.32, 0.32); // 땅빛 채도를 눌러서 그늘·천장이 갈색으로 물들지 않게
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xb4bcc2, 0.0042);

  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 320;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const fill = new THREE.HemisphereLight(0xbfd4ea, 0x5a5140, 0.55);
  scene.add(fill);

  // ── 지면 ──
  // 64×64 칸으로 나눠 꼭짓점 색에 큰 규모의 밝기·색 변화를 싣는다 (같은 텍스처가 14m 마다 반복돼 보이는 것을 가린다) → paintGround
  const GSEG = 64;
  const groundGeo = new THREE.PlaneGeometry(600, 600, GSEG, GSEG);
  groundGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((GSEG + 1) * (GSEG + 1) * 3).fill(1), 3));
  const ground = new THREE.Mesh(groundGeo);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── 먼 산 ──  (가까운 줄 26개 + 더 멀고 크고 옅은 줄 14개: 안개 속에서 겹겹이 깊이가 생긴다)
  const r = rng(99);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  const hillFarMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  let leafMats = [], leafKey = '';
  for (let i = 0; i < 40; i++) {
    const far = i >= 26, a = far ? ((i - 26) / 14) * Math.PI * 2 + r() * 0.3 : (i / 26) * Math.PI * 2 + r() * 0.2;
    const dist = far ? 480 + r() * 90 : 330 + r() * 120, h = far ? 45 + r() * 45 : 22 + r() * 40;
    const hill = new THREE.Mesh(new THREE.ConeGeometry((far ? 150 : 100) + r() * 90, h, 9, 2), far ? hillFarMat : hillMat);
    const pos = hill.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) + (r() - 0.5) * 22, pos.getY(k) + (r() - 0.5) * 6, pos.getZ(k) + (r() - 0.5) * 22);
    hill.geometry.computeVertexNormals();
    hill.position.set(Math.cos(a) * dist, h / 2 - 3, Math.sin(a) * dist);
    scene.add(hill);
  }

  // ── 구조물 / 나무: 맵마다 다르므로 setMap 으로 통째로 갈아 끼운다 ──
  const mapGroup = new THREE.Group();
  scene.add(mapGroup);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
  let lastLayout = null, current = null, groundMat = null;

  // 분위기 바꾸기: 빛·하늘·안개·재질을 다시 만들고, 올려 둔 맵을 다시 그린다
  // only: 다시 만들 재질 이름 목록 (없으면 전부, [] = 빛·하늘만). 분위기 에디터가 고친 것만 빨리 다시 그릴 때
  function setLook(lk, only) {
    current = lk;
    MAT_DEF = lk.materials;
    const names = only || Object.keys(lk.materials);
    if (!only) { for (const t of Object.values(textures)) t.dispose(); for (const x of Object.values(derived)) { x.normal.dispose(); x.orm.dispose(); } textures = {}; derived = {}; }
    for (const [key, m] of [...matCache]) if (!only || names.includes(key.split(':')[0])) { m.dispose(); matCache.delete(key); }
    for (const k of names) {
      if (textures[k]) textures[k].dispose();
      textures[k] = canvasTex(k === 'ground' ? 1024 : 512, drawMat(k, lk.materials[k]), aniso);
      if (derived[k]) { derived[k].normal.dispose(); derived[k].orm.dispose(); }
      derived[k] = derivedMaps(textures[k].image, lk.materials[k], presetOf(k, lk.materials[k]), aniso);
    }
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - lk.sun.elev), THREE.MathUtils.degToRad(lk.sun.azim));
    u.turbidity.value = lk.sky.turbidity; u.rayleigh.value = lk.sky.rayleigh; u.mieCoefficient.value = lk.sky.mie; u.mieDirectionalG.value = lk.sky.mieG;
    u.sunPosition.value.copy(sunDir);
    sun.color.set(lk.sun.color); sun.intensity = lk.sun.intensity; sun.position.copy(sunDir).multiplyScalar(150);
    fill.color.set(lk.fill.sky); fill.groundColor.set(lk.fill.ground); fill.intensity = lk.fill.intensity;
    scene.fog.color.set(lk.fog.color); scene.fog.density = lk.fog.density * (opts.fogScale ?? 1);
    // 주변 반사: 하늘을 한 번 찍어서
    envGround.material.color.set(lk.fill.ground).lerp(_grey, 0.55).multiplyScalar(lk.envGround ?? 0); envGround.visible = (lk.envGround ?? 0) > 0; // 반사 아래쪽 = 땅 (없으면 하늘 셰이더의 지평선 아래)
    scene.remove(sky); envScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (scene.environment) scene.environment.dispose();
    scene.environment = pmrem.fromScene(envScene, 0, 1, 5000).texture;
    pmrem.dispose();
    envScene.remove(sky); scene.add(sky);
    scene.environmentIntensity = lk.env;
    renderer.toneMappingExposure = lk.exposure;
    renderer.toneMapping = TONE[lk.tone] ?? THREE.ACESFilmicToneMapping;
    INDOOR.uIndoorAmb.value = lk.indoor?.ambient ?? 1;
    INDOOR.uIndoorCol.value.set(lk.indoor?.color || '#ffffff').multiplyScalar(lk.indoor?.intensity ?? 0);
    hillMat.color.set(lk.hills);
    hillFarMat.color.set(lk.hills).lerp(new THREE.Color(lk.fog.color), 0.4); // 먼 줄은 안개색 쪽으로 옅게
    const leavesChanged = JSON.stringify(lk.leaves) !== leafKey;
    if (leavesChanged) { // 나뭇잎 색이 바뀌었을 때만 (나무가 쓰던 재질을 버리므로 맵을 다시 그린다)
      for (const m of leafMats) m.dispose();
      leafMats = lk.leaves.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
      leafKey = JSON.stringify(lk.leaves);
    }
    const gt = textures.ground, gTile = MAT_DEF.ground.tile || 14;
    gt.repeat.set(600 / gTile, 600 / gTile);
    if (groundMat) groundMat.dispose();
    groundMat = patchIndoor(getMat('ground').clone()); groundMat.vertexColors = true; // 꼭짓점 색(paintGround)을 곱한다. 재질은 지면 전용 복제본
    ground.material = groundMat;
    if (lastLayout && (!only || names.some(k => k !== 'ground') || leavesChanged)) setMap(lastLayout);
  }

  // ── 그림자 대상 줄이기 ──
  // 그림자 맵은 카메라 뒤·옆에 있는 물체까지 매번 다시 그린다. 그런데 어떤 물체의 그림자가 화면에 보이려면
  // 그 물체를 해의 반대 방향으로 바닥까지 늘린 모양(그림자 기둥)이 카메라 시야에 걸려야 한다. 안 걸리면 이번 프레임
  // 그림자 맵에서 뺀다 (castShadow=false). 매 프레임 다시 계산하므로 캐릭터·카메라가 움직여도 그림자는 그대로 따라온다.
  // shadowMap.autoUpdate 나 그림자 카메라·해상도는 건드리지 않는다. api.shadowCull=false 로 끄면 예전과 같다.
  let shadowFloor = 0;
  const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _bx = new THREE.Box3(), _bx2 = new THREE.Box3(), _sv = new THREE.Vector3();
  let cullOn = true;
  const SHADOW_MARGIN = 2; // m, 부드러운 그림자 가장자리와 부동소수 오차 여유
  function casts(box) {
    if (!cullOn) return true;
    const t = Math.max(0, box.max.y - shadowFloor) / Math.max(sunDir.y, 0.05); // 해 반대 방향으로 바닥에 닿기까지의 길이
    _bx.copy(box).expandByScalar(SHADOW_MARGIN);
    _bx2.copy(_bx).translate(_sv.copy(sunDir).multiplyScalar(-t));
    return _fr.intersectsBox(_bx.union(_bx2));
  }
  // 렌더 직전에 호출. bodies(casts) 는 움직이는 물체(캐릭터)가 자기 박스로 casts 를 불러 판정하는 콜백
  function beginShadowCull(cam, bodies) {
    cullOn = api.shadowCull;
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    let on = 0, total = 0;
    for (const m of mapGroup.children) {
      if (!m.userData.cs) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const c = casts(m.geometry.boundingBox);
      if (m.castShadow !== c) m.castShadow = c;
      total++; if (c) on++;
    }
    api.shadowStats.staticTotal = total; api.shadowStats.staticOn = on;
    if (bodies) bodies(casts);
  }

  // 정적 구조물·나무는 그리기 호출을 줄이려고 (재질 × 그림자 설정 × 공간 칸) 별로 지오메트리를 합쳐 한 메쉬로 만든다.
  // 충돌·총알은 layout.colliders 만 쓰므로 여기(눈에 보이는 모양)와 무관하다. 칸 단위로 합쳐서 칸 단위 프러스텀 컬링이 유지된다.
  // MERGE_CELL 보다 긴 물체(외곽 벽 등)는 합치면 컬링 범위만 넓어지므로 따로 둔다.
  const MERGE_CELL = 40;
  const mapStats = { sources: 0, meshes: 0, merged: 0, unmerged: 0, assetMeshes: 0, assetTris: 0 };

  // 지면 꼭짓점 색: ① 아주 큰 얼룩(밝기·따뜻함이 수십 m 마다 조금씩 달라진다) ② 플레이 공간 바깥은 어둡고 채도를 뺀다 (싸우는 곳과 배경을 가른다)
  // half = 플레이 공간 반지름(외곽 벽 안쪽 면). 값은 1 주변이라 재질 색을 거의 안 바꾼다
  const _gc = new THREE.Color();
  function paintGround(half) {
    const pos = groundGeo.attributes.position, col = groundGeo.attributes.color;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = -pos.getY(k);
      const n1 = 0.5 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.037 + 0.4) + 0.3 * Math.sin(x * 0.11 + z * 0.09 + 2) + 0.2 * Math.sin(z * 0.17 - x * 0.05);
      const n2 = Math.sin(x * 0.027 - 0.8) * Math.sin(z * 0.031 + 1.9);
      let rr = 1 + 0.07 * n1 + 0.04 * n2, gg = 1 + 0.07 * n1 - 0.01 * n2, bb = 1 + 0.07 * n1 - 0.05 * n2;
      const out = sm(0, 16, Math.max(Math.abs(x), Math.abs(z)) - half); // 0 = 안, 1 = 바깥
      const lum = (rr + gg + bb) / 3, desat = 0.45 * out, dark = 1 - 0.18 * out;
      rr = (rr + (lum - rr) * desat) * dark; gg = (gg + (lum - gg) * desat) * dark; bb = (bb + (lum - bb) * desat) * dark;
      _gc.setRGB(rr, gg, bb); col.setXYZ(k, _gc.r, _gc.g, _gc.b);
    }
    col.needsUpdate = true;
  }

  // glb 재질: 이름으로 프리셋을 골라 반사 세기를 맞추고 실내 조명을 넣는다 (텍스처는 glb 것 그대로, 한 번만)
  const tunedAssets = new WeakSet();
  function tuneAssetMat(m) {
    if (tunedAssets.has(m)) return;
    tunedAssets.add(m);
    const key = (m.name || '').replace(/^NS_/, ''), P = presetOf(key);
    if (key === 'Glass') { m.envMapIntensity = P.env; m.depthWrite = false; m.roughness = Math.max(m.roughness, 0.08); }
    else m.envMapIntensity = P.env;
    patchIndoor(m);
  }

  function setMap(layout) {
    lastLayout = layout;
    { let half = 0; for (const b of layout.boxes) if (!b.invisible && b.h >= 4) half = Math.max(half, Math.abs(b.x) - b.w / 2, Math.abs(b.z) - b.d / 2); paintGround(half > 20 ? half : 56); } // 외곽 벽 안쪽 면
    for (const child of [...mapGroup.children]) { // 이전 맵 치우기 (재질은 공유하므로 모양만 해제)
      mapGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
    // 그림자 카메라를 플레이 공간에 맞춘다 (같은 4096 맵으로 더 촘촘한 그림자). 바깥 산·나무는 원래 그림자 밖
    { let ext = 0; for (const b of layout.boxes) if (!b.invisible) ext = Math.max(ext, Math.abs(b.x) + b.w / 2, Math.abs(b.z) + b.d / 2);
      const R = Math.min(80, Math.max(30, ext + 6)); sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.updateProjectionMatrix(); }
    INDOOR.uIndoorN.value = 0;
    shadowFloor = 0;
    for (const b of layout.boxes) if (!b.invisible && b.y < shadowFloor) shadowFloor = b.y; // 그림자를 받을 수 있는 가장 낮은 면
    const groups = new Map(); // key → { mat, cast, recv, geoms }
    mapStats.sources = 0; mapStats.meshes = 0; mapStats.merged = 0; mapStats.unmerged = 0; mapStats.assetMeshes = 0; mapStats.assetTris = 0;
    // 시각 모델(.glb): 불러온 것만. replacedBy 가 가리키는 모델이 있으면 그 박스의 눈에 보이는 모양은 건너뛴다 (충돌 박스는 layout.colliders 가 따로 갖는다)
    const assetGeos = []; // 모델 메쉬도 아래 emit 으로 (재질 × 그림자 × 공간 칸) 묶음에 합친다 — 같은 이름 재질은 모델끼리 공유하므로(mapassets.js) 모델이 늘어도 그리기 호출이 덜 는다
    const placed = new Set(), _am = new THREE.Matrix4(), _aq = new THREE.Quaternion(), _ae = new THREE.Euler();
    for (const a of layout.assets || []) {
      const model = assetModel(a.id);
      if (!model) continue;
      placed.add(a.id);
      _am.compose(_sv.set(a.x, a.y, a.z), _aq.setFromEuler(_ae.set(0, -THREE.MathUtils.degToRad(a.rot || 0), 0)), new THREE.Vector3(a.s || 1, a.s || 1, a.s || 1));
      const ib = INDOOR_BOXES[a.id];
      if (ib && INDOOR.uIndoorN.value < MAX_INDOOR) { // 실내 상자도 같은 변환으로 (180° 대칭 복제 포함)
        _bx.set(new THREE.Vector3(...ib.min), new THREE.Vector3(...ib.max)).applyMatrix4(_am);
        const n = INDOOR.uIndoorN.value++; INDOOR.uIndoorMin.value[n].copy(_bx.min); INDOOR.uIndoorMax.value[n].copy(_bx.max);
      }
      model.traverse(o => {
        if (!o.isMesh) return;
        const mats = [].concat(o.material);
        for (const m of mats) tuneAssetMat(m);
        for (const m of mats) for (const k of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) if (m[k] && m[k].anisotropy < aniso) { m[k].anisotropy = aniso; m[k].needsUpdate = true; }
        const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(_am, o.matrixWorld)); // 위치를 구워 넣어야 그림자 컬이 박스를 바로 쓴다
        const cast = a.shadow !== 'none' && !/^NS_/.test(o.name) && !mats.some(m => m.transparent);
        assetGeos.push([geo, o.material, a.x, a.z, cast, !mats.some(m => m.transparent)]);
        mapStats.assetMeshes++; mapStats.assetTris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      });
    }
    // 모양(위치까지 구워 넣은 지오메트리)을 내놓는다. big 이면 합치지 않고 바로 메쉬로
    const emit = (geo, mat, x, z, cast, recv, big) => {
      mapStats.sources++;
      if (big) {
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = cast; mesh.receiveShadow = recv; mesh.userData.cs = cast;
        mapGroup.add(mesh); mapStats.meshes++; mapStats.unmerged++;
        return;
      }
      const key = Math.floor(x / MERGE_CELL) + ',' + Math.floor(z / MERGE_CELL) + '|' + mat.uuid + '|' + cast + recv;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { mat, cast, recv, geoms: [] });
      g.geoms.push(geo);
    };
    for (const [geo, mat, x, z, cast, recv] of assetGeos) emit(geo, mat, x, z, cast, recv, false);
    const r = rng(99);
    for (const b of layout.boxes) {
      if (b.invisible || (b.swap && placed.has(b.swap))) continue;
      const d = MAT_DEF[b.mat] || MAT_DEF.concrete;
      let geo;
      if (b.shape === 'cyl') geo = new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 18);
      else if (b.shape === 'ramp') geo = rampGeo(b.w, b.h, b.d, b.ramp, d.tile);
      else geo = boxGeo(b.w, b.h, b.d, b.fit ? 0 : d.tile);
      geo.translate(b.x, b.y + b.h / 2, b.z);
      emit(geo, getMat(b.mat, b.tint), b.x, b.z, !b.noShadow, true, Math.max(b.w, b.d) > MERGE_CELL); // noShadow: 얇은 건축 장식은 그림자를 던지지 않는다 (받기는 한다)
    }

    // ── 나무 ──
    for (const t of layout.trees) {
      const s = t.s;
      const trunk = new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 5 * s, 7);
      trunk.translate(t.x, 2.5 * s, t.z);
      emit(trunk, trunkMat, t.x, t.z, true, false, false);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.IcosahedronGeometry((1.3 + r() * 0.9) * s, 1);
        const pos = leaf.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const j = 1 + (Math.sin(pos.getX(k) * 12.9 + pos.getY(k) * 78.2 + pos.getZ(k) * 37.7) * 0.5) * 0.3;
          pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) * j * 0.85, pos.getZ(k) * j);
        }
        leaf.computeVertexNormals();
        leaf.translate(t.x + (r() - 0.5) * 2.2 * s, (4.2 + r() * 2.4) * s, t.z + (r() - 0.5) * 2.2 * s);
        emit(leaf, leafMats[i % leafMats.length], t.x, t.z, true, false, false);
      }
    }

    for (const g of groups.values()) {
      let merged = g.geoms[0];
      if (g.geoms.length > 1) {
        const mixed = g.geoms.some(x => x.index) && g.geoms.some(x => !x.index); // 인덱스 유무가 섞이면 합칠 수 없다
        const list = mixed ? g.geoms.map(x => x.index ? x.toNonIndexed() : x) : g.geoms;
        merged = mergeGeometries(list, false);
        if (merged) { for (const x of g.geoms) x.dispose(); if (mixed) for (const x of list) x.dispose(); }
      }
      if (merged) {
        const mesh = new THREE.Mesh(merged, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.recv; mesh.userData.cs = g.cast;
        mapGroup.add(mesh); mapStats.meshes++; mapStats.merged += g.geoms.length;
      } else { // 속성이 맞지 않아 합치지 못하면 하나씩 (일어나지 않아야 한다)
        for (const x of g.geoms) { const mesh = new THREE.Mesh(x, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.recv; mesh.userData.cs = g.cast; mapGroup.add(mesh); mapStats.meshes++; mapStats.unmerged++; }
      }
    }
  }

  setLook(look);
  const api = { setMap, setLook, sunDir, mapStats, beginShadowCull, shadowCull: true, shadowStats: { staticTotal: 0, staticOn: 0 }, get look() { return current; } };
  return api;
}
