// 무기 데이터와 피해 계산 (서버와 클라이언트 공용)
// 각도 단위는 도(degree), 거리 m, 시간 s
import data from '../content/weapons.json' with { type: 'json' };
import { checkWeapons } from './content/schema.js';

// 무기 데이터는 content/weapons.json (칸 설명은 shared/content/schema.js 의 WEAPON_SCHEMA)
export const WEAPONS = data;
{
  const errors = checkWeapons(WEAPONS);
  if (errors.length) throw new Error('무기 데이터 오류 (content/weapons.json):\n  ' + errors.join('\n  '));
}

// w: 무기 번호, 또는 파츠가 반영된 성능 객체(shared/parts.js 의 applyParts 결과)
export function calcDamage(w, part, dist) {
  if (typeof w === 'number') w = WEAPONS[w];
  if (!w) return 0;
  let d = w.dmg;
  if (part === 'head') d *= w.head;
  else if (part === 'leg') d *= 0.75;
  if (w.falloff) {
    const [a, b, m] = w.falloff;
    const k = Math.min(1, Math.max(0, (dist - a) / (b - a)));
    d *= 1 - (1 - m) * k;
  }
  return d;
}
