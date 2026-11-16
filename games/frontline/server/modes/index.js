// 모드 규칙 목록. shared/modes.js 의 rules 이름 → 규칙을 만드는 함수.
// 규칙 객체가 갖춰야 할 것:
//   reset()            새 경기 시작
//   onKill(killer, victim) → true 면 경기 끝
//   tick(dt)           → true 면 경기 끝 (방이 50ms 마다 부른다)
//   snapshot()         welcome / start 메시지에 더할 값
//   objective(player)  봇이 싸울 상대가 없을 때 갈 곳 { x, z, r } (없으면 null)
import { createDeathmatch } from './deathmatch.js';
import { createZone } from './zone.js';

const RULES = { deathmatch: createDeathmatch, zone: createZone };

export function createRules(room) {
  const make = RULES[room.cfg.rules];
  if (!make) throw new Error(`없는 모드 규칙: ${room.cfg.rules}`);
  return make(room);
}
