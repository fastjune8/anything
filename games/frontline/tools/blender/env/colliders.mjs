// 맵 데이터에서 한 시각 모델이 대신하는 충돌 박스를 모델 원점 기준으로 뽑는다 (check_fit.py 입력)
//   node tools/blender/env/colliders.mjs <맵 id> <에셋 id> > /tmp/<에셋>_colliders.json
//   한 줄 = [가운데x, 바닥y, 가운데z, 너비, 높이, 깊이, (경사로면 {axis, up})]
import fs from 'node:fs';
import { buildLayout } from '../../../shared/maps/build.js';
const [mapId, id] = process.argv.slice(2);
const def = JSON.parse(fs.readFileSync(new URL(`../../../content/maps/${mapId}.json`, import.meta.url)));
const a = def.objects.find(o => o.type === 'asset' && o.id === id);
if (!a) throw new Error(`${mapId} 에 asset ${id} 가 없다`);
const L = buildLayout(def);
const out = L.boxes.filter(b => b.swap === id && !b.noCollide).map(b => [b.x - a.x, b.y - (a.y || 0), b.z - a.z, b.w, b.h, b.d, ...(b.ramp ? [b.ramp] : [])]);
console.log(JSON.stringify(out));
