// 파츠 모델(.glb): content/parts/index.json 에 적힌 파츠는 content/parts/<id>.glb 를 불러와
// guns.js 의 setGunParts 가 코드로 만든 파츠(상자·원통) 대신 쓴다. 불러오지 못하면 코드 파츠를 그대로 쓴다.
//   규칙: docs/GUN_MODELING.md 10 (원점 = 총에 붙는 곳, socket_sight = 조준선 높이, socket_muzzle = 새 총구 끝)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import index from '/content/parts/index.json' with { type: 'json' };
import { dressMaterial } from './gunmat.js';

const loaded = new Map(); // 파츠 id → 원본 (달 때마다 복제한다. 모양·재질은 원본과 공유)
const loader = new GLTFLoader();
const keyOf = name => { const n = String(name || '').toLowerCase(); return n.startsWith('socket_') ? n.slice(7).replace(/[._]?\d+$/, '') : null; };

await Promise.all(index.map(async id => {
  try {
    const scene = (await loader.loadAsync(`/content/parts/${id}.glb`)).scene;
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.userData.sharedGeo = true; // 여러 총이 같은 모양을 쓰므로 뗄 때 지우지 않는다
      for (const m of [].concat(o.material)) dressMaterial(m); // 색 칸 재질 값 (총과 같은 기준)
    });
    loaded.set(id, scene);
  } catch (e) { console.warn(`파츠 모델을 불러오지 못해 코드로 만든 파츠를 씁니다: ${id}`, e); }
}));

// 파츠 모델 복제 + 부착 지점. 없으면 null
//   root: 원점 = 총에 붙는 곳. sockets.sight / sockets.muzzle 의 position 은 root 기준 (게임 축: 위 +Y, 앞 -Z)
export function partModel(id) {
  const src = loaded.get(id);
  if (!src) return null;
  const root = src.clone(true), sockets = {};
  root.traverse(o => { const k = keyOf(o.name); if (k) sockets[k] = o; });
  return { root, sockets };
}
