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

export function rayWorld(o, d, colliders, maxT = 400) {
  let best = maxT, n = -1;
  for (let i = 0; i < colliders.length; i++) {
    const h = rayBox(o, d, colliders[i], best);
    if (h && h.t < best) { best = h.t; n = h.n; }
  }
  if (d.y < -1e-6) { // 지면
    const t = -o.y / d.y;
    if (t > 0 && t < best) { best = t; n = 2; }
  }
  return { t: best, n };
}
