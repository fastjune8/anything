// 맵 목록. 맵 데이터는 content/maps/*.json (에디터가 만든다), 목록은 content/maps/index.json.
// 서버와 브라우저 모두 JSON 모듈로 불러온다. getMap(id) 는 맵 배치를 한 번만 펼쳐 재사용한다.
import ids from '../../content/maps/index.json' with { type: 'json' };
import { buildLayout } from './build.js';
import { checkMap } from '../content/schema.js';

const defs = await Promise.all(ids.map(id => import(`../../content/maps/${id}.json`, { with: { type: 'json' } }).then(m => m.default)));
const DEFS = Object.fromEntries(defs.map(d => [d.id, d]));
for (const d of defs) {
  const errors = checkMap(d);
  if (errors.length) throw new Error(`맵 데이터 오류 (content/maps/${d.id}.json):\n  ` + errors.join('\n  '));
}
const built = new Map();

// 반환: { id, name, half, spawns, zones, objects, layout: { boxes, trees, colliders } }
export function getMap(id) {
  if (!built.has(id)) {
    const def = DEFS[id];
    if (!def) throw new Error(`없는 맵: ${id}`);
    built.set(id, { zones: [], ...def, layout: buildLayout(def) });
  }
  return built.get(id);
}
export const MAP_IDS = Object.keys(DEFS);
