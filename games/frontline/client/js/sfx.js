// 소리: 효과음 재생기와 "위치 기준 소리 크기/좌우" 계산
import { Sfx } from './audio.js';
import { me } from './state.js';
import { clamp } from './util.js';

export const sfx = new Sfx();

// 소리가 난 위치 → 거리, 좌우 방향(pan), 감쇠(att)
export function audioAt(pos) {
  const dx = pos.x - me.pos.x, dz = pos.z - me.pos.z, dist = Math.hypot(dx, dz, pos.y - me.pos.y);
  const right = dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw);
  return { dist, pan: dist > 0.5 ? clamp(right / dist, -1, 1) * 0.85 : 0, att: 1 / (1 + dist / 9) };
}
