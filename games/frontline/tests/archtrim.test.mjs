// 건축 디테일 가드 (P2-2, 서버·브라우저 없이, 1초 미만):
//  벽·건물에 붙는 틀·기단·기둥·머리돌·지붕 띠는 눈에 보이는 장식일 뿐 충돌·총알·스폰·거점에 영향이 없어야 한다.
//  - 장식을 끈 맵(plain)과 켠 맵의 충돌 박스는 완전히 같다
//  - 새로 생긴 박스는 모두 noCollide, 재질은 그 맵 분위기(look)에 이미 있는 것만
//  - 장식은 어떤 충돌 박스에서도 0.13m 안에 있다 (공중에 뜨거나 크게 튀어나오지 않는다)
//  - 합치기(P1-5)를 깨는 40m 넘는 장식이 없다
import fs from 'node:fs';
import { check, failed } from './helpers.mjs';
import looks from '../content/looks.json' with { type: 'json' };
import { buildLayout, expandObject } from '../shared/maps/build.js';
import { checkMap } from '../shared/content/schema.js';

const MAPS = JSON.parse(fs.readFileSync(new URL('../content/maps/index.json', import.meta.url), 'utf8'));
const load = id => JSON.parse(fs.readFileSync(new URL(`../content/maps/${id}.json`, import.meta.url), 'utf8'));
const plainOf = def => ({ ...def, objects: def.objects.map(o => (o.type === 'wall' || o.type === 'building' ? { ...o, plain: true } : o)) });
const key = b => JSON.stringify(b);
const dist = (p, c) => { // 점과 충돌 박스(AABB) 사이 거리
  const dx = Math.max(c.minX - p[0], 0, p[0] - c.maxX), dy = Math.max(c.minY - p[1], 0, p[1] - c.maxY), dz = Math.max(c.minZ - p[2], 0, p[2] - c.maxZ);
  return Math.hypot(dx, dy, dz);
};

for (const id of MAPS) {
  const def = load(id), plain = buildLayout(plainOf(def)), full = buildLayout(def);
  console.log(`[${id}]`);
  check(JSON.stringify(plain.colliders) === JSON.stringify(full.colliders), `${id}: 충돌 박스 ${full.colliders.length}개가 장식을 켜도 꺼도 똑같다`);
  check(JSON.stringify(plain.boxes.filter(b => !b.noCollide)) === JSON.stringify(full.boxes.filter(b => !b.noCollide)), `${id}: 충돌·보이지 않는 박스 목록이 똑같다`);
  const seen = new Map(); for (const b of plain.boxes) seen.set(key(b), (seen.get(key(b)) || 0) + 1);
  const added = full.boxes.filter(b => { const k = key(b), n = seen.get(k) || 0; if (n) { seen.set(k, n - 1); return false; } return true; });
  check(added.every(b => b.noCollide === true && !b.invisible), `${id}: 새로 생긴 장식 ${added.length}개는 모두 충돌 없음(noCollide)`);
  const mats = new Set(Object.keys((looks.find(l => l.id === (def.look || looks[0].id)) || looks[0]).materials));
  check(added.every(b => mats.has(b.mat)), `${id}: 장식 재질은 이 맵 분위기(${def.look || looks[0].id})에 이미 있는 것만 쓴다`, [...new Set(added.map(b => b.mat))].join(','));
  check(added.every(b => Math.max(b.w, b.d) <= 38), `${id}: 합치기를 깨는 40m 넘는 장식이 없다`);
  const near = added.filter(b => b.h > 0.05).every(b => {
    const pts = []; for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) pts.push([b.x + sx * b.w / 2, b.y + sy * b.h, b.z + sz * b.d / 2]);
    return pts.every(p => full.colliders.some(c => dist(p, c) <= 0.13));
  });
  check(near, `${id}: 장식은 충돌 박스에서 0.13m 안에 있다 (뜨거나 크게 튀어나오지 않는다)`);
  const errs = checkMap(def);
  check(errs.length === 0, `${id}: 맵 데이터 검사 통과`, errs.slice(0, 2).join(' / '));
}

// 겹치는 면(z-fighting) 검사: 서로 다른 재질의 면이 같은 방향·같은 평면(오차 2mm)에서 넓이가 겹치고 다른 박스에 묻히지 않았다면 화면에서 계단 모양으로 깜빡인다.
// (P2-3: 지붕 밑면과 처마 띠가 같은 평면이라 창고 천장에 회색 계단이 비쳤다)
function coplanar(layout) {
  const E = 2e-3, B = layout.boxes.filter(b => !b.invisible && b.shape !== 'cyl' && b.shape !== 'ramp' && !b.ramp)
    .map(b => ({ ...b, lo: [b.x - b.w / 2, b.y, b.z - b.d / 2], hi: [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2] }));
  const inside = (p, a, c) => B.some(o => o !== a && o !== c && [0, 1, 2].every(k => p[k] > o.lo[k] + 1e-4 && p[k] < o.hi[k] - 1e-4));
  const hits = [];
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const A = B[i], C = B[j];
    if (A.mat === C.mat || [0, 1, 2].some(k => A.hi[k] < C.lo[k] - E || C.hi[k] < A.lo[k] - E)) continue;
    for (let ax = 0; ax < 3; ax++) for (const s of [0, 1]) {
      const pa = s ? A.hi[ax] : A.lo[ax];
      if (Math.abs(pa - (s ? C.hi[ax] : C.lo[ax])) > E || (ax === 1 && !s && pa < 0.001)) continue;
      const o = [0, 1, 2].filter(k => k !== ax), ov = o.map(k => [Math.max(A.lo[k], C.lo[k]), Math.min(A.hi[k], C.hi[k])]);
      if (ov.some(([l, h]) => h - l < 0.01) || (ov[0][1] - ov[0][0]) * (ov[1][1] - ov[1][0]) < 0.02) continue;
      const p = [0, 0, 0]; p[ax] = pa + (s ? E : -E); o.forEach((k, n) => { p[k] = (ov[n][0] + ov[n][1]) / 2; });
      if (!inside(p, A, C)) hits.push(`${A.mat}×${C.mat} ${'xyz'[ax]}${s ? '+' : '-'}=${pa.toFixed(2)} @${p.map(v => v.toFixed(1))}`);
    }
  }
  return hits;
}
for (const id of MAPS) { const h = coplanar(buildLayout(load(id))); check(h.length === 0, `${id}: 서로 다른 재질의 면이 같은 평면에서 겹치지 않는다 (z-fighting)`, h.slice(0, 3).join(' / ')); }

// outpost: 충돌 박스 233개, 바깥 벽 네 개는 예전 박스 그대로, 긴 벽에 기둥이 생겼다
const out = load('outpost'), L = buildLayout(out), plainOut = buildLayout(plainOf(out));
check(L.colliders.length === 233, `outpost 충돌 박스는 233개 (지금 ${L.colliders.length})`);
const C = (minX, maxX, minZ, maxZ) => L.colliders.some(c => c.minX === minX && c.maxX === maxX && c.minZ === minZ && c.maxZ === maxZ && c.minY === 0 && c.maxY === 5);
check(C(-57, 57, 56, 57) && C(-57, 57, -57, -56) && C(56, 57, -56, 56) && C(-57, -56, -56, 56), 'outpost 바깥 벽 네 개의 충돌 박스는 예전 박스 그대로');
const northPier = b => b.noCollide && b.mat === 'metal' && b.h > 4.5 && Math.abs(b.z - b.d / 2 - 55.9) < 0.01; // 안쪽 면(z=56)에서 0.1m 나온 기둥
const piersN = L.boxes.filter(northPier).length;
check(piersN >= 8, `114m 북쪽 바깥 벽에 기둥이 ${piersN}개 (8개 이상)`);
const widths = L.boxes.filter(northPier).map(b => b.w);
check(new Set(widths.map(w => w.toFixed(2))).size >= 5, '기둥 너비가 제각각이다 (반복 무늬 방지)');
const doors = out.objects.filter(o => o.type === 'wall' || o.type === 'building').flatMap(o => o.type === 'wall' ? o.ops || [] : Object.values(o.ops || {}).flat());
check(doors.filter(o => o.type === 'door').length === 22 && doors.filter(o => o.type === 'window').length === 13, `outpost 문 22개·창 13개 (지금 문 ${doors.filter(o => o.type === 'door').length}, 창 ${doors.filter(o => o.type === 'window').length})`);
check(L.boxes.length > plainOut.boxes.length, `장식 박스가 늘었다 (${plainOut.boxes.length} → ${L.boxes.length})`);

// 에디터: 회전·반대편 배치를 해도 장식은 따라가고 충돌이 없다
const w0 = { type: 'wall', axis: 'x', at: 0, from: -10, to: 10, h: 3, t: 0.4, mat: 'brick', ops: [{ at: 0, w: 2, type: 'door' }] };
const a = expandObject(w0), b = expandObject({ ...w0, rot: 90 }), s = expandObject({ ...w0, sym: true });
check(a.boxes.length === b.boxes.length && s.boxes.length === a.boxes.length * 2, '회전(rot)·대칭(sym)해도 박스 수가 맞다');
check(b.boxes.filter(x => !x.noCollide).length === a.boxes.filter(x => !x.noCollide).length, '회전해도 충돌 박스 수는 같다');
check(expandObject({ ...w0, plain: true }).boxes.every(x => !x.noCollide), 'plain 벽은 장식이 없다 (충돌 박스만)');
const one = expandObject({ ...w0, face: '+' }).boxes.filter(x => x.noCollide);
check(one.every(x => x.z >= -0.0001) , 'face "+" 면 장식이 +z 쪽에만 붙는다');

process.exit(failed() ? 1 : 0);
