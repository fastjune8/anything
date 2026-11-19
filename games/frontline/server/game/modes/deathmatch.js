// 팀 데스매치 · 개인전 (기획 7.1 보조 모드): 킬이 점수. 시간이 끝나면 앞선 쪽, 같으면 무승부.
export function createDeathmatch(room) {
  const teams = !!room.cfg.teams;
  const best = () => { let b = null; for (const P of room.players.values()) if (!b || P.kills > b.kills) b = P; return b; };
  return {
    zones: [],
    reset() {},
    onKill(att, vic) { if (att && att !== vic && teams && att.team >= 0) room.scores[att.team]++; },
    tick(dt, timeUp) {
      if (teams) {
        const [a, b] = room.scores;
        if (a >= room.goal || b >= room.goal) return { over: true, winner: a >= b ? 0 : 1 };
        if (timeUp) return { over: true, winner: a === b ? -1 : a > b ? 0 : 1 };
        return { over: false };
      }
      const top = best();
      if (top && top.kills >= room.goal) return { over: true, winner: -1, top: top.id };
      if (timeUp) {
        const list = [...room.players.values()].sort((x, y) => y.kills - x.kills);
        return { over: true, winner: -1, top: list[0] && (!list[1] || list[0].kills > list[1].kills) ? list[0].id : -1 };
      }
      return { over: false };
    },
    snapshot() { return {}; },
    objectiveFor() { return null; },
    nearestPoint() { return null; },
  };
}
