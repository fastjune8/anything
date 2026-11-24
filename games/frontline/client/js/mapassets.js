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
} catch (e) { console.warn('시각 모델 목록을 불러오지 못했습니다', e); }

export const assetModel = id => models.get(id) || null;
