// 맵 시각 모델(.glb): content/assets/index.json 에 적힌 id 의 content/assets/<id>.glb 를 불러둔다.
//   Blender → GLB 규칙은 docs/ENV_ASSET_PIPELINE.md. 충돌은 이 모델과 무관하다 (shared/maps 의 충돌 박스가 맡는다).
//   불러오지 못하면 조용히 건너뛴다 → 맵 데이터의 replacedBy 가 가리키는 박스(예전 모양)가 그대로 보인다.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const models = new Map(); // id → 불러온 scene (월드가 메쉬마다 위치·회전을 구워서 쓴다. 재질·텍스처는 공유)
try {
  const ids = await (await fetch('/content/assets/index.json', { cache: 'no-cache' })).json();
  const loader = new GLTFLoader();
  await Promise.all(ids.map(async id => {
    try {
      const scene = (await loader.loadAsync(`/content/assets/${id}.glb`)).scene;
      scene.updateMatrixWorld(true);
      models.set(id, scene);
    } catch (e) { console.warn(`시각 모델을 불러오지 못해 박스 모양을 씁니다: ${id}`, e); }
  }));
  shareMaterials(ids);
} catch (e) { console.warn('시각 모델 목록을 불러오지 못했습니다', e); }

// 같은 이름의 재질(Concrete·PaintedMetal·BareMetal·Wood·Glass)은 모든 모델이 하나를 같이 쓴다.
//   에셋 스크립트가 모두 같은 make_materials()·같은 텍스처로 내보내므로 내용이 같다 (tests/assets.test.mjs 가 확인한다).
//   → GPU 텍스처가 모델 수만큼 늘지 않고, world.js 가 재질별로 지오메트리를 합칠 수 있어 그리기 호출도 덜 는다
function shareMaterials(ids) {
  const keep = new Map(), drop = new Set();
  for (const id of ids) {
    const scene = models.get(id);
    if (!scene) continue;
    scene.traverse(o => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      const m = o.material, key = m.name + (m.vertexColors ? ':vc' : '');
      if (!m.name) return;
      const k = keep.get(key);
      if (!k) keep.set(key, m);
      else if (k !== m) { drop.add(m); o.material = k; }
    });
  }
  for (const m of drop) {
    for (const t of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[t] && ![...keep.values()].some(k => k[t] === m[t])) m[t].dispose();
    m.dispose();
  }
}

export const assetModel = id => models.get(id) || null;
