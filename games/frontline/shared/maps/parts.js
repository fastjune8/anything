// 맵을 조립하는 부품들 (THREE 의존 없음 — 서버에서도 쓴다)
// B(x, y, z, w, h, d, mat, extra): 박스 하나를 추가하는 함수. x,z = 중심, y = 바닥 높이, w(x) h(y) d(z)


export function wallRun(B, alongX, fixed, from, to, h, t, ops, mat) {
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
export function building(B, cx, cz, w, d, h, mat, ops, roof) {
  const t = 0.3;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  wallRun(B, true, z1 - t / 2, x0, x1, h, t, ops.n, mat);
  wallRun(B, true, z0 + t / 2, x0, x1, h, t, ops.s, mat);
  wallRun(B, false, x1 - t / 2, z0 + t, z1 - t, h, t, ops.e, mat);
  wallRun(B, false, x0 + t / 2, z0 + t, z1 - t, h, t, ops.w, mat);
  if (roof) B(cx, h, cz, w + 0.6, 0.25, d + 0.6, 'concreteDark');
}

export function container(B, x, z, alongX, tint, y = 0) {
  B(x, y, z, alongX ? 6.06 : 2.44, 2.59, alongX ? 2.44 : 6.06, 'container', { tint });
}
export function crate(B, x, z, s, y = 0) { B(x, y, z, s, s, s, 'crate', { fit: true }); }
export function sandbags(B, x, z, len, alongX, h = 1.0) {
  B(x, 0, z, alongX ? len : 0.6, h, alongX ? 0.6 : len, 'sandbag');
}
export function barrier(B, x, z, alongX) {
  B(x, 0, z, alongX ? 3 : 0.5, 1.05, alongX ? 0.5 : 3, 'concrete');
}
export function barrel(B, x, z, tint) { B(x, 0, z, 0.6, 0.9, 0.6, 'barrel', { shape: 'cyl', tint }); }

export function tower(B, x, z) {
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


// 박스 목록 → 충돌용 AABB 목록까지 묶어서 맵 배치 완성
export function finishLayout(boxes, trees) {
  for (const t of trees) boxes.push({ x: t.x, y: 0, z: t.z, w: 0.5 * t.s, h: 5 * t.s, d: 0.5 * t.s, mat: 'none', invisible: true });
  const colliders = boxes.filter(b => !b.noCollide).map(b => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minY: b.y, maxY: b.y + b.h,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    ...(b.ramp ? { ramp: b.ramp } : {}), // 경사로: 윗면이 기울어진 쐐기 (shared/collision.js)
  }));
  return { boxes, trees, colliders };
}
