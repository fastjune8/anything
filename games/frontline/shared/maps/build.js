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
    build: (B, o) => wallRun(B, alongX(o), o.at, o.from, o.to, o.h, o.t ?? 0.35, o.ops || [], o.mat || 'brick', o.plain ? false : { face: o.face === '+' ? 1 : o.face === '-' ? -1 : 0 }),
    anchor: o => (alongX(o) ? [(o.from + o.to) / 2, o.at] : [o.at, (o.from + o.to) / 2]),
  },
  asset: { // Blender 로 만든 시각 모델(.glb, content/assets). 충돌은 없다 — 충돌은 같은 자리의 박스·건물이 맡는다. 에디터에서 집을 수 있게 안 보이는 선택 박스만 낸다
    build: (B, o) => B(o.x, o.y || 0, o.z, o.w || 2, o.h || 2, o.d || 2, 'none', { noCollide: true, invisible: true }),
    anchor: o => [o.x, o.z],
  },
  building: { // 네 벽 + (지붕). ops = { n, s, e, w: [{ at, w, type: door|window }] }, at 은 벽을 따라가는 절대 좌표
    build: (B, o) => building(B, o.x, o.z, o.w, o.d, o.h, o.mat || 'brick', { n: [], s: [], e: [], w: [], ...(o.ops || {}) }, !!o.roof, !!o.plain),
    anchor: o => [o.x, o.z],
  },
  container: { build: (B, o) => container(B, o.x, o.z, alongX(o), tintNum(o.tint ?? '#596066'), o.y || 0), anchor: o => [o.x, o.z] },
  crate: { build: (B, o) => crate(B, o.x, o.z, o.s ?? 1.2, o.y || 0), anchor: o => [o.x, o.z] },
  sandbags: { build: (B, o) => sandbags(B, o.x, o.z, o.len ?? 4, alongX(o), o.h ?? 1.0), anchor: o => [o.x, o.z] },
  barrier: { build: (B, o) => barrier(B, o.x, o.z, alongX(o)), anchor: o => [o.x, o.z] },
  barrel: { build: (B, o) => barrel(B, o.x, o.z, tintNum(o.tint ?? '#56645a')), anchor: o => [o.x, o.z] },
  tower: { build: (B, o) => tower(B, o.x, o.z), anchor: o => [o.x, o.z] }, // 감시탑 (계단은 서쪽, rot 으로 돌린다)
  tree: { build: (B, o, T) => T(o.x, o.z, o.s ?? 1), anchor: o => [o.x, o.z] },

  // ───── 높이 요소 ─────
  // 경사로: 바닥 높이 y 에서 dir 쪽으로 h 만큼 올라가는 쐐기. len = 오르는 방향 길이, w = 폭. 걸어서 오르내린다
  ramp: {
    build: (B, o) => {
      const [axis, up] = DIRS[o.dir || 'n'], along = o.len ?? 6, across = o.w ?? 3;
      B(o.x, o.y || 0, o.z, axis === 'x' ? along : across, o.h ?? 3, axis === 'x' ? across : along, o.mat || 'concrete', { shape: 'ramp', ramp: { axis, up } });
    },
    anchor: o => [o.x, o.z],
  },
  // 계단: 경사로와 같은 크기 정보로, 한 단 0.3m 이하가 되도록 나눈 단 (밑은 꽉 차 있다)
  stairs: {
    build: (B, o) => {
      const [axis, up] = DIRS[o.dir || 'n'], along = o.len ?? 6, across = o.w ?? 2, h = o.h ?? 3, y = o.y || 0;
      const n = Math.max(1, Math.ceil(h / 0.3)), run = along / n, rise = h / n;
      for (let i = 0; i < n; i++) {
        const u = -along / 2 + run * (i + 0.5); // 낮은 쪽부터
        const cx = o.x + (axis === 'x' ? u * up : 0), cz = o.z + (axis === 'z' ? u * up : 0);
        B(cx, y, cz, axis === 'x' ? run : across, rise * (i + 1), axis === 'x' ? across : run, o.mat || 'concrete');
      }
    },
    anchor: o => [o.x, o.z],
  },
  // 발판: 높이 y 를 윗면으로 하는 바닥판 (2층 바닥·다리). pillars = 네 귀퉁이 기둥 (base 높이까지)
  platform: {
    build: (B, o) => {
      const t = o.t ?? 0.3, w = o.w ?? 6, d = o.d ?? 6, y = o.y ?? 3, base = o.base || 0, mat = o.mat || 'concrete';
      B(o.x, y - t, o.z, w, t, d, mat);
      if (o.pillars && y - t - base > 0.2) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(o.x + sx * (w / 2 - 0.25), base, o.z + sz * (d / 2 - 0.25), 0.35, y - t - base, 0.35, mat);
    },
    anchor: o => [o.x, o.z],
  },
};
// 방향 → [경사가 오르는 축, 오르는 쪽]  (n = 북 z+, s = 남 z−, e = 동 x+, w = 서 x−)
const DIRS = { n: ['z', 1], s: ['z', -1], e: ['x', 1], w: ['x', -1] };
// 바닥 높이 y 를 나중에 더하는 종류 (자기 모양 함수가 y 를 안 쓰는 것들)
const LIFT = new Set(['wall', 'building', 'sandbags', 'barrier', 'barrel', 'tower']);
// 재질(mat) · 색(tint) 을 모양 함수가 직접 쓰는 종류. 나머지는 expandObject 가 모든 박스에 입힌다
const OWN_MAT = new Set(['box', 'wall', 'building', 'ramp', 'stairs', 'platform']);
const OWN_TINT = new Set(['box', 'container', 'barrel']);

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
// 경사로 방향도 같이 돌린다 (turn 과 같은 방향: 90° 면 x+ → z+, z+ → x−)
function turnRamp(r, rot) {
  let v = r.axis === 'x' ? [r.up, 0] : [0, r.up];
  for (let k = 0; k < ((((rot % 360) + 360) % 360) / 90); k++) v = [-v[1], v[0]];
  return v[0] ? { axis: 'x', up: v[0] } : { axis: 'z', up: v[1] };
}
const sideways = rot => ((((rot % 360) + 360) % 360) / 90) % 2 === 1;

// 물체 하나 → 박스·나무 목록. rot: 제자리 회전(90 단위), sym: 맵 중심 기준 반대편(180° 회전)에도 하나 더
export function expandObject(o) {
  const t = OBJECT_TYPES[o.type];
  if (!t) return { boxes: [], trees: [], assets: [] };
  const boxes = [], trees = [], assets = [];
  t.build((x, y, z, w, h, d, mat, extra) => boxes.push({ x, y, z, w, h, d, mat, ...(extra || {}) }), o, (x, z, s) => trees.push({ x, z, s }));
  if (o.y && LIFT.has(o.type)) for (const b of boxes) b.y += o.y; // 공중·2층에 놓기
  // 재질·색 바꾸기 (스튜디오에서 고른 것): 자기 모양 함수가 안 쓰는 종류는 모든 박스에 덮어쓴다
  if (o.mat && !OWN_MAT.has(o.type)) for (const b of boxes) b.mat = o.mat;
  if (o.tint !== undefined && !OWN_TINT.has(o.type)) for (const b of boxes) b.tint = tintNum(o.tint);
  // replacedBy: 이 물체의 눈에 보이는 모양을 같은 id 의 시각 모델(content/assets)이 대신한다. 충돌 박스는 그대로이고, 모델을 못 불러오면 박스가 그대로 보인다
  if (o.replacedBy) for (const b of boxes) b.swap = o.replacedBy;
  if (o.type === 'asset') assets.push({ id: o.id, x: o.x, y: o.y || 0, z: o.z, rot: 0, s: o.s || 1, shadow: o.shadow || 'all' });
  const rot = o.rot || 0;
  if (rot) {
    const [cx, cz] = t.anchor(o);
    for (const b of boxes) {
      [b.x, b.z] = turn(b.x, b.z, cx, cz, rot);
      if (sideways(rot)) [b.w, b.d] = [b.d, b.w];
      if (b.ramp) b.ramp = turnRamp(b.ramp, rot);
    }
    for (const tr of trees) [tr.x, tr.z] = turn(tr.x, tr.z, cx, cz, rot);
    for (const a of assets) { [a.x, a.z] = turn(a.x, a.z, cx, cz, rot); a.rot = rot; }
  }
  if (o.sym) {
    boxes.push(...boxes.map(b => ({ ...b, x: -b.x, z: -b.z, ...(b.ramp ? { ramp: { ...b.ramp, up: -b.ramp.up } } : {}) }))); // 반대편: 경사도 반대로
    trees.push(...trees.map(tr => ({ ...tr, x: -tr.x, z: -tr.z })));
    assets.push(...assets.map(a => ({ ...a, x: -a.x, z: -a.z, rot: (a.rot + 180) % 360 })));
  }
  return { boxes, trees, assets };
}

// 맵 데이터 전체 → { boxes, trees, colliders, assets }
export function buildLayout(def) {
  const boxes = [], trees = [], assets = [];
  for (const o of def.objects || []) {
    const r = expandObject(o);
    boxes.push(...r.boxes); trees.push(...r.trees); assets.push(...r.assets);
  }
  return { ...finishLayout(boxes, trees), assets }; // assets = 시각 모델 배치 목록 (서버는 안 쓴다)
}
