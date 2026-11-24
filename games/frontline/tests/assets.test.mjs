// 시각 모델(.glb) 가드 (P3-0, 서버·브라우저·Blender 없이, 1초 미만):
//  GLB 는 눈에 보이는 모양일 뿐이다. 충돌·총알·스폰은 맵 데이터의 박스가 맡고, 모델이 그것을 바꾸면 안 된다.
//  - 등록(content/assets/index.json) ↔ 파일 ↔ 맵의 asset 물체 · replacedBy 가 서로 맞는다
//  - asset 물체가 있어도 없어도 충돌 박스·스폰이 완전히 같다 (asset 은 안 보이는 선택 박스만 낸다)
//  - GLB 예산: 삼각형·파일 크기·텍스처 크기·재질 수·표준 재질만(확장 없음)·원점이 건물 가운데 바닥
//  Blender 에서 충돌과 맞는지(덮임·구멍·돌출·겹침)는 tools/blender/warehouse/check_fit.py 가 잰다.
import fs from 'node:fs';
import { check, failed } from './helpers.mjs';
import { buildLayout, expandObject } from '../shared/maps/build.js';
import { checkMap } from '../shared/content/schema.js';

const ROOT = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, ROOT));
const index = JSON.parse(read('content/assets/index.json'));
const MAPS = JSON.parse(read('content/maps/index.json'));
const BUDGET = { tris: 12000, bytes: 2 * 1024 * 1024, imageBytes: 1.2 * 1024 * 1024, imageSize: 512, materials: 6, meshes: 10 };

function glb(buf) {
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const binStart = 20 + len + 8;
  return { json, bin: buf.subarray(binStart) };
}
function imageSize(b) { // PNG / JPEG 헤더에서 가로·세로
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}

const mapDefs = Object.fromEntries(MAPS.map(id => [id, JSON.parse(read(`content/maps/${id}.json`))]));

for (const id of index) {
  const file = `content/assets/${id}.glb`;
  check(fs.existsSync(new URL(file, ROOT)), `${id}: ${file} 가 있다`);
  if (!fs.existsSync(new URL(file, ROOT))) continue;
  const buf = read(file);
  check(buf.subarray(0, 4).toString() === 'glTF', `${id}: GLB 파일이다`);
  const { json, bin } = glb(buf);
  let tris = 0; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const m of json.meshes) for (const p of m.primitives) {
    const pos = json.accessors[p.attributes.POSITION];
    tris += (p.indices !== undefined ? json.accessors[p.indices].count : pos.count) / 3;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos.min[k]); hi[k] = Math.max(hi[k], pos.max[k]); }
  }
  check(tris <= BUDGET.tris, `${id}: 삼각형 ${tris} ≤ ${BUDGET.tris}`);
  check(buf.length <= BUDGET.bytes, `${id}: 파일 ${(buf.length / 1024).toFixed(0)} KB ≤ ${BUDGET.bytes / 1024} KB`);
  check(json.materials.length <= BUDGET.materials, `${id}: 재질 ${json.materials.length}개 ≤ ${BUDGET.materials} (같은 재질은 공유한다)`);
  check(json.meshes.length <= BUDGET.meshes, `${id}: 메쉬 ${json.meshes.length}개 ≤ ${BUDGET.meshes} (그리기 호출을 줄이려고 재질·그림자 별로 합친다)`);
  check(!json.extensionsUsed, `${id}: glTF 확장 없음 (표준 재질로 불러와진다)`, JSON.stringify(json.extensionsUsed));
  check((json.nodes || []).every(n => !n.matrix && !n.translation && !n.rotation && !n.scale), `${id}: 노드에 변환이 없다 (위치는 맵 데이터가 정한다)`);
  let ib = 0, big = 0;
  for (const im of json.images || []) { const bv = json.bufferViews[im.bufferView]; const b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); ib += b.length; big = Math.max(big, ...imageSize(b)); }
  check(ib <= BUDGET.imageBytes, `${id}: 텍스처 ${(ib / 1024).toFixed(0)} KB ≤ ${(BUDGET.imageBytes / 1024).toFixed(0)} KB`);
  check(big <= BUDGET.imageSize, `${id}: 가장 큰 텍스처 ${big}px ≤ ${BUDGET.imageSize}px`);
  check(json.materials.filter(m => m.alphaMode === 'BLEND').length <= 1, `${id}: 투명 재질은 유리 하나만`);
  if (id === 'warehouse') { // 20 × 16 건물. 원점 = 건물 가운데 바닥. 바깥으로는 문 위 캐노피(머리 위 2.5 m 이상)가 1.05 m 까지 나간다
    check(lo[0] >= -11.1 && hi[0] <= 11.1 && lo[2] >= -9.1 && hi[2] <= 9.1, `warehouse: 바닥 면적이 충돌 건물(20×16) + 캐노피 1.05 m 안`, `x ${lo[0].toFixed(2)}~${hi[0].toFixed(2)} z ${lo[2].toFixed(2)}~${hi[2].toFixed(2)}`);
    check(lo[1] >= -0.01 && lo[1] <= 0.02, 'warehouse: 원점이 바닥 (가장 낮은 곳 y≈0)', lo[1].toFixed(3));
    check(hi[1] >= 4.45 && hi[1] <= 6.0, 'warehouse: 높이가 지붕(4.45)~6 m', hi[1].toFixed(2));
  }
}

// ── 맵 데이터 ↔ 충돌 ──
const withoutAssets = def => ({ ...def, objects: def.objects.filter(o => o.type !== 'asset').map(o => { const { replacedBy, ...r } = o; return r; }) });
for (const [id, def] of Object.entries(mapDefs)) {
  const L = buildLayout(def), L0 = buildLayout(withoutAssets(def));
  check(JSON.stringify(L.colliders) === JSON.stringify(L0.colliders), `${id}: asset·replacedBy 가 있어도 충돌 박스가 완전히 같다 (${L.colliders.length}개)`);
  check(checkMap(def).length === 0, `${id}: 맵 데이터 검사 통과`, checkMap(def).join(' / '));
  const assets = def.objects.filter(o => o.type === 'asset');
  check(assets.every(a => index.includes(a.id)), `${id}: asset 물체의 id 가 모두 등록돼 있다`, assets.map(a => a.id).join(','));
  const rep = def.objects.filter(o => o.replacedBy);
  check(rep.every(o => assets.some(a => a.id === o.replacedBy && Math.hypot(a.x - o.x, a.z - o.z) < 0.01)), `${id}: replacedBy 마다 같은 자리에 그 모델이 놓인다`);
  const pick = def.objects.filter(o => o.type === 'asset').flatMap(o => expandObject(o).boxes);
  check(pick.every(b => b.invisible && b.noCollide), `${id}: asset 은 안 보이는 선택 박스만 낸다 (충돌 없음)`);
  check(L.assets.length === assets.length, `${id}: 배치 목록 ${L.assets.length}개 = asset 물체 ${assets.length}개`);
}
const a0 = { type: 'asset', id: 'warehouse', x: 31, z: 0, w: 20, d: 16, h: 5 };
const r90 = expandObject({ ...a0, rot: 90 }), sym = expandObject({ ...a0, sym: true });
check(r90.assets.length === 1 && r90.assets[0].rot === 90, 'asset 회전(rot)은 모델 방향으로 넘어간다');
check(sym.assets.length === 2 && sym.assets[1].x === -31 && sym.assets[1].rot === 180, 'asset 대칭(sym)은 반대편에 180° 돌려 하나 더 놓는다');

process.exit(failed() ? 1 : 0);
