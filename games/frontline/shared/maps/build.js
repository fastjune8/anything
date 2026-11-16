// 맵 데이터(content/maps/*.json 의 objects 목록) → 박스·나무·충돌 박스로 펼친다.
// 서버·클라이언트·에디터가 모두 이 함수를 쓰므로, 에디터에서 보이는 그대로 게임에서 나온다. (THREE 의존 없음)
import { wallRun, building, container, crate, sandbags, barrier, barrel, tower, finishLayout } from './parts.js';

const tintNum = t => (typeof t === 'string' ? parseInt(t.replace('#', ''), 16) : t);
const alongX = o => (o.axis || 'x') === 'x';

// 물체 종류별로 박스를 만드는 방법. B(x, y, z, w, h, d, mat, extra), T(x, z, s) = 나무
// anchor: 회전(rot)의 중심
export const OBJECT_TYPES = {
  box: {
    build: (B, o) => B(o.x, o.y || 0, o.z, o.w, o.h, o.d, o.mat || 'concrete', boxExtra(o)),
    anchor: o => [o.x, o.z],
  },
  wall: { // 문·창문을 낼 수 있는 일자 벽. axis = 벽이 뻗는 방향, at = 고정 좌표, from~to = 뻗는 구간
    build: (B, o) => wallRun(B, alongX(o), o.at, o.from, o.to, o.h, o.t ?? 0.35, o.ops || [], o.mat || 'brick'),
    anchor: o => (alongX(o) ? [(o.from + o.to) / 2, o.at] : [o.at, (o.from + o.to) / 2]),
  },
  building: { // 네 벽 + (지붕). ops = { n, s, e, w: [{ at, w, type: door|window }] }, at 은 벽을 따라가는 절대 좌표
    build: (B, o) => building(B, o.x, o.z, o.w, o.d, o.h, o.mat || 'brick', { n: [], s: [], e: [], w: [], ...(o.ops || {}) }, !!o.roof),
    anchor: o => [o.x, o.z],
  },
  container: { build: (B, o) => container(B, o.x, o.z, alongX(o), tintNum(o.tint ?? '#596066'), o.y || 0), anchor: o => [o.x, o.z] },
  crate: { build: (B, o) => crate(B, o.x, o.z, o.s ?? 1.2, o.y || 0), anchor: o => [o.x, o.z] },
  sandbags: { build: (B, o) => sandbags(B, o.x, o.z, o.len ?? 4, alongX(o), o.h ?? 1.0), anchor: o => [o.x, o.z] },
  barrier: { build: (B, o) => barrier(B, o.x, o.z, alongX(o)), anchor: o => [o.x, o.z] },
  barrel: { build: (B, o) => barrel(B, o.x, o.z, tintNum(o.tint ?? '#35506b')), anchor: o => [o.x, o.z] },
  tower: { build: (B, o) => tower(B, o.x, o.z), anchor: o => [o.x, o.z] }, // 감시탑 (계단은 서쪽, rot 으로 돌린다)
  tree: { build: (B, o, T) => T(o.x, o.z, o.s ?? 1), anchor: o => [o.x, o.z] },
};

function boxExtra(o) {
  const e = {};
  if (o.tint !== undefined) e.tint = tintNum(o.tint);
  for (const k of ['fit', 'shape', 'noCollide', 'invisible']) if (o[k] !== undefined) e[k] = o[k];
  return e;
}

// 점 (x, z) 를 (cx, cz) 기준으로 rot 도(90 단위) 돌린다
function turn(x, z, cx, cz, rot) {
  const dx = x - cx, dz = z - cz;
  switch (((rot % 360) + 360) % 360) {
    case 90: return [cx - dz, cz + dx];
    case 180: return [cx - dx, cz - dz];
    case 270: return [cx + dz, cz - dx];
    default: return [x, z];
  }
}
const sideways = rot => ((((rot % 360) + 360) % 360) / 90) % 2 === 1;

// 물체 하나 → 박스·나무 목록. rot: 제자리 회전(90 단위), sym: 맵 중심 기준 반대편(180° 회전)에도 하나 더
export function expandObject(o) {
  const t = OBJECT_TYPES[o.type];
  if (!t) return { boxes: [], trees: [] };
  const boxes = [], trees = [];
  t.build((x, y, z, w, h, d, mat, extra) => boxes.push({ x, y, z, w, h, d, mat, ...(extra || {}) }), o, (x, z, s) => trees.push({ x, z, s }));
  const rot = o.rot || 0;
  if (rot) {
    const [cx, cz] = t.anchor(o);
    for (const b of boxes) {
      [b.x, b.z] = turn(b.x, b.z, cx, cz, rot);
      if (sideways(rot)) [b.w, b.d] = [b.d, b.w];
    }
    for (const tr of trees) [tr.x, tr.z] = turn(tr.x, tr.z, cx, cz, rot);
  }
  if (o.sym) {
    boxes.push(...boxes.map(b => ({ ...b, x: -b.x, z: -b.z })));
    trees.push(...trees.map(tr => ({ ...tr, x: -tr.x, z: -tr.z })));
  }
  return { boxes, trees };
}

// 맵 데이터 전체 → { boxes, trees, colliders }
export function buildLayout(def) {
  const boxes = [], trees = [];
  for (const o of def.objects || []) {
    const r = expandObject(o);
    boxes.push(...r.boxes); trees.push(...r.trees);
  }
  return finishLayout(boxes, trees);
}
