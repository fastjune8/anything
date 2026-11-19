// 히트스캔 판정 (서버 권한 판정 + 브라우저 연출이 같이 쓴다). 벽(rayWorld) → 사람 판정 모양(shared/hitbox.js).
//   pierce > 0 이면 사람을 뚫고 지나가 뒤의 사람까지 맞힌다 (대구경 스킬). 벽은 뚫지 않는다.
//   targets = [{ id, x, y, z, crouch }]  (서버는 되감은 자세, 브라우저는 화면에 보이는 자세)
import { rayWorld } from '../collision.js';
import { hitPose } from '../hitbox.js';

// 반환: { end: {x,y,z}, n: 벽 면 번호(-1 = 사람에 막힘), hits: [{ id, part, t }] }
export function castRay(o, d, range, cs, targets, pierce = 0, skipId = -1) {
  const wall = rayWorld(o, d, cs, range);
  const found = [];
  for (const tg of targets) {
    if (tg.id === skipId) continue;
    const h = hitPose(tg, o, d, wall.t);
    if (h) found.push({ id: tg.id, part: h.part, t: h.t });
  }
  found.sort((a, b) => a.t - b.t);
  const hits = found.slice(0, 1 + pierce);
  const stopT = hits.length > pierce ? hits[hits.length - 1].t : wall.t;
  return { end: { x: o.x + d.x * stopT, y: o.y + d.y * stopT, z: o.z + d.z * stopT }, n: hits.length > pierce ? 6 : wall.n, hits };
}

// 근접 공격: 정면 부채꼴로 광선 5개, 가장 가까운 한 명 (머리 판정 없음)
const MELEE_FAN = [0, -0.18, 0.18, -0.34, 0.34];
export function castMelee(o, yaw, pitch, range, cs, targets, skipId = -1) {
  let best = null;
  for (const a of MELEE_FAN) {
    const y = yaw + a, d = { x: -Math.sin(y) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(y) * Math.cos(pitch) };
    const r = castRay(o, d, range, cs, targets, 0, skipId);
    if (r.hits.length && (!best || r.hits[0].t < best.t)) best = { ...r.hits[0], part: 'body', end: r.end };
  }
  return best;
}
