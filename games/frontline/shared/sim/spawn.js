// 리스폰 위치 고르기 (기획 5.5, 순수 함수 · 단위 테스트 대상)
//   team 방식(점령전): 팀별 고정 스폰 중 무작위 (직전 자리·막 다른 사람이 쓴 자리는 피함)
//   dynamic 방식(팀 데스매치·개인전): 점수로 고른다 — 가장 먼 곳이 아니라
//     · 적이 너무 가깝거나 보이는 곳은 크게 감점 · 적과 적당한 거리(교전에 바로 낄 수 있음)는 가점
//     · 아군 근처 가점 · 목표(거점) 가까우면 가점 · 최근 많이 쓴 자리는 감점 (한 곳에 몰리지 않게)
export function scoreSpawn(s, ctx) {
  const [x, z] = s;
  let score = 0, nearestEnemy = Infinity;
  for (const e of ctx.enemies) {
    const d = Math.hypot(e.x - x, e.z - z);
    nearestEnemy = Math.min(nearestEnemy, d);
    if (d < 10) score -= 400;
    else if (d < 18) score -= 120;
    if (d < 45 && ctx.sees && ctx.sees(e, x, z)) score -= 150;
  }
  if (nearestEnemy !== Infinity && nearestEnemy >= 18 && nearestEnemy <= 42) score += 40; // 바로 싸우러 갈 수 있는 거리
  for (const a of ctx.allies) { const d = Math.hypot(a.x - x, a.z - z); if (d > 4 && d < 22) score += 15; }
  if (ctx.objective) { const d = Math.hypot(ctx.objective.x - x, ctx.objective.z - z); score += Math.max(0, 30 - d) * 0.8; }
  score -= (ctx.used.get(s) || 0) * 35;
  if (s === ctx.last) score -= 200;
  return score;
}
export function pickDynamic(spawns, ctx, rnd = Math.random) {
  const ranked = spawns.map(s => ({ s, v: scoreSpawn(s, ctx) + rnd() * 12 })).sort((a, b) => b.v - a.v);
  return ranked[0].s;
}
export function pickTeam(spawns, ctx, rnd = Math.random) {
  const fresh = spawns.filter(s => s !== ctx.last && !(ctx.used.get(s) > 1));
  const pool = fresh.length ? fresh : spawns;
  return pool[Math.floor(rnd() * pool.length)];
}
