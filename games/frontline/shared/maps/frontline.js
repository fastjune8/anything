// 맵: 전선 (개인전) — 넓은 야외 전장
import { wallRun, building, container, crate, sandbags, barrier, barrel, tower, finishLayout } from './parts.js';

const HALF_SIZE = 60; // 맵 절반 크기 (m)

function build() {
  const boxes = [];
  const trees = [];
  const add = (x, y, z, w, h, d, mat, extra) => boxes.push({ x, y, z, w, h, d, mat, ...(extra || {}) });

  // 외곽 벽
  const M = HALF_SIZE;
  add(0, 0, -M - 0.5, 2 * M + 2, 4.5, 1, 'concrete');
  add(0, 0, M + 0.5, 2 * M + 2, 4.5, 1, 'concrete');
  add(-M - 0.5, 0, 0, 1, 4.5, 2 * M, 'concrete');
  add(M + 0.5, 0, 0, 1, 4.5, 2 * M, 'concrete');

  // 중앙 폐허 (지붕 없음)
  building(add, 0, 0, 16, 12, 3.4, 'brick', {
    s: [{ at: -4, w: 1.6, type: 'door' }, { at: 3, w: 1.8, type: 'window' }],
    n: [{ at: 4, w: 1.6, type: 'door' }, { at: -3, w: 1.8, type: 'window' }],
    e: [{ at: 2.5, w: 1.6, type: 'door' }, { at: -2.5, w: 1.6, type: 'window' }],
    w: [{ at: -2.5, w: 1.6, type: 'door' }, { at: 2.5, w: 1.6, type: 'window' }],
  }, false);
  add(-5, 0, 0, 5.4, 3.4, 0.3, 'brick');
  add(5, 0, 0, 5.4, 3.4, 0.3, 'brick');
  crate(add, -1.2, 3.5, 1.1); crate(add, 1.2, -3.5, 1.1);
  crate(add, -6.5, -4.2, 1.0); crate(add, 6.5, 4.2, 1.0);

  // 원점 대칭 배치
  for (const s of [1, -1]) {
    const B = (x, y, z, w, h, d, mat, e) => add(s * x, y, s * z, w, h, d, mat, e);
    const T = (x, z, sc) => trees.push({ x: s * x, z: s * z, s: sc });

    // 기지 건물
    building(B, -30, -42, 12, 9, 3.2, 'concrete', {
      n: [{ at: -30, w: 1.6, type: 'door' }, { at: -34, w: 1.6, type: 'window' }, { at: -26, w: 1.6, type: 'window' }],
      s: [{ at: -27, w: 1.6, type: 'window' }],
      e: [{ at: -42, w: 1.6, type: 'door' }],
      w: [{ at: -41, w: 1.6, type: 'window' }],
    }, true);
    crate(B, -34.5, -44.8, 1.2);

    // 감시탑
    tower(B, 34, -36);

    // 벽돌 담
    wallRun(B, true, -26, -8, 14, 2.8, 0.35, [{ at: 4, w: 1.8, type: 'door' }, { at: -3, w: 1.8, type: 'window' }], 'brick');

    // 창고
    building(B, 45, -4, 7, 6, 3.0, 'brick', {
      w: [{ at: -4, w: 1.6, type: 'door' }],
      n: [{ at: 45, w: 1.6, type: 'window' }],
      s: [{ at: 45, w: 1.6, type: 'window' }],
      e: [],
    }, true);

    // 컨테이너
    container(B, -16, -12, true, 0x8a3324);
    container(B, -21.5, -17, false, 0x2f5d8a);
    container(B, -16, -12, true, 0x3f6b45, 2.59);
    container(B, 22, -11, false, 0x9a7a1e);
    container(B, 26.5, -15, true, 0x2f5d8a);
    container(B, -44, -24, true, 0x596066);

    // 모래주머니
    sandbags(B, 0, -15, 5, true);
    sandbags(B, -34, -22, 4, false);
    sandbags(B, 38, -17, 4.5, true);
    sandbags(B, 12, -42, 4, true);
    sandbags(B, -52, -6, 4, true);

    // 콘크리트 방호벽
    barrier(B, 9, -19, false);
    barrier(B, -27, -29, true);
    barrier(B, -6, -36, true);
    barrier(B, 16, -33, false);
    barrier(B, 33, -3, false);

    // 상자
    crate(B, 12.5, -9, 1.3); crate(B, 13.9, -9.3, 0.9); crate(B, 12.6, -9.1, 0.8, 1.3);
    crate(B, -38, -8, 1.4); crate(B, -36.6, -8.4, 0.9);
    crate(B, 30, -24, 1.2); crate(B, 31.3, -24.2, 1.0);
    crate(B, -11, -31, 1.1);
    crate(B, 19, -46, 1.3);
    crate(B, -4, -20.5, 1.0);

    // 드럼통
    barrel(B, -24, -31, 0x7a2a1e); barrel(B, -24.8, -31.6, 0x35506b);
    barrel(B, 14.8, -27, 0x7a2a1e);
    barrel(B, 43, -22, 0x4a5a32); barrel(B, 43.8, -22.3, 0x4a5a32);
    barrel(B, -46, -33, 0x35506b);
    barrel(B, 28.5, -8, 0x7a2a1e);

    // 외곽 엄폐물 (스폰 지점 주변과 가장자리 통로가 뻥 뚫려 있던 문제 보완)
    container(B, -12, -50, true, 0x596066);
    container(B, 14, -50, false, 0x8a3324);
    container(B, 40, -50, true, 0x3f6b45);
    container(B, -54, -26, false, 0x9a7a1e);
    container(B, 54, -40, false, 0x2f5d8a);
    container(B, 46, -27, true, 0x596066);
    container(B, -56, -2, false, 0x3f6b45);
    sandbags(B, -39, -49, 4, false);
    sandbags(B, 24, -44, 4, true);
    sandbags(B, -22, -38, 4, true);
    barrier(B, -48, -36, true);
    barrier(B, 50, -30, true);
    barrier(B, -36, -32, false);
    barrier(B, 3, -44, false);
    barrier(B, 40, -42, true);
    crate(B, -48, -18, 1.4); crate(B, -46.6, -18.4, 1.0);
    crate(B, -20, -48, 1.2);
    crate(B, 56, -18, 1.3);
    crate(B, 27, -52, 1.2); crate(B, 28.2, -51.6, 0.9);

    // 나무
    T(-54, -55, 1.2); T(54, -52, 1.0); T(-55, -30, 1.1); T(55, -12, 1.3);
    T(-10, -56, 1.0); T(20, -56, 1.15); T(-42, -15, 0.9); T(4, -47, 1.0);
  }

  return finishLayout(boxes, trees);
}

// 부활 지점 [x, z] — 맵은 원점 대칭 (개인전용)
const HALF = [[0, -54], [-30, -53], [-47, -46], [30, -53], [48, -48], [-52, -14], [52, -24], [-20, -56], [40, -56], [-56, -34]];
const SPAWNS = [...HALF, ...HALF.map(([x, z]) => [-x, -z])];

export default { id: 'frontline', name: '전선', half: HALF_SIZE, build, spawns: { ffa: SPAWNS } };
