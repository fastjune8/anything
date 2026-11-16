// 봇 길찾기: 맵을 격자로 바꾸고 A* 로 경로를 찾는다 (서버 전용)
// 맵마다 격자가 다르므로 createNav(map) 으로 맵별 길찾기 객체를 만든다. navFor(mapId) 는 한 번 만든 것을 재사용.
import { getMap } from '../../shared/maps/index.js';

const cache = new Map();
export function navFor(mapId) {
  if (!cache.has(mapId)) cache.set(mapId, createNav(getMap(mapId)));
  return cache.get(mapId);
}
export function forgetNav(mapId) { cache.delete(mapId); } // 맵이 바뀌면 (에디터 저장) 다음에 새로 만든다

// 반환: { COLLIDERS, isBlocked(x,z), findPath(sx,sz,tx,tz), randomReachablePoint(), pointNear(x,z,r) }
export function createNav(map) {
  const COLLIDERS = map.layout.colliders;
  const half = map.half;

  // ───────── 내비게이션 그리드 ─────────
  const CELL = 0.5;                 // 칸 크기(m)
  const R = 0.32;                   // 봇 반지름 (장애물을 이만큼 부풀려서 막힘 판정)
  const N = Math.round((2 * half) / CELL);
  const blocked = new Uint8Array(N * N);
  const reach = new Uint8Array(N * N); // 주 구역(스폰에서 걸어갈 수 있는 곳)

  const cellOf = v => Math.min(N - 1, Math.max(0, Math.floor((v + half) / CELL)));
  const centerOf = i => -half + (i + 0.5) * CELL;
  const isBlocked = (x, z) => blocked[cellOf(z) * N + cellOf(x)] === 1;

  // 서 있는 몸통 높이를 막는 물체만 장애물로 본다 (문 위 가로대·지붕·창문 위쪽은 통과 가능)
  for (const c of COLLIDERS) {
    if (!(c.minY < 1.6 && c.maxY > 0.5)) continue;
    const x0 = cellOf(c.minX - R), x1 = cellOf(c.maxX + R);
    const z0 = cellOf(c.minZ - R), z1 = cellOf(c.maxZ + R);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const px = centerOf(cx), pz = centerOf(cz);
        if (px >= c.minX - R && px <= c.maxX + R && pz >= c.minZ - R && pz <= c.maxZ + R) blocked[cz * N + cx] = 1;
      }
    }
  }

  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

  function canStep(cx, cz, dx, dz) {
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) return false;
    if (blocked[nz * N + nx]) return false;
    if (dx && dz && (blocked[cz * N + nx] || blocked[nz * N + cx])) return false; // 모서리 끼임 방지
    return true;
  }

  // 스폰 지점에서 flood fill 로 갈 수 있는 구역 표시
  (function markReachable() {
    const start = map.spawns.ffa[0];
    let s = cellOf(start[1]) * N + cellOf(start[0]);
    if (blocked[s]) { // 가장 가까운 빈 칸
      for (let r = 1; r < 20 && blocked[s]; r++) {
        for (let dz = -r; dz <= r && blocked[s]; dz++) for (let dx = -r; dx <= r; dx++) {
          const i = (cellOf(start[1]) + dz) * N + cellOf(start[0]) + dx;
          if (i >= 0 && i < N * N && !blocked[i]) { s = i; break; }
        }
      }
    }
    const stack = [s]; reach[s] = 1;
    while (stack.length) {
      const cur = stack.pop(), cx = cur % N, cz = (cur / N) | 0;
      for (const [dx, dz] of DIRS) {
        if (!canStep(cx, cz, dx, dz)) continue;
        const ni = (cz + dz) * N + cx + dx;
        if (!reach[ni]) { reach[ni] = 1; stack.push(ni); }
      }
    }
  })();

  function nearestReach(x, z) {
    const cx = cellOf(x), cz = cellOf(z);
    if (reach[cz * N + cx]) return cz * N + cx;
    for (let r = 1; r < 24; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          if (reach[nz * N + nx]) return nz * N + nx;
        }
      }
    }
    return -1;
  }

  // 이진 힙 (A* 열린 목록)
  const hI = [], hF = [];
  function hPush(i, f) {
    let k = hI.length; hI.push(i); hF.push(f);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hF[p] <= hF[k]) break;
      [hI[p], hI[k]] = [hI[k], hI[p]]; [hF[p], hF[k]] = [hF[k], hF[p]]; k = p;
    }
  }
  function hPop() {
    const top = hI[0], li = hI.pop(), lf = hF.pop();
    if (hI.length) {
      hI[0] = li; hF[0] = lf;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hI.length && hF[l] < hF[m]) m = l;
        if (r < hI.length && hF[r] < hF[m]) m = r;
        if (m === k) break;
        [hI[m], hI[k]] = [hI[k], hI[m]]; [hF[m], hF[k]] = [hF[k], hF[m]]; k = m;
      }
    }
    return top;
  }

  const seen = new Uint32Array(N * N), done = new Uint32Array(N * N);
  const gScore = new Float32Array(N * N), parent = new Int32Array(N * N);
  let stamp = 0;

  function lineFree(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, steps = Math.ceil(Math.hypot(dx, dz) / 0.25);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (isBlocked(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  // 반환: [[x,z], ...] (현재 위치 제외) 또는 null
  function findPath(sx, sz, tx, tz) {
    const s = nearestReach(sx, sz), g = nearestReach(tx, tz);
    if (s < 0 || g < 0) return null;
    const gx = g % N, gz = (g / N) | 0;
    const heur = (x, z) => { const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return dx + dz - 0.586 * Math.min(dx, dz); };
    stamp++; hI.length = 0; hF.length = 0;
    seen[s] = stamp; gScore[s] = 0; parent[s] = -1; hPush(s, 0);
    let expanded = 0;
    while (hI.length) {
      const cur = hPop();
      if (done[cur] === stamp) continue;
      done[cur] = stamp;
      if (cur === g) break;
      if (++expanded > 60000) return null;
      const cx = cur % N, cz = (cur / N) | 0;
      for (const [dx, dz, cost] of DIRS) {
        if (!canStep(cx, cz, dx, dz)) continue;
        const ni = (cz + dz) * N + cx + dx, ng = gScore[cur] + cost;
        if (seen[ni] !== stamp || ng < gScore[ni]) {
          seen[ni] = stamp; gScore[ni] = ng; parent[ni] = cur; hPush(ni, ng + heur(cx + dx, cz + dz));
        }
      }
    }
    if (seen[g] !== stamp || done[g] !== stamp) return null;

    const pts = [];
    for (let c = g; c !== -1; c = parent[c]) pts.push([centerOf(c % N), centerOf((c / N) | 0)]);
    pts.reverse();
    // 직선으로 갈 수 있는 구간은 건너뛰어 경로를 다듬는다
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 24);
      while (j > i + 1 && !lineFree(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }

  function randomReachablePoint() {
    for (let k = 0; k < 200; k++) {
      const cx = (Math.random() * N) | 0, cz = (Math.random() * N) | 0;
      if (reach[cz * N + cx]) return [centerOf(cx), centerOf(cz)];
    }
    return map.spawns.ffa[0];
  }

  // (x, z) 에서 반지름 r 안의, 걸어서 갈 수 있는 무작위 지점 (점령전 거점 등). 못 찾으면 null
  function pointNear(x, z, r) {
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, i = cellOf(pz) * N + cellOf(px);
      if (reach[i] && !blocked[i]) return [centerOf(cellOf(px)), centerOf(cellOf(pz))];
    }
    return null;
  }

  return { COLLIDERS, isBlocked, findPath, randomReachablePoint, pointNear };
}
