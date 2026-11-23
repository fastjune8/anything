// 레벨 디자인 기획서 v2.0 (Hyper_FPS_Level_Design_v2.pdf, BLOCKOUT v2.0 · 2026.11.20) 의 세 맵 생성기
//   node tools/maps/gen_v2_maps.mjs          → content/maps/{courtyard,aster,shiftcore}.json
// 좌표는 기획서 평면도(격자 10m)의 벡터 도형에서 그대로 옮겼다. 단위 m, x = 동(+), z = 북(+), C 중심 = 원점.
//   01 골목극장 (courtyard) : 좌우 반사 대칭 (x → −x). BLUE = 서쪽, RED = 동쪽
//   02 아스테르 항만 (aster) : 180° 회전 대칭. BLUE = 남서, RED = 북동
//   03 교차 동력실 (shiftcore): 180° 회전 대칭. BLUE = 서쪽, RED = 동쪽
// 0팀 = BLUE, 1팀 = RED.
// 지상 통행 영역(기획서의 연회색 바닥) 밖은 1m 격자로 채운 덩어리(외곽 건물·방파제·시설 벽)로 막는다.
// 높이는 기획서에 적힌 값(옥상 +3.5, 테라스 +3, 갤러리 +4, 하부 3.4, 신호탑 6, 종탑 4.5, 코어 6.2)을 쓰고,
// 적히지 않은 높이(일반 건물·벽·엄폐물)는 블록아웃용으로 정했다 — 스튜디오 맵 에디터에서 고치면 된다
// (이 스크립트를 다시 돌리면 덮어쓴다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLayout } from '../../shared/maps/build.js';
import { overlapTop } from '../../shared/sim/movement.js';
import { formatContent } from '../../shared/content/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ───────── 공통 도구 ─────────
// 사각형 R = [x0, x1, z0, z1]
const box = (R, h, mat, y = 0, extra = {}) => ({ type: 'box', x: (R[0] + R[1]) / 2, z: (R[2] + R[3]) / 2, y, w: R[1] - R[0], d: R[3] - R[2], h, mat, ...extra });
// 얇은 사각형 → 벽 (길쭉한 쪽이 벽 방향)
function wallR(R, h, mat, y = 0) {
  const w = R[1] - R[0], d = R[3] - R[2];
  const o = w >= d ? { type: 'wall', axis: 'x', at: (R[2] + R[3]) / 2, from: R[0], to: R[1], h, t: d, mat }
    : { type: 'wall', axis: 'z', at: (R[0] + R[1]) / 2, from: R[2], to: R[3], h, t: w, mat };
  if (y) o.y = y;
  return o;
}
const plat = (R, y, t, mat, pillars = false) => ({ type: 'platform', x: (R[0] + R[1]) / 2, z: (R[2] + R[3]) / 2, y, w: R[1] - R[0], d: R[3] - R[2], t, mat, ...(pillars ? { pillars: true } : {}) });
// 경사로·계단: R 은 발판 자리, dir = 오르는 쪽
function slope(type, R, dir, h, mat) {
  const alongX = dir === 'e' || dir === 'w';
  return { type, x: (R[0] + R[1]) / 2, z: (R[2] + R[3]) / 2, dir, len: alongX ? R[1] - R[0] : R[3] - R[2], w: alongX ? R[3] - R[2] : R[1] - R[0], h, mat };
}
// 좌우 반사 (x → −x)
function mirrorX(o) {
  const m = JSON.parse(JSON.stringify(o));
  if ('x' in m) m.x = -m.x;
  if (m.type === 'wall') {
    if (m.axis === 'x') { [m.from, m.to] = [-m.to, -m.from]; if (m.ops) m.ops = m.ops.map(p => ({ ...p, at: -p.at })); }
    else { m.at = -m.at; if (m.face) m.face = m.face === '+' ? '-' : '+'; }
  }
  if ((m.type === 'ramp' || m.type === 'stairs') && (m.dir === 'e' || m.dir === 'w')) m.dir = m.dir === 'e' ? 'w' : 'e';
  return m;
}
const r1 = v => Math.round(v * 100) / 100;
function tidy(o) { for (const k of ['x', 'z', 'y', 'w', 'd', 'h', 'at', 'from', 'to', 't', 'len']) if (typeof o[k] === 'number') o[k] = r1(o[k]); if (o.y === 0) delete o.y; return o; }

// 점이 다각형 안인가 (짝-홀 규칙)
function inPoly(P, x, z) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const inRect = (R, x, z) => x > R[0] && x < R[1] && z > R[2] && z < R[3];

// 지상 밖 칸을 1m 격자로 채운다. kind(x, z) → 칸 종류 키 (null = 지상, 비운다). 같은 키끼리 가로로 잇고, 같은 가로 줄이 세로로 이어지면 합친다
function fillOutside(H, kind) {
  const N = 2 * H, rows = [];
  for (let j = 0; j < N; j++) {
    const z = -H + j + 0.5, runs = [];
    let i = 0;
    while (i < N) {
      const k = kind(-H + i + 0.5, z);
      if (k === null) { i++; continue; }
      let e = i + 1;
      while (e < N && kind(-H + e + 0.5, z) === k) e++;
      runs.push({ x0: -H + i, x1: -H + e, k });
      i = e;
    }
    rows.push(runs);
  }
  const done = [], open = new Map(); // "x0,x1,k" → { x0, x1, z0, z1, k }
  rows.forEach((runs, j) => {
    const z = -H + j, seen = new Set();
    for (const r of runs) {
      const key = `${r.x0},${r.x1},${r.k}`;
      seen.add(key);
      const o = open.get(key);
      if (o && o.z1 === z) o.z1 = z + 1;
      else { if (o) done.push(o); open.set(key, { ...r, z0: z, z1: z + 1 }); }
    }
    for (const [key, o] of open) if (!seen.has(key)) { done.push(o); open.delete(key); }
  });
  done.push(...open.values());
  return done;
}
// 바깥 벽 (전초기지와 같은 방식: 맵 가장자리 ±(half + 0.5))
const outerWalls = H => [
  { type: 'wall', axis: 'x', at: H + 0.5, from: -H - 1, to: H + 1, h: 6, t: 1, mat: 'concrete', face: '-' },
  { type: 'wall', axis: 'x', at: -H - 0.5, from: -H - 1, to: H + 1, h: 6, t: 1, mat: 'concrete', face: '+' },
  { type: 'wall', axis: 'z', at: H + 0.5, from: -H, to: H, h: 6, t: 1, mat: 'concrete', face: '-' },
  { type: 'wall', axis: 'z', at: -H - 0.5, from: -H, to: H, h: 6, t: 1, mat: 'concrete', face: '+' },
];
const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

// 팀 스폰: 스폰 방 중심 둘레 7자리
const spawnRing = ([cx, cz], s = 2.6) => [[0, 0], [-s, -s], [0, -s], [s, -s], [-s, s], [0, s], [s, s]].map(([dx, dz]) => [cx + dx, cz + dz]);

// 개인전 스폰: 지상에서 장애물과 2m 이상 떨어진 칸 중 서로 멀리 (대칭으로 짝을 맞춘다)
function ffaSpawns(def, isGround, flip, n = 10) {
  const { colliders } = buildLayout(def);
  const clear = (x, z) => {
    for (let a = 0; a < 8; a++) { const px = x + Math.cos(a * Math.PI / 4) * 1.6, pz = z + Math.sin(a * Math.PI / 4) * 1.6; if (!isGround(px, pz) || overlapTop(colliders, px, 0, pz, 2.6) !== -Infinity) return false; }
    return isGround(x, z) && overlapTop(colliders, x, 0, z, 2.6) === -Infinity;
  };
  const zs = def.zones.map(q => [q.x, q.z]);
  const cand = [];
  for (let x = -def.half + 2; x <= 0; x += 2) for (let z = -def.half + 2; z <= def.half - 2; z += 2) {
    const [fx, fz] = flip([x, z]);
    if (Math.hypot(fx - x, fz - z) < 12) continue; // 대칭 짝끼리 너무 가깝지 않게
    if (zs.some(([qx, qz]) => Math.hypot(qx - x, qz - z) < 4)) continue;
    if (clear(x, z) && clear(fx, fz)) cand.push([x, z]);
  }
  const pick = [cand[Math.floor(cand.length / 2)]];
  while (pick.length < n && pick.length < cand.length) {
    let best = null, bd = -1;
    for (const c of cand) {
      const d = Math.min(...pick.flatMap(p => [Math.hypot(p[0] - c[0], p[1] - c[1]), Math.hypot(flip(p)[0] - c[0], flip(p)[1] - c[1])]));
      if (d > bd) { bd = d; best = c; }
    }
    pick.push(best);
  }
  return pick.flatMap(p => [p, flip(p)]);
}

function save(def) {
  def.objects = def.objects.map(tidy);
  const { colliders } = buildLayout(def);
  const bad = [...def.spawns.ffa, ...def.spawns.team.flat()].filter(([x, z]) => overlapTop(colliders, x, 0, z, 1.75) !== -Infinity);
  if (bad.length) { console.error(`${def.id}: 물체 안에 있는 스폰:`, JSON.stringify(bad)); process.exit(1); }
  fs.writeFileSync(path.join(ROOT, `content/maps/${def.id}.json`), formatContent(def));
  console.log(`${def.id} (${def.name}): 물체 ${def.objects.length}개, 충돌 박스 ${colliders.length}개`);
}

// ═════════════════════════ 01 골목극장 ═════════════════════════
// 부산 도심 생활 공간 + 구역별 시야 분절. A·B·C 삼각형, 카페는 통과 가능한 실내, +3.5m 문화관 옥상, 남쪽 배송 골목
function courtyard() {
  const H = 58;
  const ground = [[-58, -42], [-58, 10], [-48, 10], [-48, 31], [-39, 41], [-14, 41], [-14, 46], [14, 46], [14, 41], [39, 41], [48, 31], [48, 10], [58, 10], [58, -42], [49, -46], [-49, -46]];
  const isGround = (x, z) => inPoly(ground, x, z);
  const objects = [...outerWalls(H)];
  // 지상 밖: 도심 건물 덩어리 (높이·재질을 섞는다)
  for (const r of fillOutside(H, (x, z) => (isGround(x, z) ? null : 'b'))) {
    const v = hash(r.x0 + r.x1, r.z0 * 3 + r.z1);
    objects.push(box([r.x0, r.x1, r.z0, r.z1], 8 + Math.round(v * 4), v > 0.5 ? 'brick' : 'concrete'));
  }
  // 서쪽 절반 (동쪽은 반사)
  const west = [
    // BLUE 스폰 방 (x −57~−43, z −42~−26): 북문 6m, 동문 6m
    wallR([-57, -54, -26.8, -26], 4, 'concreteDark'), wallR([-48, -43, -26.8, -26], 4, 'concreteDark'),
    wallR([-57, -43, -42, -41.2], 4, 'concreteDark'), wallR([-57, -56.2, -41.2, -26.8], 4, 'concreteDark'),
    wallR([-43.8, -43, -32, -26.8], 4, 'concreteDark'), wallR([-43.8, -43, -41.2, -38], 4, 'concreteDark'),
    box([-47, -43, -29, -24], 4.5, 'concreteDark'),                 // 스폰 북동 모서리 건물 (스폰 벽과 면이 맞닿아 같은 재질)
    // 상점 (A 홈 거점은 상점 사이 안뜰)
    box([-43, -37, -25, -10], 5.5, 'brick'), box([-24, -17, -29, -12], 5.5, 'brick'),
    box([-58, -49, -18, 10], 10, 'concrete'),                       // 서쪽 큰 건물
    box([-35, -28, -33, -31], 1.2, 'concrete'),                     // A 남쪽 엄폐물
    // 카페 (x −43~−29, z −4~10): 통과 가능한 실내. 서문 z 1~7, 남문 x −40~−34, 동문 z −3~3
    wallR([-43, -29, 9.2, 10], 3.5, 'brick'),
    wallR([-43, -40, -4, -3.2], 3.5, 'brick'), wallR([-34, -29, -4, -3.2], 3.5, 'brick'),
    wallR([-43, -42.2, 7, 9.2], 3.5, 'brick'), wallR([-43, -42.2, -3.2, 1], 3.5, 'brick'),
    wallR([-29.8, -29, 3, 9.2], 3.5, 'brick'), wallR([-29.8, -29, -3.2, -3], 3.5, 'brick'),
    box([-43, -29, -4, 10], 0.3, 'concreteDark', 3.5),             // 카페 지붕
    box([-39, -33, 5, 7], 1.1, 'wood'),                             // 카운터
    box([-26, -23, 4, 7], 1.3, 'crate'),                            // 집결 마당 엄폐물
    // 문화관 옥상 +3.5m (아래는 필로티로 지나갈 수 있다), 지붕 차폐벽, 서쪽 계단 → 정상 참
    plat([-31, -13, 17, 31], 3.5, 0.3, 'concrete', true),
    box([-20, -14, 18, 20], 1.6, 'concreteDark', 3.5),
    slope('stairs', [-37, -31, 17, 27], 'n', 3.5, 'concreteDark'),
    plat([-37, -31, 27, 31], 3.5, 0.3, 'concrete', true),
    box([-20, -15, 34, 36], 1.2, 'concrete'),                       // 문화마당 엄폐물
    // C 중정 벽 (26×22m): 서문 z −4~4
    wallR([-13, -4, 11.2, 12], 4, 'brick'),
    wallR([-13, -12.2, 4, 11.2], 4, 'brick'), wallR([-13, -12.2, -9.2, -4], 4, 'brick'),
  ];
  objects.push(...west, ...west.map(mirrorX));
  objects.push(
    box([-8, 8, 29, 43], 8, 'concrete'),                            // 공연장
    box([-10, 10, -35, -10], 7, 'concrete'),                        // 물류관 (C 남쪽을 막는다)
    wallR([-13, 13, -10, -9.2], 4, 'brick'),                        // C 남벽
    box([-3, 3, -4, 4], 6, 'metal'),                                // 6m 신호탑
  );
  const blue = spawnRing([-50, -34]), red = blue.map(([x, z]) => [-x, z]);
  const def = {
    id: 'courtyard', name: '골목극장', half: H, look: 'outpost',
    spawns: { team: [blue, red], ffa: [] },
    zones: [
      { id: 'A', name: 'A 상점 안뜰', x: -30, z: -20, r: 6 },
      { id: 'B', name: 'B 상점 안뜰', x: 30, z: -20, r: 6 },
      { id: 'C', name: 'C 중정', x: 0, z: 0, r: 8.5 },
    ],
    objects,
  };
  def.spawns.ffa = ffaSpawns(def, isGround, ([x, z]) => [-x, z]);
  return def;
}

// ═════════════════════════ 02 아스테르 항만 ═════════════════════════
// 엇갈린 마당·어긋난 네 개의 문·분리된 테라스. C = 지붕이 열린 예배당 중정. 180° 회전 대칭 (sym)
function aster() {
  const H = 62;
  const ground = [[-62, -23], [-62, -4], [-50, -4], [-48, 16], [-42, 31], [-30, 40], [-7, 45], [14, 42], [30, 37], [43, 28], [46, 19], [56, 24], [62, 23], [62, 4], [50, 4], [48, -16], [42, -31], [30, -40], [7, -45], [-14, -42], [-30, -37], [-43, -28], [-46, -19], [-56, -24]];
  const extra = [[-61, -43, -23, -5], [43, 61, 5, 23], [-52, -39, -29, -18], [39, 52, 18, 29]];
  const isGround = (x, z) => inPoly(ground, x, z) || extra.some(R => inRect(R, x, z));
  const objects = [...outerWalls(H)];
  // 지상 밖: 방파제 (1.1m, 보이는 부분) + 그 위를 막는 보이지 않는 벽 — 바다 쪽 시야는 열어 두고 넘어가지는 못하게
  for (const r of fillOutside(H, (x, z) => (isGround(x, z) ? null : 's'))) {
    const R = [r.x0, r.x1, r.z0, r.z1];
    objects.push(box(R, 1.1, 'concrete'), box(R, 10.9, 'concrete', 1.1, { invisible: true }));
  }
  const S = o => ({ ...o, sym: true }); // 180° 반대편에도 하나
  const half = [
    box([-34, -20, 10, 26], 9, 'brick'),                            // 북서 집회당 (높다: 다른 거점 방향 시야 차단)
    box([-43, -37, -5, 3], 5, 'brick'),                             // 어시장 상점
    box([-43, -40, -31, -23], 4, 'concrete'),                       // A 옆 담
    box([-44, -38, -20, -17], 4, 'concrete'),                       // 스폰 앞 담
    box([-28, -19, -15, -9], 5, 'wood'),                            // 남서 창고
    // 남쪽 비스듬한 건물 (−8~−2, −31~−17, 북서 모서리를 깎았다)
    box([-8, -2, -31, -20], 6, 'concrete'), box([-4, -2, -20, -17], 6, 'concrete'), box([-6, -4, -20, -18], 6, 'concrete'), box([-8, -6, -20, -19], 6, 'concrete'),
    // C 예배당 중정 벽 (24×20m): 북문 x −9~−3, 서문 z −9~−3 (동·남문은 반대편)
    // 서벽 북쪽 일부만 3.4m 로 낮춰 +3m 테라스에서만 넘겨 쏠 수 있는 제한된 공격 창 (지상에서는 넘지도 보지도 못한다 → 출입구는 네 개 그대로)
    wallR([-12, -9, 9.2, 10], 5, 'brick'), wallR([-3, 12, 9.2, 10], 5, 'brick'),
    wallR([-12, -11.2, -10, -9], 5, 'brick'), wallR([-12, -11.2, -3, 3], 5, 'brick'),
    wallR([-12, -11.2, 3, 9.2], 3.4, 'concrete'),
    // 북서 테라스 +3m (아래 통행 가능), 테라스 차폐벽, 북쪽에서 남쪽으로 오르는 계단
    plat([-20, -12, 8, 20], 3, 0.3, 'concrete', true),
    box([-14, -12, 14, 20], 1.8, 'concreteDark', 3),
    slope('stairs', [-20, -12, 20, 29], 's', 3, 'concreteDark'),
    // BLUE 스폰 방 (x −60~−44, z −22~−6): 남문 x −54~−48, 동문 z −15~−9
    wallR([-60, -44, -6.8, -6], 4, 'concreteDark'),
    wallR([-60, -54, -22, -21.2], 4, 'concreteDark'), wallR([-48, -44, -22, -21.2], 4, 'concreteDark'),
    wallR([-60, -59.2, -21.2, -6.8], 4, 'concreteDark'),
    wallR([-44.8, -44, -9, -6.8], 4, 'concreteDark'), wallR([-44.8, -44, -21.2, -15], 4, 'concreteDark'),
    // 남서 작업장 (통과 가능한 실내, x −21~−10, z −34~−20): 북문 x −18~−12, 남문 x −18~−12, 서문 z −29~−23
    wallR([-21, -18, -20.8, -20], 3.6, 'brick'), wallR([-12, -10, -20.8, -20], 3.6, 'brick'),
    wallR([-21, -18, -34, -33.2], 3.6, 'brick'), wallR([-12, -10, -34, -33.2], 3.6, 'brick'),
    wallR([-21, -20.2, -23, -20.8], 3.6, 'brick'), wallR([-21, -20.2, -33.2, -29], 3.6, 'brick'),
    wallR([-10.8, -10, -33.2, -20.8], 3.6, 'brick'),
    box([-21, -10, -34, -20], 0.3, 'concreteDark', 3.6),            // 작업장 지붕
    box([-14, -12, -29, -24], 1.2, 'crate'),                        // 작업장 안 엄폐물
    // 엄폐물
    box([-32, -27, -7, -5], 1.2, 'concrete'), box([-5, 0, 23, 25], 1.2, 'concrete'), box([7, 12, 37, 39], 1.2, 'concrete'), box([-29, -25, -18, -16], 1.2, 'crate'),
  ];
  objects.push(...half.map(S));
  objects.push(box([-2, 2, -3, 3], 4.5, 'concrete'));             // 4.5m 종탑 기단
  const blue = spawnRing([-52, -14]), red = blue.map(([x, z]) => [-x, -z]);
  const def = {
    id: 'aster', name: '아스테르 항만', half: H, look: 'sunlit',
    spawns: { team: [blue, red], ffa: [] },
    zones: [
      { id: 'A', name: 'A 어시장', x: -33, z: -25, r: 6 },
      { id: 'B', name: 'B 공방', x: 33, z: 25, r: 6 },
      { id: 'C', name: 'C 예배당', x: 0, z: 0, r: 7.5 }, // 기획서: 16×14m 사각 점령 바닥 → 원으로 근사
    ],
    objects,
  };
  def.spawns.ffa = ffaSpawns(def, isGround, ([x, z]) => [-x, -z]);
  return def;
}

// ═════════════════════════ 03 교차 동력실 ═════════════════════════
// 엔진실 주변 두 순환 + 통로 위아래 교차. +4m 갤러리(하부 3.4m 통행), C 는 남서·북동 모서리 발코니에서만 보인다. 180° 회전 대칭
function shiftcore() {
  const H = 57;
  const floors = [
    [-15, 15, -15, 15], // C 동력실 (북동·남서 모서리는 아래에서 깎는다)
    [-57, -47, -8, 8], [47, 57, -8, 8], [-49, -39, -16, 16], [39, 49, -16, 16], [-43, -36, -26, 18], [36, 43, -18, 26],
    [-40, -16, -26, -12], [16, 40, 12, 26], [-23, -15, -26, 16], [15, 23, -16, 26], [-40, -16, 12, 24], [16, 40, -24, -12],
    [-46, -38, -33, -20], [38, 46, 20, 33], [-43, -23, -32, -26], [23, 43, 26, 32], [-23, -15, -33, -25], [15, 23, 25, 33],
    [-22, -3, 17, 23], [3, 22, -23, -17], [-9, -3, 17, 34], [3, 9, -34, -17], [-9, 20, 28, 34], [-20, 9, -34, -28],
    [14, 20, 17, 34], [-20, -14, -34, -17], [14, 27, 17, 23], [-27, -14, -23, -17], [-10, 4, 16, 24], [-4, 10, -24, -16],
    [-4, 4, 11, 24], [-4, 4, -24, -11],
  ];
  const inC = (x, z) => inRect([-15, 15, -15, 15], x, z) && x + z < 24 && x + z > -24;
  const isGround = (x, z) => floors.some((R, i) => (i === 0 ? inC(x, z) : inRect(R, x, z)));
  // 상층(+4m) 바닥: 갤러리 + 착지 참 + 모서리 발코니 (남서쪽, 북동은 대칭)
  const upper = [[-23, -15, -33, 4], [-15, -8, -25, -10]];
  const upperAll = [...upper, ...upper.map(([a, b, c, d]) => [-b, -a, -d, -c])];
  const engines = [[-35, -25, -8, 9], [25, 35, -9, 8]];
  const machine = [[-36, -23, -12, 12], [23, 36, -12, 12]];       // 엔진실 둘레 기계 기단 (기획서의 흰 띠, 3.4m — 슬라이딩 점프로도 못 올라간다)
  const objects = [...outerWalls(H)];
  const kind = (x, z) => {
    if (isGround(x, z)) return null;
    if (engines.some(R => inRect(R, x, z))) return null;          // 엔진실은 따로
    if (upperAll.some(R => inRect(R, x, z))) return 'under';      // 상층 아래는 3.4m (대각 벽도 3.4m — 기획서)
    if (machine.some(R => inRect(R, x, z))) return 'machine';
    return 'wall';
  };
  for (const r of fillOutside(H, kind)) {
    const R = [r.x0, r.x1, r.z0, r.z1];
    objects.push(r.k === 'under' ? box(R, 3.4, 'concrete') : r.k === 'machine' ? box(R, 3.4, 'metal') : box(R, 9, 'concrete'));
  }
  const S = o => ({ ...o, sym: true });
  const diag = [];                                                // 남서 대각 벽 (x+z = −23 선, 두께 1.4m, 높이 3.4m)
  for (let x = -14; x <= -9; x++) diag.push(box([x - 0.7, x + 0.7, -23 - x - 0.7, -23 - x + 0.7], 3.4, 'concrete'));
  const half = [
    box(engines[0], 7, 'concreteDark'),                             // 서쪽 엔진실
    box([-47, -39, -3, 3], 4, 'concrete'),                          // 스폰 앞 벽
    // C 동력실 벽 (지상 문 네 곳, 폭 8m). 남서 모서리 둘레(발코니 아래)는 3.4m 로 낮다
    wallR([-15, -14, 4, 14], 6, 'concrete'), wallR([-14, -4, 14, 15], 6, 'concrete'),
    wallR([-15, -14, -9, -4], 3.4, 'concrete'), wallR([-9, -4, -15, -14], 3.4, 'concrete'),
    ...diag,
    // BLUE 스폰 방 (x −57~−47, z −8~8): 동문 둘 (z 3~7, −7~−3)
    wallR([-57, -47, 7.2, 8], 4, 'concreteDark'), wallR([-57, -47, -8, -7.2], 4, 'concreteDark'), wallR([-57, -56.2, -7.2, 7.2], 4, 'concreteDark'),
    wallR([-47.8, -47, 7, 7.2], 4, 'concreteDark'), wallR([-47.8, -47, -3, 3], 4, 'concreteDark'), wallR([-47.8, -47, -7.2, -7], 4, 'concreteDark'),
    // 엄폐물
    box([-35, -31, 18, 21], 1.2, 'crate'), box([-24, -21, -16, -13], 1.2, 'crate'),
    // 20m 램프 (지상 x −43 → +4m x −23) 와 옆벽
    slope('ramp', [-43, -23, -32, -26], 'e', 4, 'concrete'),
    wallR([-43, -23, -26, -25.4], 5, 'metal'),
    // +4m 갤러리 (바닥 두께 0.6 → 하부 3.4m) · 남서 발코니
    plat(upper[0], 4, 0.6, 'metal'), plat(upper[1], 4, 0.6, 'metal'),
    // 갤러리 측벽 (불투명, 상층에만): 바깥쪽 · C 쪽 · 발코니 남쪽
    wallR([-23, -22.4, -25, 4], 2.4, 'metal', 4), wallR([-15.6, -15, -10, 4], 2.4, 'metal', 4), wallR([-15, -8, -25, -24.4], 2.4, 'metal', 4),
    // 발코니 난간 (C 쪽, 1m — 여기서만 C 를 내려다본다)
    box([-15, -8, -10.15, -10], 1, 'metal', 4), box([-8.15, -8, -14, -10], 1, 'metal', 4),
  ];
  objects.push(...half.map(S));
  objects.push(box([-3, 3, -4, 4], 6.2, 'metal'));                // 6.2m 코어
  const blue = spawnRing([-52, 0], 2.4), red = blue.map(([x, z]) => [-x, -z]);
  const def = {
    id: 'shiftcore', name: '교차 동력실', half: H, look: 'outpost',
    spawns: { team: [blue, red], ffa: [] },
    zones: [
      { id: 'A', name: 'A 펌프실', x: -32, z: -18, r: 5.5 },
      { id: 'B', name: 'B 펌프실', x: 32, z: 18, r: 5.5 },
      { id: 'C', name: 'C 동력실', x: 0, z: 0, r: 9 }, // 기획서: 18×18m 점령 바닥 → 원으로 근사. 갤러리(+4m)는 점령 높이(4m) 밖
    ],
    objects,
  };
  def.spawns.ffa = ffaSpawns(def, isGround, ([x, z]) => [-x, -z]);
  return def;
}

const maps = [courtyard(), aster(), shiftcore()];
for (const m of maps) save(m);
// 맵 목록: 새 맵 셋을 앞에 (첫 번째 = 기본), 예전 맵은 뒤에 보관
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/maps/index.json'), 'utf8'));
const next = [...maps.map(m => m.id), ...idx.filter(id => !maps.some(m => m.id === id))];
fs.writeFileSync(path.join(ROOT, 'content/maps/index.json'), JSON.stringify(next) + '\n');
console.log('맵 목록:', next.join(', '));
