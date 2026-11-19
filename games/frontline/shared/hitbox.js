// 사람 몸의 명중 판정 (다리·몸통 상자 + 머리 구).
// 브라우저(내가 쏠 때 판정)와 서버(랙 보정 검증)가 같은 모양을 쓴다. THREE 의존 없음.
//   pose = { x, y, z(발 위치), crouch(0~1) }
import { rayBox } from './collision.js';

const lerp = (a, b, t) => a + (b - a) * t;

// 판정 크기 [서 있을 때, 완전히 앉았을 때] — 캐릭터 모델(키 1.60m, content/characters/hyperfps_thirdperson_v_4.glb)에 맞춘 값
//   다리 = 발 ~ 사타구니, 몸통 = 사타구니 ~ 어깨 위(목 아래), 머리 = 구 (모델 머리 1.40~1.60m 의 가운데)
//   (예전 상자 병사 키 1.75m 기준: 몸통 1.47, 머리 1.61 / 0.15)
export const HITBOX = { legTop: [0.86, 0.43], torsoTop: [1.38, 0.94], headY: [1.50, 1.06], headR: 0.12, legHalf: 0.2, torsoHalf: 0.25 };
const box = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

// o = 광선 시작점 {x,y,z}, d = 방향(길이 1), maxT = 이보다 먼 것은 무시, pad = 판정을 이만큼 넓힌다(서버 검증의 여유)
// 반환: { t(거리), part: 'head'|'body'|'leg' } 또는 null
export function hitPose(e, o, d, maxT, pad = 0) {
  const c = e.crouch || 0;
  const H = HITBOX, legTop = lerp(H.legTop[0], H.legTop[1], c), torsoTop = lerp(H.torsoTop[0], H.torsoTop[1], c), headY = lerp(H.headY[0], H.headY[1], c);
  let best = null;
  const cx = e.x, cz = e.z;
  const set = (hw, y0, y1) => { hw += pad; box.minX = cx - hw; box.maxX = cx + hw; box.minZ = cz - hw; box.maxZ = cz + hw; box.minY = e.y + y0 - pad; box.maxY = e.y + y1 + pad; };
  set(H.legHalf, 0, legTop);
  let h = rayBox(o, d, box, maxT);
  if (h) best = { t: h.t, part: 'leg' };
  set(H.torsoHalf, legTop, torsoTop);
  h = rayBox(o, d, box, best ? best.t : maxT);
  if (h) best = { t: h.t, part: 'body' };
  // 머리 (구)
  const ox = o.x - e.x, oy = o.y - (e.y + headY), oz = o.z - e.z, r = H.headR + pad;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < (best ? best.t : maxT)) best = { t, part: 'head' };
  }
  return best;
}
