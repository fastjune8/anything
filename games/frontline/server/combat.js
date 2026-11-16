// 전투 규칙: 클라이언트가 보낸 명중 신호를 검증하고 대상별 피해로 합산한다 (순수 함수)
import { WEAPONS, calcDamage } from '../shared/weapons.js';

// m = { w: 무기번호, hits: [[부위, 거리, 대상id], ...] }
// 반환: { wi, damages: [{ victim, dmg, head }] } 또는 잘못된 신호(없는 무기, 들고 있지 않은 무기)면 null
export function resolveHits(players, attacker, m) {
  const wi = m.w | 0;
  // 사람은 들고 들어온 무기(파츠 반영)로만 맞힐 수 있다. wstats 가 없는 경우(단위 테스트의 단순 객체)는 기본 성능.
  const weapon = attacker.wstats ? attacker.wstats[wi] : WEAPONS[wi];
  if (!weapon || !Array.isArray(m.hits)) return null;
  const byVictim = new Map();
  for (const h of m.hits.slice(0, weapon.pellets)) {
    if (!Array.isArray(h)) continue;
    const victim = players.get(h[2] | 0);
    if (!victim || victim === attacker || !victim.alive) continue;
    const part = h[0] === 'head' || h[0] === 'leg' ? h[0] : 'body';
    // 거리: 서버가 아는 두 사람의 위치로 잰다 (브라우저가 보낸 거리는 위치를 모를 때만 = 단위 테스트의 단순 객체)
    const dist = attacker.pos && victim.pos ? Math.hypot(attacker.pos[0] - victim.pos[0], attacker.pos[1] - victim.pos[1], attacker.pos[2] - victim.pos[2])
      : Math.min(400, Math.max(0, Number(h[1]) || 0));
    const acc = byVictim.get(victim) || { dmg: 0, head: false };
    acc.dmg += calcDamage(weapon, part, dist);
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
