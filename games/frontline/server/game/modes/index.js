// 모드 규칙 목록. content/modes.json 의 rules 이름 → 규칙을 만드는 함수.
// 규칙 객체: reset() · onKill(att, vic) · tick(dt, timeUp, overtimeOver) → { over, winner, top? } · snapshot() · objectiveFor(P) · nearestPoint(x, z)
import { createDomination } from './domination.js';
import { createDeathmatch } from './deathmatch.js';

const RULES = { domination: createDomination, deathmatch: createDeathmatch };
export function createRules(room) {
  const make = RULES[room.cfg.rules];
  if (!make) throw new Error(`없는 모드 규칙: ${room.cfg.rules}`);
  return make(room);
}
