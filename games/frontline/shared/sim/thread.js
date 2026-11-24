// 듀얼 쿠나이 와이어 네트워크 (W9) — 서버·브라우저 공용, 결정적. 기획: docs/weapons/DUAL_KUNAI.md 의 W9
//   노드(node) = 와이어를 걸 수 있는 점: 0 = 왼손 쿠나이 앵커, 1 = 오른손 쿠나이 앵커, 2·3 = 핀 노드 (F 로 조준한 곳에 박는다, 충전식 2개)
//   선분(segment) = 두 노드 사이 와이어. 노드마다 "세대(ng)"를 두어, 노드가 빠졌다 다시 박혀도 예전 와이어가 새 노드를 가리키지 않게 한다
//   네트워크 = 설치 모드에서 스킬 키를 누를 때 지금 노드들로 한 번에 만든다 (노드를 박은 순서대로):
//     노드 2개 → 직선 1개 · 3개 → 삼각 영역 · 4개 → 사각(다각형) 영역, 단 첫 두 노드 선과 뒤 두 노드 선이 엇갈리면(위에서 볼 때) 교차형 와이어 2개
//   수명은 따로: 앵커 20초 · 핀 20초 · 와이어 8초(선분마다) · 영역 8초. 노드가 빠지면 그 노드의 선분만, 영역은 변이 하나라도 빠지면 없어진다
//   사람 판정(와이어 감지·영역 진입/이탈·끊기)은 서버(server/game/room.js)가 이 파일의 기하로 한다
import { rayWorld } from '../collision.js';
import { eyeY } from './movement.js';
import { BTN } from './config.js';

export const THREAD = {
  wireLife: 8, areaLife: 8,
  maxNodes: 4, maxSeg: 4,
  minLen: 1, maxLen: 30, clearTol: 0.25,          // 선분 길이 한도 · 사이가 막혔는지 볼 때 끝에서 봐주는 거리
  pin: { charges: 2, recharge: 12, life: 20, range: 35 }, // 핀 노드: 충전 수 · 충전 시간 · 유지 시간 · 박을 수 있는 거리
  area: { min: 4, max: 450, down: 1.5, up: 2.5, cd: 3, reveal: 2.5, slow: 0 }, // 영역 넓이(위에서 본 m²) 한도 · 노드 높이 기준 아래/위 감지 범위 · 같은 적 재알림 · 위치 표시 · (확장용) 진입 감속, 0 = 끔
};
const ANCHOR = 2; // shared/sim/kunai.js 의 KS.ANCHOR

const newPin = () => ({ on: false, x: 0, y: 0, z: 0, t: 0, n: 2 });
export function resetThread(ps) { ps.pins = [newPin(), newPin()]; ps.pinCh = THREAD.pin.charges; ps.pinRe = 0; ps.ng = [0, 0, 0, 0]; ps.gc = 0; ps.wires = []; ps.area = null; }
export function copyThread(dst, src) {
  if (!src.pins) { resetThread(dst); return; }
  dst.pins = src.pins.map(p => ({ ...p })); dst.pinCh = src.pinCh; dst.pinRe = src.pinRe; dst.ng = [...src.ng]; dst.gc = src.gc;
  dst.wires = src.wires.map(w => ({ ...w })); dst.area = src.area ? { n: [...src.area.n], g: [...src.area.g], t: src.area.t } : null;
}
// 노드를 새로 박았다 → 세대 올리기
export const markNode = (ps, i) => { ps.ng[i] = ++ps.gc; };
export function nodePos(ps, i) {
  if (i < 2) { const k = ps.ku && ps.ku[i]; return k && k.s === ANCHOR ? k : null; }
  const p = ps.pins && ps.pins[i - 2]; return p && p.on ? p : null;
}
const nodeAlive = (ps, i, g) => !!nodePos(ps, i) && ps.ng[i] === g;
// 지금 쓸 수 있는 노드 (박은 순서대로)
export function activeNodes(ps) {
  const out = [];
  for (let i = 0; i < THREAD.maxNodes; i++) { const p = nodePos(ps, i); if (p) out.push({ i, g: ps.ng[i], x: p.x, y: p.y, z: p.z }); }
  return out.sort((a, b) => a.g - b.g);
}
export const wireOn = ps => !!(ps.wires && ps.wires.length);
export const wireTime = ps => (ps.wires && ps.wires.length ? Math.max(...ps.wires.map(w => w.t)) : 0);
export const pinCount = ps => (ps.pins ? ps.pins.filter(p => p.on).length : 0);
export function segEnds(ps, w) { const a = nodePos(ps, w.a), b = nodePos(ps, w.b); return [{ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }]; }

// ───── 기하 (위에서 본 x-z 평면) ─────
const cross2 = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
export function segsCrossXZ(p1, p2, q1, q2) { // 끝이 아닌 곳에서 엇갈리는가
  const d1 = cross2(q1, q2, p1), d2 = cross2(q1, q2, p2), d3 = cross2(p1, p2, q1), d4 = cross2(p1, p2, q2);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
export function polyArea(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.z - b.x * a.z; } return Math.abs(s) / 2; }
export function selfCrossing(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue; // 이웃한 변
    if (segsCrossXZ(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
  }
  return false;
}
export function inPolyXZ(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
// 두 노드 사이에 와이어를 걸 수 있나. 반환: null = 된다, 아니면 이유
export function segProblem(cs, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < THREAD.minLen) return '노드가 너무 가깝다';
  if (len > THREAD.maxLen) return `와이어는 ${THREAD.maxLen}m 까지`;
  const h = rayWorld(a, { x: dx / len, y: dy / len, z: dz / len }, cs, len);
  if (h.t < len - THREAD.clearTol && h.t > THREAD.clearTol) return '노드 사이가 막혀 있다';
  return null;
}

// 지금 노드로 만들 네트워크 (바꾸지 않고 계획만 — HUD 미리보기와 설치가 같이 쓴다)
// 반환 { kind: 'line'|'path'|'cross'|'area', segs: [[i, j]], area: [i...] | null, fail: 이유 | null }
export function planThread(ps, cs) {
  const nodes = activeNodes(ps), n = nodes.length;
  if (n < 2) return { kind: null, segs: [], area: null, fail: '노드가 2개 이상 필요하다 (쿠나이 앵커·핀)' };
  let kind, order = nodes, segs, area = null;
  if (n === 2) { kind = 'line'; segs = [[0, 1]]; }
  else if (n === 4 && segsCrossXZ(nodes[0], nodes[1], nodes[2], nodes[3])) { kind = 'cross'; segs = [[0, 1], [2, 3]]; }
  else {
    if (selfCrossing(order)) { // 박은 순서로 이으면 꼬인다 → 가운데를 기준으로 돌아가는 순서로
      const cx = nodes.reduce((s, p) => s + p.x, 0) / n, cz = nodes.reduce((s, p) => s + p.z, 0) / n;
      order = [...nodes].sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
    }
    const A = polyArea(order);
    if (A < THREAD.area.min) return { kind: 'area', segs: [], area: null, fail: `영역이 너무 작다 (${A.toFixed(1)}m²)` };
    if (A > THREAD.area.max) return { kind: 'area', segs: [], area: null, fail: '영역이 너무 크다' };
    kind = 'area'; segs = order.map((_, k) => [k, (k + 1) % n]); area = order.map(p => p.i);
  }
  for (const [u, v] of segs) {
    const why = segProblem(cs, order[u], order[v]);
    if (why) return { kind, segs: [], area: null, fail: why };
  }
  return { kind, segs: segs.map(([u, v]) => [order[u].i, order[v].i]), area, fail: null };
}
export const KIND_NAME = { line: '직선 와이어', cross: '교차 와이어', area: '영역', path: '와이어' };

// 설치 모드의 스킬 키: 지금 노드로 네트워크를 새로 만든다 (있던 와이어·영역은 바꿔 놓는다). 반환: 됐나
export function buildThread(ps, cs, ev) {
  const plan = planThread(ps, cs);
  if (plan.fail) { ev.kunaiFail = plan.fail; return false; }
  ps.wires = plan.segs.map(([a, b]) => ({ a, b, ga: ps.ng[a], gb: ps.ng[b], t: THREAD.wireLife }));
  ps.area = plan.area ? { n: plan.area, g: plan.area.map(i => ps.ng[i]), t: THREAD.areaLife } : null;
  ev.wire = true; ev.threadKind = plan.kind;
  return true;
}
// 영역이 아직 살아 있나: 노드가 그대로이고 변(선분)이 모두 남아 있다
export function areaValid(ps) {
  const ar = ps.area;
  if (!ar || ar.t <= 0) return false;
  const n = ar.n.length;
  for (let k = 0; k < n; k++) {
    if (!nodeAlive(ps, ar.n[k], ar.g[k])) return false;
    const a = ar.n[k], b = ar.n[(k + 1) % n];
    if (!ps.wires.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return false;
  }
  return true;
}
// 영역 모양 (위에서 본 다각형) + 감지 높이 범위
export function areaShape(ps) {
  const pts = ps.area.n.map(i => nodePos(ps, i));
  const ys = pts.map(p => p.y);
  return { poly: pts.map(p => ({ x: p.x, z: p.z })), y0: Math.min(...ys) - THREAD.area.down, y1: Math.max(...ys) + THREAD.area.up };
}
export function inArea(shape, x, y, z) { return y >= shape.y0 && y <= shape.y1 && inPolyXZ(shape.poly, x, z); }

// 핀 노드 박기: 조준한 곳 (35m 안의 벽·바닥). 빈 자리가 없으면 오래된 핀을 옮긴다
function placePin(ps, cs, ev) {
  if (ps.pinCh <= 0) { ev.kunaiFail = `핀 노드 충전 중 (${Math.ceil(THREAD.pin.recharge - ps.pinRe)}초)`; return; }
  const d = { x: -Math.sin(ps.yaw) * Math.cos(ps.pitch), y: Math.sin(ps.pitch), z: -Math.cos(ps.yaw) * Math.cos(ps.pitch) }, o = { x: ps.x, y: eyeY(ps), z: ps.z };
  const h = rayWorld(o, d, cs, THREAD.pin.range);
  if (h.t >= THREAD.pin.range) { ev.kunaiFail = '핀을 박을 곳이 없다'; return; }
  let s = ps.pins.findIndex(p => !p.on);
  if (s < 0) s = ps.ng[2] <= ps.ng[3] ? 0 : 1;
  const t = h.t - 0.03, p = ps.pins[s];
  p.on = true; p.x = o.x + d.x * t; p.y = o.y + d.y * t; p.z = o.z + d.z * t; p.t = THREAD.pin.life; p.n = h.n;
  markNode(ps, 2 + s);
  ps.pinCh--;
  (ev.pin || (ev.pin = [])).push(s);
}

// 1 tick: 핀 박기(F, 쿠나이를 든 동안) · 충전 · 핀·선분·영역 수명과 연결 정리
export function stepThread(ps, cs, dt, ev, held, act, press) {
  if (!ps.pins) resetThread(ps);
  if (held && act && ps.drawT <= 0 && press(BTN.node)) placePin(ps, cs, ev);
  if (ps.pinCh < THREAD.pin.charges) { ps.pinRe += dt; if (ps.pinRe >= THREAD.pin.recharge) { ps.pinRe = 0; ps.pinCh++; } } else ps.pinRe = 0;
  for (let s = 0; s < ps.pins.length; s++) {
    const p = ps.pins[s];
    if (!p.on) continue;
    p.t -= dt;
    if (p.t <= 0) { p.on = false; (ev.pinExpire || (ev.pinExpire = [])).push(s); }
  }
  if (ps.wires.length) {
    const before = ps.wires.length;
    for (const w of ps.wires) w.t -= dt;
    ps.wires = ps.wires.filter(w => w.t > 0 && nodeAlive(ps, w.a, w.ga) && nodeAlive(ps, w.b, w.gb));
    if (ps.wires.length < before) ev.wireEnd = true;
  }
  if (ps.area) { ps.area.t -= dt; if (!areaValid(ps)) { ps.area = null; ev.areaEnd = true; } }
}
