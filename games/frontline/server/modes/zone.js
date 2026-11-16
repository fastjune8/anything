// 점령전 규칙: 거점 하나. 한 팀만 안에 있으면 점령 게이지가 차고, 다 차면 그 팀의 거점이 된다.
// 거점을 가진 팀은 교전(양 팀이 함께 안에 있음)이 아닐 때 1초마다 1점. 먼저 목표 점수에 닿거나, 시간이 끝났을 때 앞선 팀이 승리.

// 거점 상태 한 단계 진행 (순수 함수, 단위 테스트 대상)
// z = { owner: -1|0|1, capTeam: -1|0|1, progress: 0~1, contested }, n = [0팀 인원, 1팀 인원], cfg = 모드의 zone 설정
// 반환: 이번 단계에서 점령이 끝났으면 새 주인 팀, 아니면 -1
export function stepZone(z, n, dt, cfg) {
  const rate = dt / cfg.capture;
  z.contested = n[0] > 0 && n[1] > 0;
  if (z.contested) return -1; // 교전 중: 게이지가 멈춘다
  const team = n[0] > 0 ? 0 : n[1] > 0 ? 1 : -1;
  if (team < 0 || team === z.owner) { // 아무도 없거나 주인만 있음: 남이 채우던 게이지가 줄어든다
    z.progress = Math.max(0, z.progress - rate * (team < 0 ? cfg.decay : 2));
    if (z.progress === 0) z.capTeam = -1;
    return -1;
  }
  const speed = Math.min(2, 1 + 0.5 * (n[team] - 1)); // 인원이 많을수록 빠르게 (최대 2배)
  if (z.capTeam !== team && z.progress > 0) { // 상대가 채우던 게이지를 먼저 깎는다
    z.progress = Math.max(0, z.progress - rate * speed);
    if (z.progress === 0) z.capTeam = -1;
    return -1;
  }
  z.capTeam = team;
  z.progress = Math.min(1, z.progress + rate * speed);
  if (z.progress < 1) return -1;
  z.owner = team; z.capTeam = -1; z.progress = 0;
  return team;
}

const DEFAULT_ZONE = { id: 'A', name: '거점', x: 0, z: 0, r: 6 };
const SEND_MS = 200; // 거점 상태를 이 간격으로 보낸다 (바뀌었을 때만)

export function createZone(room) {
  const cfg = room.cfg.zone;
  const area = (room.map.zones && room.map.zones[0]) || DEFAULT_ZONE; // 거점이 없는 맵이면 맵 가운데
  let z, scoreAcc, sendAcc, lastSent;

  const inside = p => p.alive && p.pos && Math.hypot(p.pos[0] - area.x, p.pos[2] - area.z) <= area.r && p.pos[1] < cfg.height;
  const state = () => ({ o: z.owner, ct: z.capTeam, p: Math.round(z.progress * 100) / 100, c: z.contested ? 1 : 0, n: z.n });

  const rules = {
    area,
    reset() { z = { owner: -1, capTeam: -1, progress: 0, contested: false, n: [0, 0] }; scoreAcc = 0; sendAcc = 0; lastSent = ''; },
    onKill() { return false; }, // 킬은 점수가 아니다
    // 반환: true 면 경기 끝
    tick(dt) {
      const n = [0, 0];
      for (const p of room.players.values()) if (inside(p) && (p.team === 0 || p.team === 1)) n[p.team]++;
      z.n = n;
      const captured = stepZone(z, n, dt, cfg);
      if (captured >= 0) { scoreAcc = 0; room.broadcast({ t: 'zcap', team: captured }); }
      let ended = false;
      if (z.owner >= 0 && !z.contested) {
        scoreAcc += dt;
        while (scoreAcc >= cfg.pointEvery) {
          scoreAcc -= cfg.pointEvery;
          room.teamScores[z.owner] = Math.min(room.goal, room.teamScores[z.owner] + 1);
          if (room.teamScores[z.owner] >= room.goal) ended = true;
        }
      }
      sendAcc += dt * 1000;
      if (sendAcc >= SEND_MS || captured >= 0 || ended) {
        sendAcc = 0;
        const s = state(), key = JSON.stringify([s, room.teamScores]);
        if (key !== lastSent) { lastSent = key; room.broadcast({ t: 'zone', ...s, ts: room.teamScores }); }
      }
      return ended;
    },
    snapshot() { return { zone: state() }; },
    // 봇: 싸울 상대가 없으면 거점으로. 반환: { x, z, r }
    objective() { return area; },
  };
  rules.reset();
  return rules;
}
