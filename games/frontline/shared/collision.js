// 서버/클라이언트 공용 충돌 판정 (THREE 의존 없음)
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function normalOf(i) { return NORMALS[i] || NORMALS[2]; }

export function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, n = -1;
  // X
  if (Math.abs(d.x) < 1e-9) { if (o.x < b.minX || o.x > b.maxX) return null; }
  else {
    let t1 = (b.minX - o.x) / d.x, t2 = (b.maxX - o.x) / d.x, nn = 1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = 0; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.y) < 1e-9) { if (o.y < b.minY || o.y > b.maxY) return null; }
  else {
    let t1 = (b.minY - o.y) / d.y, t2 = (b.maxY - o.y) / d.y, nn = 3;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = 2; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.z) < 1e-9) { if (o.z < b.minZ || o.z > b.maxZ) return null; }
  else {
    let t1 = (b.minZ - o.z) / d.z, t2 = (b.maxZ - o.z) / d.z, nn = 5;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = 4; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (n < 0) return null; // 박스 내부에서 시작
  return { t: tmin, n };
}

// ───── 경사로 ─────
// 경사로 충돌 박스: 보통 박스에 ramp = { axis: 'x'|'z', up: 1|-1 } 가 붙은 것. minY = 바닥, maxY = 높은 쪽 꼭대기.
// 윗면은 axis 방향으로 up 쪽이 높아지는 평면. 그 아래는 꽉 차 있다 (쐐기 모양).
const rampU = (c, x, z) => (c.ramp.axis === 'x' ? x : z);
const rampLen = c => (c.ramp.axis === 'x' ? c.maxX - c.minX : c.maxZ - c.minZ);
// (x, z) 에서 경사로 윗면 높이 (범위 밖이면 가까운 끝)
export function rampHeight(c, x, z) {
  const lo = c.ramp.axis === 'x' ? c.minX : c.minZ, len = rampLen(c);
  let f = (rampU(c, x, z) - lo) / len;
  if (c.ramp.up < 0) f = 1 - f;
  return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
}
// 반지름 r 인 발이 (x, z) 에 있을 때 발밑 경사로의 가장 높은 곳 (발이 닿는 높이)
export function rampTop(c, x, z, r) {
  const hiX = c.ramp.axis === 'x' ? (c.ramp.up > 0 ? Math.min(x + r, c.maxX) : Math.max(x - r, c.minX)) : x;
  const hiZ = c.ramp.axis === 'z' ? (c.ramp.up > 0 ? Math.min(z + r, c.maxZ) : Math.max(z - r, c.minZ)) : z;
  return rampHeight(c, hiX, hiZ);
}
// 광선과 쐐기: 박스 범위를 지나는 구간에서, 윗면 평면 아래에 있는 첫 지점
export function rayRamp(o, d, c, maxT) {
  let tmin = 0, tmax = maxT, n = -1;
  for (const [ax, lo, hi, nLo, nHi] of [['x', c.minX, c.maxX, 1, 0], ['y', c.minY, c.maxY, 3, 2], ['z', c.minZ, c.maxZ, 5, 4]]) {
    if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < lo || o[ax] > hi) return null; continue; }
    let t1 = (lo - o[ax]) / d[ax], t2 = (hi - o[ax]) / d[ax], nn = nLo;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = nHi; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // 윗면 아래쪽: f(t) = y - 윗면높이 <= 0  (f 는 t 에 대해 1차식)
  const k = (c.maxY - c.minY) / rampLen(c), lo = c.ramp.axis === 'x' ? c.minX : c.minZ, hi = c.ramp.axis === 'x' ? c.maxX : c.maxZ;
  const ou = c.ramp.axis === 'x' ? o.x : o.z, du = c.ramp.axis === 'x' ? d.x : d.z;
  const A = c.ramp.up > 0 ? o.y - c.minY - k * (ou - lo) : o.y - c.minY - k * (hi - ou);
  const B = c.ramp.up > 0 ? d.y - k * du : d.y + k * du;
  if (Math.abs(B) < 1e-12) { if (A > 0) return null; }
  else if (B > 0) { tmax = Math.min(tmax, -A / B); }
  else { const t = -A / B; if (t > tmin) { tmin = t; n = 2; } } // 윗면으로 들어감 (위를 향한 면으로 친다)
  if (tmin > tmax || n < 0) return null;
  return { t: tmin, n };
}

export function rayWorld(o, d, colliders, maxT = 400) {
  let best = maxT, n = -1;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const h = c.ramp ? rayRamp(o, d, c, best) : rayBox(o, d, c, best);
    if (h && h.t < best) { best = h.t; n = h.n; }
  }
  if (d.y < -1e-6) { // 지면
    const t = -o.y / d.y;
    if (t > 0 && t < best) { best = t; n = 2; }
  }
  return { t: best, n };
}
