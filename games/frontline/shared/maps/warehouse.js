// 맵: 창고 (팀 데스매치) — 양 끝이 좁고 가운데가 넓은 육각형 전장, 중앙에 큰 창고 건물
// 위쪽(z<0)이 1팀, 아래쪽(z>0)이 0팀 진영. 원점 대칭이라 양 팀 조건이 같다.
import { wallRun, building, container, crate, sandbags, barrier, barrel, finishLayout } from './parts.js';

const LEN = 50;      // 세로 절반 길이 (z)
const END_W = 15;    // 양 끝(스폰 구역) 절반 너비
const MID_W = 27;    // 가운데 절반 너비
const NECK = 36;     // 이 |z| 부터 끝까지는 END_W
const FLAT = 12;     // 이 |z| 안쪽은 MID_W
const WALL_H = 4.5;

// z 위치에서의 외곽 절반 너비 (육각형 윤곽)
export function halfWidth(z) {
  const a = Math.abs(z);
  if (a >= NECK) return END_W;
  if (a <= FLAT) return MID_W;
  return MID_W + (END_W - MID_W) * (a - FLAT) / (NECK - FLAT);
}

function build() {
  const boxes = [], trees = [];
  const add = (x, y, z, w, h, d, mat, extra) => boxes.push({ x, y, z, w, h, d, mat, ...(extra || {}) });

  // 외곽 벽: 충돌이 축에 나란한 박스만 지원하므로, 비스듬한 변은 2m 단위 계단 모양으로 쌓는다
  const STEP = 2;
  for (let z = -LEN; z < LEN; z += STEP) {
    const w = Math.max(halfWidth(z), halfWidth(z + STEP));
    for (const side of [1, -1]) add(side * (w + 1), 0, z + STEP / 2, 2, WALL_H, STEP, 'concrete');
  }
  add(0, 0, -LEN - 0.5, 2 * END_W + 4, WALL_H, 1, 'concrete');
  add(0, 0, LEN + 0.5, 2 * END_W + 4, WALL_H, 1, 'concrete');

  // 중앙 창고 (지붕 있음, 사방에 문)
  building(add, 0, 0, 18, 20, 4, 'brick', {
    n: [{ at: -5, w: 1.8, type: 'door' }, { at: 4, w: 1.8, type: 'window' }],
    s: [{ at: 5, w: 1.8, type: 'door' }, { at: -4, w: 1.8, type: 'window' }],
    e: [{ at: -6, w: 1.8, type: 'door' }, { at: 3, w: 1.6, type: 'window' }],
    w: [{ at: 6, w: 1.8, type: 'door' }, { at: -3, w: 1.6, type: 'window' }],
  }, true);
  add(-3, 0, -3, 0.3, 4, 8, 'brick');   // 내부 칸막이
  add(3, 0, 3, 0.3, 4, 8, 'brick');
  add(0, 0, 0, 3, 1.1, 1, 'concrete');  // 내부 낮은 엄폐물
  crate(add, 5.5, -6.5, 1.2); crate(add, -5.5, 6.5, 1.2);
  crate(add, -6.5, -7, 1.0); crate(add, 6.5, 7, 1.0);

  // 원점 대칭 배치 (아래는 위쪽 절반 기준으로 적는다)
  for (const s of [1, -1]) {
    const B = (x, y, z, w, h, d, mat, e) => add(s * x, y, s * z, w, h, d, mat, e);

    // 스폰 구역 앞 벽 (문 2개 + 창)
    wallRun(B, true, -41, -11, 11, 2.8, 0.35, [{ at: -6, w: 2, type: 'door' }, { at: 6, w: 2, type: 'door' }, { at: 0, w: 2, type: 'window' }], 'concrete');

    // 스폰 구역 바로 앞
    container(B, -5, -33, true, 0x8a3324);
    crate(B, 11, -34, 1.8); crate(B, 11.4, -32.3, 1.1);
    barrel(B, 6, -31, 0x35506b); barrel(B, 6.8, -31.5, 0x7a2a1e);

    // ㄱ자 벽
    wallRun(B, true, -27, 2, 10, 2.6, 0.35, [], 'brick');
    wallRun(B, false, 2.2, -27, -21.5, 2.6, 0.35, [], 'brick');

    // 컨테이너 (2단)
    container(B, -9, -21, true, 0x2f5d8a);
    container(B, -9, -21, true, 0x3f6b45, 2.59);

    // 낮은 콘크리트 블록, 상자
    B(13, 0, -16, 7, 1.2, 2.4, 'concrete');
    crate(B, -19, -18, 1.5); crate(B, -17.6, -18.5, 1.0);
    barrier(B, -3, -14.5, true);
    sandbags(B, 20, -21, 4, true);

    // 측면 오두막 (서쪽 문)
    building(B, 22, -6, 6, 7, 3, 'wood', {
      w: [{ at: -6, w: 1.6, type: 'door' }], s: [{ at: 22, w: 1.6, type: 'window' }], n: [], e: [],
    }, true);

    // 반대쪽 측면: 컨테이너와 꺾인 벽
    container(B, -19, -6, false, 0x9a7a1e);
    wallRun(B, false, -24.5, -4, 1, 2.6, 0.35, [], 'concrete');
    B(-23, 0, -4, 3, 2.6, 0.35, 'concrete');
  }

  return finishLayout(boxes, trees);
}

// 팀 스폰 지점 [x, z]. team[0] = 아래쪽(z>0), team[1] = 위쪽(z<0)
const TOP = [[-9, -46], [-4.5, -47.5], [0, -46], [4.5, -47.5], [9, -46], [-6.5, -44], [6.5, -44]];
const BOTTOM = TOP.map(([x, z]) => [-x, -z]);

export default {
  id: 'warehouse', name: '창고', half: LEN + 2, build,
  spawns: { team: [BOTTOM, TOP], ffa: [...BOTTOM, ...TOP] },
};
