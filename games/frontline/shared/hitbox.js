// 사람 몸의 명중 판정 (다리·몸통 상자 + 머리 구, 기울이면 상체가 엉덩이를 축으로 옆으로 기운다).
// 브라우저(내가 쏠 때 판정)와 서버(랙 보정 검증)가 같은 모양을 쓴다. THREE 의존 없음.
//   pose = { x, y, z(발 위치), crouch(0~1), yaw, lean(-1~1) }
import { LEAN_ANGLE } from './constants.js';
import { rayBox } from './collision.js';

const lerp = (a, b, t) => a + (b - a) * t;
const box = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

// 기울인 상체: 높이 y 의 점이 옆으로 나가는 거리와 내려가는 거리
export function leanShift(lean, hipY, y) {
  const a = lean * LEAN_ANGLE, l = y - hipY;
  return { side: Math.sin(a) * l, drop: (1 - Math.cos(a)) * Math.abs(l) };
}

// o = 광선 시작점 {x,y,z}, d = 방향(길이 1), maxT = 이보다 먼 것은 무시, pad = 판정을 이만큼 넓힌다(서버 검증의 여유)
// 반환: { t(거리), part: 'head'|'body'|'leg' } 또는 null
export function hitPose(e, o, d, maxT, pad = 0) {
  const c = e.crouch || 0, lean = e.lean || 0;
  const legTop = lerp(0.86, 0.43, c), torsoTop = lerp(1.47, 1.0, c), headY0 = lerp(1.61, 1.14, c), hipY = lerp(0.86, 0.45, c);
  const rx = Math.cos(e.yaw || 0), rz = -Math.sin(e.yaw || 0); // 오른쪽 방향
  const body = leanShift(lean, hipY, (legTop + torsoTop) / 2), head = leanShift(lean, hipY, headY0);
  const headY = headY0 - head.drop;
  let best = null, cx = e.x, cz = e.z;
  const set = (hw, y0, y1) => { hw += pad; box.minX = cx - hw; box.maxX = cx + hw; box.minZ = cz - hw; box.maxZ = cz + hw; box.minY = e.y + y0 - pad; box.maxY = e.y + y1 + pad; };
  set(0.2, 0, legTop);
  let h = rayBox(o, d, box, maxT);
  if (h) best = { t: h.t, part: 'leg' };
  cx = e.x + rx * body.side; cz = e.z + rz * body.side; // 몸통은 기운 만큼 옆으로
  set(0.25, legTop, torsoTop - body.drop);
  h = rayBox(o, d, box, best ? best.t : maxT);
  if (h) best = { t: h.t, part: 'body' };
  // 머리 (구)
  const ox = o.x - (e.x + rx * head.side), oy = o.y - (e.y + headY), oz = o.z - (e.z + rz * head.side), r = 0.15 + pad;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < (best ? best.t : maxT)) best = { t, part: 'head' };
  }
  return best;
}
