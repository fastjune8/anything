// 점령전 대표 맵 "전초기지(outpost)" 생성기 → content/maps/outpost.json
//   node tools/maps/gen_outpost.mjs
// 만든 뒤에는 스튜디오 맵 에디터로 고치면 된다 (이 스크립트를 다시 돌리면 덮어쓴다).
//
// 설계 (기획 8장): 112m 정사각형, 8~10명. 0팀 = 북쪽(z+), 1팀 = 남쪽(z−). 남북 대칭(z → −z)이라 공정하고,
// 세 거점은 모두 양 팀 스폰에서 같은 거리에 있으면서 전투 환경이 서로 다르다.
//   A (서쪽 x=−30) 무너진 안뜰: 낮은 엄폐물·창문 벽·감시탑 → 중거리, 슬라이딩으로 엄폐물 사이를 오간다
//   B (가운데)     높은 광장: 2.4m 발판 + 경사로·계단 + 아래 통로 → 위아래 싸움, 동서로 긴 시야
//   C (동쪽 x=+30) 창고 내부: 지붕 있는 건물·컨테이너 → 근거리
//   거점 사이 연결 골목(z=±22), 맵 가장자리 우회로(x=±50), 스폰 출구 3개
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLayout } from '../../shared/maps/build.js';
import { overlapTop } from '../../shared/sim/movement.js';
import { formatContent } from '../../shared/content/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const objects = [];
const add = o => objects.push(o);
// 남북 반대편에도 (z → −z)
function mirror(o) {
  const m = { ...o };
  if ('z' in m) m.z = -m.z;
  if (m.type === 'wall') {
    if ((m.axis || 'x') === 'x') m.at = -m.at;
    else { [m.from, m.to] = [-m.to, -m.from]; m.ops = (m.ops || []).map(p => ({ ...p, at: -p.at })); }
  }
  if (m.type === 'building' && m.ops) {
    const flip = list => (list || []).map(p => ({ ...p, at: -p.at }));
    m.ops = { n: m.ops.s || [], s: m.ops.n || [], e: flip(m.ops.e), w: flip(m.ops.w) };
  }
  if ((m.type === 'ramp' || m.type === 'stairs') && (m.dir === 'n' || m.dir === 's')) m.dir = m.dir === 'n' ? 's' : 'n';
  return m;
}
const both = o => { add(o); add(mirror(o)); };

const H = 56;
// ───── 바깥 벽 ─────
add({ type: 'box', x: 0, y: 0, z: H + 0.5, w: 2 * H + 2, h: 5, d: 1, mat: 'concrete' });
add({ type: 'box', x: 0, y: 0, z: -H - 0.5, w: 2 * H + 2, h: 5, d: 1, mat: 'concrete' });
add({ type: 'box', x: H + 0.5, y: 0, z: 0, w: 1, h: 5, d: 2 * H, mat: 'concrete' });
add({ type: 'box', x: -H - 0.5, y: 0, z: 0, w: 1, h: 5, d: 2 * H, mat: 'concrete' });

// ───── 스폰 (북쪽, 남쪽은 대칭) ─────
both({ type: 'wall', axis: 'x', at: 38, from: -20, to: 20, h: 3.4, t: 0.5, mat: 'concreteDark', ops: [{ at: -13, w: 3.6, type: 'door' }, { at: 0, w: 4.2, type: 'door' }, { at: 13, w: 3.6, type: 'door' }] });
both({ type: 'wall', axis: 'z', at: -20, from: 38, to: 55.5, h: 3.4, t: 0.5, mat: 'concreteDark', ops: [{ at: 44, w: 3, type: 'door' }] });
both({ type: 'wall', axis: 'z', at: 20, from: 38, to: 55.5, h: 3.4, t: 0.5, mat: 'concreteDark', ops: [{ at: 44, w: 3, type: 'door' }] });
both({ type: 'barrier', x: -6.5, z: 41.5, axis: 'x' });
both({ type: 'barrier', x: 6.5, z: 41.5, axis: 'x' });
both({ type: 'crate', x: -16.5, z: 52, s: 1.4 });
both({ type: 'crate', x: 16.5, z: 52, s: 1.4 });
both({ type: 'container', x: -14, z: 32, axis: 'x', tint: '#3d5a73' });
both({ type: 'container', x: 14, z: 32, axis: 'x', tint: '#3d5a73' });

// ───── 연결 골목 (z = ±22) ─────
both({ type: 'container', x: -22, z: 22, axis: 'z', tint: '#6b4a33' });
both({ type: 'container', x: 22, z: 22, axis: 'z', tint: '#596066' });
both({ type: 'container', x: -38, z: 26, axis: 'x', tint: '#4f5d3a' });
both({ type: 'container', x: 38, z: 26, axis: 'x', tint: '#6b4a33' });
both({ type: 'sandbags', x: 0, z: 25, len: 5, axis: 'x' });
both({ type: 'barrier', x: -8, z: 17, axis: 'x' });
both({ type: 'barrier', x: 8, z: 17, axis: 'x' });
both({ type: 'barrel', x: -25.5, z: 18 });
both({ type: 'barrel', x: 25.5, z: 18.5, tint: '#7a3a2a' });

// ───── 가장자리 우회로 (x = ±50) ─────
both({ type: 'wall', axis: 'z', at: -46, from: 8, to: 30, h: 3, t: 0.4, mat: 'brick', ops: [{ at: 14, w: 1.8, type: 'window' }, { at: 24, w: 1.8, type: 'door' }] });
both({ type: 'wall', axis: 'z', at: 46, from: 8, to: 30, h: 3, t: 0.4, mat: 'brick', ops: [{ at: 14, w: 1.8, type: 'window' }, { at: 24, w: 1.8, type: 'door' }] });
both({ type: 'crate', x: -51, z: 34, s: 1.2 });
both({ type: 'crate', x: 51.5, z: 12, s: 1.2 });
both({ type: 'tree', x: -52, z: 46, s: 1.1 });
both({ type: 'tree', x: 52, z: 47, s: 1.2 });
both({ type: 'tree', x: -33, z: 50, s: 0.9 });
both({ type: 'tree', x: 34, z: 51, s: 1 });

// ───── A: 무너진 안뜰 (서쪽) ─────
add({ type: 'tower', x: -47, z: 0 });
both({ type: 'wall', axis: 'x', at: 9, from: -40, to: -21, h: 2.8, t: 0.35, mat: 'brick', ops: [{ at: -35, w: 1.8, type: 'window' }, { at: -28.5, w: 2.4, type: 'door' }, { at: -24, w: 1.6, type: 'window' }] });
add({ type: 'wall', axis: 'z', at: -20.5, from: -5, to: 5, h: 1.2, t: 0.4, mat: 'brick' });
add({ type: 'wall', axis: 'z', at: -40, from: -4, to: 4, h: 2.6, t: 0.35, mat: 'brick', ops: [{ at: 0, w: 1.8, type: 'window' }] });
add({ type: 'sandbags', x: -30, z: 0, len: 4, axis: 'z', h: 1.1 });
both({ type: 'sandbags', x: -34.5, z: 4.5, len: 3, axis: 'x' });
both({ type: 'crate', x: -25.5, z: 4, s: 1.2 });
both({ type: 'crate', x: -25.5, z: 5.3, s: 1.0, y: 0 });
both({ type: 'barrier', x: -30, z: 13.5, axis: 'x' });
add({ type: 'barrel', x: -36.5, z: -0.8 });
add({ type: 'barrel', x: -36, z: 0.4, tint: '#7a3a2a' });
both({ type: 'tree', x: -43, z: 14, s: 1.2 });

// ───── B: 높은 광장 (가운데) ─────
add({ type: 'platform', x: 0, z: 0, y: 2.4, w: 10, d: 10, t: 0.3, mat: 'concrete', pillars: true });
add({ type: 'ramp', x: 0, z: 8, dir: 's', len: 6, w: 3, h: 2.4, mat: 'concrete' });
add({ type: 'ramp', x: 0, z: -8, dir: 'n', len: 6, w: 3, h: 2.4, mat: 'concrete' });
add({ type: 'stairs', x: -7.5, z: 3, dir: 'e', len: 5, w: 2, h: 2.4, mat: 'concreteDark' });
add({ type: 'stairs', x: 7.5, z: -3, dir: 'w', len: 5, w: 2, h: 2.4, mat: 'concreteDark' });
add({ type: 'box', x: 4.6, y: 2.4, z: 3.5, w: 0.3, h: 1.0, d: 3, mat: 'metal' });
add({ type: 'box', x: -4.6, y: 2.4, z: -3.5, w: 0.3, h: 1.0, d: 3, mat: 'metal' });
add({ type: 'box', x: -2.5, y: 2.4, z: 4.85, w: 4, h: 1.0, d: 0.3, mat: 'metal' });
add({ type: 'box', x: 2.5, y: 2.4, z: -4.85, w: 4, h: 1.0, d: 0.3, mat: 'metal' });
add({ type: 'crate', x: 0.8, z: 0.6, s: 1.1 });
both({ type: 'barrier', x: -10, z: 9, axis: 'z' });
both({ type: 'barrier', x: 10, z: 9, axis: 'z' });
both({ type: 'crate', x: 12.5, z: 4.5, s: 1.3 });
both({ type: 'crate', x: -12.5, z: 5.5, s: 1.1 });

// ───── C: 창고 내부 (동쪽) ─────
add({ type: 'building', x: 31, z: 0, w: 20, d: 16, h: 4.2, mat: 'concrete', roof: true, ops: {
  n: [{ at: 25, w: 2.6, type: 'door' }, { at: 37, w: 2.6, type: 'door' }, { at: 31, w: 1.8, type: 'window' }],
  s: [{ at: 25, w: 2.6, type: 'door' }, { at: 37, w: 2.6, type: 'door' }, { at: 31, w: 1.8, type: 'window' }],
  w: [{ at: -3.5, w: 1.8, type: 'window' }, { at: 0, w: 2.4, type: 'door' }, { at: 3.5, w: 1.8, type: 'window' }],
  e: [{ at: 0, w: 2.4, type: 'door' }],
} });
add({ type: 'container', x: 31, z: 0, axis: 'x', tint: '#7a5b2a' });
both({ type: 'crate', x: 26, z: 4.6, s: 1.2 });
both({ type: 'crate', x: 36.5, z: 4.2, s: 1.1 });
both({ type: 'box', x: 31, y: 0, z: 5.2, w: 2.2, h: 1.1, d: 0.5, mat: 'metal' });
both({ type: 'sandbags', x: 41.5, z: 11, len: 3, axis: 'x' });
both({ type: 'barrel', x: 22.5, z: 9.5 });

const def = {
  id: 'outpost', name: '전초기지', half: H, look: 'sunlit',
  spawns: {
    team: [
      [[-8, 47], [-4, 49.5], [0, 47], [4, 49.5], [8, 47], [-12, 50], [12, 50]],
      [[8, -47], [4, -49.5], [0, -47], [-4, -49.5], [-8, -47], [12, -50], [-12, -50]],
    ],
    ffa: [[-48, 44], [48, 44], [-48, -44], [48, -44], [-30, 24], [30, 30], [-30, -24], [30, -30], [0, 30], [0, -30], [-52, 2], [52, 2],
      [-15, 12], [15, -12], [0, 47], [0, -47], [-36, 46], [36, -46], [-38, -14], [42, 15], [-10, -22], [12, 22]],
  },
  zones: [
    { id: 'A', name: 'A 안뜰', x: -30, z: 0, r: 7 },
    { id: 'B', name: 'B 광장', x: 0, z: 0, r: 6 },
    { id: 'C', name: 'C 창고', x: 31, z: 0, r: 6.5 },
  ],
  objects,
};

// 스폰 지점이 물체 안이면 알려 준다
const { colliders } = buildLayout(def);
const bad = [...def.spawns.ffa, ...def.spawns.team.flat()].filter(([x, z]) => overlapTop(colliders, x, 0, z, 1.75) !== -Infinity);
if (bad.length) { console.error('물체 안에 있는 스폰:', JSON.stringify(bad)); process.exit(1); }
fs.writeFileSync(path.join(ROOT, 'content/maps/outpost.json'), formatContent(def));
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/maps/index.json'), 'utf8'));
if (!idx.includes('outpost')) { idx.unshift('outpost'); fs.writeFileSync(path.join(ROOT, 'content/maps/index.json'), JSON.stringify(idx) + '\n'); }
console.log(`outpost: 물체 ${objects.length}개, 충돌 박스 ${colliders.length}개`);
