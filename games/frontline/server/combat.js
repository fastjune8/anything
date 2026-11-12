// 전투 규칙: 클라이언트가 보낸 명중 신호를 검증하고 대상별 피해로 합산한다 (순수 함수)
import { WEAPONS, calcDamage } from '../shared/weapons.js';

// m = { w: 무기번호, hits: [[부위, 거리, 대상id], ...] }
// 반환: { wi, damages: [{ victim, dmg, head }] } 또는 잘못된 신호면 null
export function resolveHits(players, attacker, m) {
  const wi = m.w | 0, weapon = WEAPONS[wi];
  if (!weapon || !Array.isArray(m.hits)) return null;
  const byVictim = new Map();
  for (const h of m.hits.slice(0, weapon.pellets)) {
    if (!Array.isArray(h)) continue;
    const victim = players.get(h[2] | 0);
    if (!victim || victim === attacker || !victim.alive) continue;
    const part = h[0] === 'head' || h[0] === 'leg' ? h[0] : 'body';
    const dist = Math.min(400, Math.max(0, Number(h[1]) || 0));
    const acc = byVictim.get(victim) || { dmg: 0, head: false };
    acc.dmg += calcDamage(wi, part, dist);
    if (part === 'head') acc.head = true;
    byVictim.set(victim, acc);
  }
  const damages = [];
  for (const [victim, { dmg, head }] of byVictim) {
    const rounded = Math.round(dmg);
    if (rounded > 0) damages.push({ victim, dmg: rounded, head });
  }
  return { wi, damages };
}
