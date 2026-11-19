// 무기 데이터와 피해 계산 (서버·브라우저·스튜디오 공용). 데이터는 content/weapons.json, 칸 설명은 shared/content/schema.js 의 WEAPON_SCHEMA.
//   기획 2.3·2.4: 무기마다 이동 속도(move), 달리기 중 사격(sprintFire)·슬라이딩 중 사격(slideFire), 교체 속도(draw)가 다르다.
//   각도 단위는 도(degree), 거리 m, 시간 s
import data from '../content/weapons.json' with { type: 'json' };
import { checkWeapons } from './content/schema.js';
import models from '../content/models.json' with { type: 'json' };
import skills from '../content/skills.json' with { type: 'json' };

export const WEAPONS = data;
{
  const errors = checkWeapons(WEAPONS, models.map(m => m.id), skills.map(s => s.id));
  if (errors.length) throw new Error('무기 데이터 오류 (content/weapons.json):\n  ' + errors.join('\n  '));
}
export const weaponIndex = id => WEAPONS.findIndex(w => w.id === id);
export const isMelee = w => w && w.kind === 'melee';
export const DEFAULT_LOADOUT = ['ar', 'revolver']; // 처음 들고 가는 두 자루

// 거리 감쇠까지 반영한 한 발(산탄은 한 알)의 피해. w: 무기 번호 또는 무기 객체, part: head|body|leg
// opts.headMul: 헤드샷 배율에 곱할 값 (뱅! 스킬)
export function calcDamage(w, part, dist, opts = null) {
  if (typeof w === 'number') w = WEAPONS[w];
  if (!w) return 0;
  let d = w.dmg;
  if (part === 'head') d *= w.head * ((opts && opts.headMul) || 1);
  else if (part === 'leg') d *= 0.8;
  if (w.falloff) {
    const [a, b, m] = w.falloff;
    const k = Math.min(1, Math.max(0, (dist - a) / (b - a)));
    d *= 1 - (1 - m) * k;
  }
  return d;
}
