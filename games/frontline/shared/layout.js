// 전장 배치 데이터 (THREE 의존 없음 — 서버/검증 스크립트에서도 사용 가능)
// box: x,z = 중심, y = 바닥 높이, w(x) h(y) d(z)

export const MAP_HALF = 60;

function wallRun(B, alongX, fixed, from, to, h, t, ops, mat) {
  ops = [...(ops || [])].sort((a, b) => a.at - b.at);
  const seg = (a, b, y0, y1) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const c = (a + b) / 2, len = b - a;
    if (alongX) B(c, y0, fixed, len, y1 - y0, t, mat);
    else B(fixed, y0, c, t, y1 - y0, len, mat);
  };
  let cur = from;
  for (const o of ops) {
    const a = o.at - o.w / 2, b = o.at + o.w / 2;
    seg(cur, a, 0, h);
    if (o.type === 'door') seg(a, b, 2.2, h);
    else { seg(a, b, 0, 1.0); seg(a, b, 2.0, h); }
    cur = b;
  }
  seg(cur, to, 0, h);
}

// ops: { n:[], s:[], e:[], w:[] } — at 은 벽을 따라가는 절대 좌표
function building(B, cx, cz, w, d, h, mat, ops, roof) {
  const t = 0.3;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  wallRun(B, true, z1 - t / 2, x0, x1, h, t, ops.n, mat);
  wallRun(B, true, z0 + t / 2, x0, x1, h, t, ops.s, mat);
  wallRun(B, false, x1 - t / 2, z0 + t, z1 - t, h, t, ops.e, mat);
  wallRun(B, false, x0 + t / 2, z0 + t, z1 - t, h, t, ops.w, mat);
  if (roof) B(cx, h, cz, w + 0.6, 0.25, d + 0.6, 'concreteDark');
}

function container(B, x, z, alongX, tint, y = 0) {
  B(x, y, z, alongX ? 6.06 : 2.44, 2.59, alongX ? 2.44 : 6.06, 'container', { tint });
}
function crate(B, x, z, s, y = 0) { B(x, y, z, s, s, s, 'crate', { fit: true }); }
function sandbags(B, x, z, len, alongX, h = 1.0) {
  B(x, 0, z, alongX ? len : 0.6, h, alongX ? 0.6 : len, 'sandbag');
}
function barrier(B, x, z, alongX) {
  B(x, 0, z, alongX ? 3 : 0.5, 1.05, alongX ? 0.5 : 3, 'concrete');
}
function barrel(B, x, z, tint) { B(x, 0, z, 0.6, 0.9, 0.6, 'barrel', { shape: 'cyl', tint }); }

function tower(B, x, z) {
  const top = 3.2;
  B(x, top - 0.2, z, 4, 0.2, 4, 'wood');
  for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
    B(x + dx, 0, z + dz, 0.25, top - 0.2, 0.25, 'wood');
    B(x + dx, top, z + dz, 0.12, 2.1, 0.12, 'wood');
  }
  B(x, top + 2.1, z, 4.6, 0.12, 4.6, 'metal');
  // 난간
  B(x, top, z - 1.94, 4, 1.0, 0.12, 'wood');
  B(x, top, z + 1.94, 4, 1.0, 0.12, 'wood');
  B(x + 1.94, top, z, 0.12, 1.0, 3.76, 'wood');
  B(x - 1.94, top, z - 1.25, 0.12, 1.0, 1.26, 'wood');
  B(x - 1.94, top, z + 1.25, 0.12, 1.0, 1.26, 'wood');
  // 계단 (서쪽에서 올라옴)
  const n = 10, rise = top / n, run = 0.45;
  for (let i = 0; i < n; i++) {
    const sx = x - 2 - run * n + run * (i + 0.5);
    B(sx, rise * (i + 1) - 0.12, z, run, 0.12, 1.2, 'wood');
  }
}

export function buildLayout() {
  const boxes = [];
  const trees = [];
  const add = (x, y, z, w, h, d, mat, extra) => boxes.push({ x, y, z, w, h, d, mat, ...(extra || {}) });

  // 외곽 벽
  const M = MAP_HALF;
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

    // 나무
    T(-54, -55, 1.2); T(54, -52, 1.0); T(-55, -30, 1.1); T(55, -12, 1.3);
    T(-10, -56, 1.0); T(20, -56, 1.15); T(-42, -15, 0.9); T(4, -47, 1.0);
  }

  for (const t of trees) add(t.x, 0, t.z, 0.5 * t.s, 5 * t.s, 0.5 * t.s, 'none', { invisible: true });

  const colliders = boxes.filter(b => !b.noCollide).map(b => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minY: b.y, maxY: b.y + b.h,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
  }));
  return { boxes, trees, colliders };
}
