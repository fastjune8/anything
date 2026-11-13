// 맵 목록. getMap(id) 는 맵 배치를 한 번만 만들어 재사용한다.
import frontline from './frontline.js';
import warehouse from './warehouse.js';

const DEFS = { frontline, warehouse };
const built = new Map();

// 반환: { id, name, half, spawns, layout: { boxes, trees, colliders } }
export function getMap(id) {
  if (!built.has(id)) {
    const def = DEFS[id];
    if (!def) throw new Error(`없는 맵: ${id}`);
    built.set(id, { ...def, layout: def.build() });
  }
  return built.get(id);
}
export const MAP_IDS = Object.keys(DEFS);
