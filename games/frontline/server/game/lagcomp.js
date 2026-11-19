// 랙 보정 (favor-the-shooter): 서버는 매 tick 모든 플레이어의 자세를 1초 기록한다.
// 쏜 사람의 입력에는 "그때 화면에 보이던 서버 시각(vt, tick 소수)" 이 붙어 오고, 서버는 다른 사람들을 그 순간으로 되감아 판정한다.
// 되감기는 MAX_REWIND_TICKS(0.3초)까지 — 그보다 핑이 높으면 그만큼만 보정된다.
import { HISTORY_TICKS, MAX_REWIND_TICKS, BODY } from '../../shared/sim/config.js';

export const crouchOf = ps => Math.max(0, Math.min(1.4, (BODY.STAND_H - ps.h) / (BODY.STAND_H - BODY.CROUCH_H)));

export function record(P, n) {
  const ps = P.ps, h = P.hist || (P.hist = []);
  h.push({ n, x: ps.x, y: ps.y, z: ps.z, crouch: crouchOf(ps), alive: P.alive });
  if (h.length > HISTORY_TICKS) h.shift();
}
// tick 소수 vt 의 자세 (앞뒤 기록 사이를 잇는다)
export function poseAt(P, vt) {
  const h = P.hist;
  if (!h || !h.length) return { x: P.ps.x, y: P.ps.y, z: P.ps.z, crouch: crouchOf(P.ps), alive: P.alive };
  if (vt >= h[h.length - 1].n) return h[h.length - 1];
  if (vt <= h[0].n) return h[0];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1], b = h[i];
    if (a.n <= vt) {
      const k = b.n === a.n ? 0 : (vt - a.n) / (b.n - a.n);
      if (!a.alive || !b.alive) return k < 0.5 ? a : b;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: a.crouch + (b.crouch - a.crouch) * k, alive: true };
    }
  }
  return h[0];
}
export const clampVt = (vt, now) => Math.max(now - MAX_REWIND_TICKS, Math.min(now, Number.isFinite(vt) && vt > 0 ? vt : now));
