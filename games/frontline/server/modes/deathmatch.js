// 데스매치 규칙: 킬이 곧 점수. 개인전은 개인 킬, 팀전은 팀 합계 킬이 목표에 먼저 닿으면 승리.
export function createDeathmatch(room) {
  return {
    reset() {},
    // 킬 처리. 반환: true 면 경기 끝
    onKill(killer) {
      if (room.cfg.teams) { room.teamScores[killer.team]++; return room.teamScores[killer.team] >= room.goal; }
      return killer.kills >= room.goal;
    },
    tick() { return false; },
    snapshot() { return {}; },
    objective() { return null; }, // 봇이 할 일이 없을 때 갈 곳 (없음 = 돌아다니기)
  };
}
