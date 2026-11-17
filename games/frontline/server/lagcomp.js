// 랙 보정 (M1 마무리): 쏜 사람이 "보고 있던 순간" 으로 상대를 되돌려 놓고 명중 신고를 확인한다.
//   서버는 0.05초(한 tick)마다 모든 플레이어의 위치·자세를 기록하고(2초), 그 tick 번호를 위치와 함께 보낸다(`s` 의 n).
//   브라우저는 명중을 알릴 때 쏜 눈 위치, 쏜 방향, 그때 보던 상대 위치의 tick 번호를 함께 보낸다.
//   서버는 그 tick 의 자세로 같은 판정 모양(shared/hitbox.js)에 광선을 쏴 본다:
//     - 광선이 상대 몸을 지나지 않으면 / 사이에 벽이 있으면 / 쏜 위치가 실제 위치와 너무 다르면 → 버린다
//     - 맞힌 부위는 서버가 계산한 부위 (머리라고 속여도 소용없다)
import { hitPose } from '../shared/hitbox.js';
import { rayWorld } from '../shared/collision.js';

export const HISTORY = 40;     // 기록하는 tick 수 (2초)
export const MAX_REWIND = 20;  // 되돌릴 수 있는 최대 tick (1초). 이보다 옛날을 봤다는 신고는 1초 전으로 본다
export const PAD = 0.15;       // 판정 여유 (m): tick 사이 움직임·화면의 부드러운 이동 때문에 생기는 차이
export const ORIGIN_TOL = 2.2; // 쏜 눈 위치와 서버가 아는 위치의 허용 차이 (m): 기울이기·네트워크 지연 중 이동

// 이번 tick 의 모든 살아 있는 플레이어 자세를 기록한다 (room.tick 끝에서)
export function recordHistory(room) {
  const n = room.tickN;
  for (const p of room.players.values()) {
    if (!p.alive || !p.pos) continue;
    const h = p.hist || (p.hist = []);
    h.push({ n, x: p.pos[0], y: p.pos[1], z: p.pos[2], crouch: p.crouch ? 1 : 0 });
    if (h.length > HISTORY) h.shift();
  }
}

// tick n 의 자세 (없으면 가장 가까운 것)
export function poseAt(p, n) {
  const h = p.hist;
  if (!h || !h.length) return p.pos ? { x: p.pos[0], y: p.pos[1], z: p.pos[2], crouch: p.crouch ? 1 : 0 } : null;
  if (n >= h[h.length - 1].n) return h[h.length - 1];
  if (n <= h[0].n) return h[0];
  for (let i = h.length - 1; i >= 0; i--) if (h[i].n <= n) return h[i];
  return h[0];
}

// 명중 신고 하나 확인. 반환: { part, dist } 또는 null (인정 안 함)
export function verifyHit(room, attacker, victim, origin, dir, n, claimed) {
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) return null;
  if (!Array.isArray(dir) || dir.length !== 3 || !dir.every(Number.isFinite)) return null;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len < 0.5 || len > 1.5) return null;
  const o = { x: origin[0], y: origin[1], z: origin[2] }, d = { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len };
  // 쏜 위치: 서버가 아는 쏜 사람의 눈 근처여야 한다
  const ap = attacker.pos, eye = (attacker.crouch ? 1.07 : 1.62);
  if (!ap || Math.hypot(o.x - ap[0], o.y - (ap[1] + eye), o.z - ap[2]) > ORIGIN_TOL) return null;
  // 그 순간의 상대 자세 (앞뒤 tick 도 본다: 화면은 tick 사이를 부드럽게 잇는다)
  const now = room.tickN, at = Math.max(now - MAX_REWIND, Math.min(now, Number.isInteger(n) ? n : now));
  let exact = null, loose = null;
  for (const k of [at, at - 1, at + 1]) {
    const pose = poseAt(victim, k);
    if (!pose) continue;
    exact = exact || hitPose(pose, o, d, 400, 0);
    loose = loose || hitPose(pose, o, d, 400, PAD);
  }
  const hit = exact || loose;
  if (!hit) return null;
  // 벽 너머는 안 된다
  if (rayWorld(o, d, room.map.layout.colliders, hit.t).t < hit.t - 0.05) return null;
  // 부위: 정확히 맞은 부위. 여유로만 맞은 경우 머리라는 신고는 몸으로 (여유로 헤드샷 이득을 보지 않게)
  const part = exact ? exact.part : claimed === 'head' ? 'body' : hit.part;
  return { part, dist: hit.t };
}
