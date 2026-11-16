// 데이터로 등록된 총 모델(content/models.json)을 게임에 자동으로 쓴다.
// 무기 데이터(content/weapons.json)에 model 이 있으면, 처음 한 번 그 .glb 를 불러와 두고
// guns.js 의 buildGun 이 코드로 만든 총 대신 이 모델로 총을 만든다 (1인칭 · 다른 플레이어 · 무기고 벽 모두).
// 불러오지 못하면 코드로 만든 총을 그대로 쓴다.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS } from '/shared/weapons.js';
import registry from '/content/models.json' with { type: 'json' };

const loaded = new Map(); // 무기 id → 원본 모델 (총을 만들 때마다 복제해서 쓴다)
const loader = new GLTFLoader();

await Promise.all(WEAPONS.filter(w => w.model).map(async w => {
  const reg = registry.find(m => m.id === w.model);
  if (!reg) return;
  try { loaded.set(w.id, (await loader.loadAsync(`/content/${reg.file}`)).scene); }
  catch (e) { console.warn(`총 모델을 불러오지 못해 코드로 만든 총을 씁니다: ${reg.file}`, e); }
}));

// 이 무기의 등록 모델 (없으면 null)
export const modelFor = weaponId => loaded.get(weaponId) || null;
export const modelIdFor = weaponId => (loaded.has(weaponId) ? WEAPONS.find(w => w.id === weaponId).model : null);
