// 점령전 거점 규칙 (기획 7.4~7.8, 순수 함수 · 단위 테스트 대상). 거점 개수·위치는 맵 데이터(content/maps 의 zones).
//   진행도와 소유권은 따로: pt = { owner: -1|0|1, team: 진행 중인 팀 -1|0|1, prog: 0~1 }
//   | 거점 안            | 진행도                                     |
//   | 점령 팀만          | 증가 (인원이 많을수록 빠르게)               |
//   | 양 팀 모두         | 멈춤 (경합)                                |
//   | 아무도 없음        | 그대로                                     |
//   | 소유 팀만          | 적이 쌓던 진행도 감소                       |
//   소유 팀이 한 명이라도 안에 있으면 적은 점령을 시작할 수 없다(= 경합). 다 차면 그 팀 소유, 진행도 0.
export function newPoint(def) { return { id: def.id, owner: -1, team: -1, prog: 0, n: [0, 0], contested: false }; }

// 인원 → 속도 배율 (cfg.speedup = [1명, 2명, …], 그보다 많으면 마지막 값)
export const capSpeed = (cfg, count) => cfg.speedup[Math.min(count, cfg.speedup.length) - 1];

// n = [0팀 인원, 1팀 인원]. 반환: 점령이 끝났으면 새 주인 팀, 아니면 -1
export function stepPoint(pt, n, dt, cfg) {
  pt.n = n;
  pt.contested = n[0] > 0 && n[1] > 0;
  if (pt.contested) return -1;
  const T = n[0] > 0 ? 0 : n[1] > 0 ? 1 : -1;
  if (T < 0) return -1;                                  // 아무도 없음: 그대로
  const rate = capSpeed(cfg, n[T]) * dt / cfg.capture;
  if (pt.team >= 0 && pt.team !== T) {                   // 상대가 쌓던 진행도를 먼저 깎는다 (소유 팀 방어 포함)
    pt.prog = Math.max(0, pt.prog - rate);
    if (pt.prog <= 0) { pt.prog = 0; pt.team = -1; }
    return -1;
  }
  if (pt.owner === T) return -1;                         // 소유 팀만 있고 깎을 것이 없음
  pt.team = T;
  pt.prog = Math.min(1, pt.prog + rate);
  if (pt.prog < 1) return -1;
  pt.owner = T; pt.team = -1; pt.prog = 0;
  return T;
}
// 거점 상태 이름 (HUD): neutral | owned | contested, + 진행 중인가
export const pointState = pt => (pt.contested ? 'contested' : pt.owner >= 0 ? 'owned' : 'neutral');

// 점수: 소유 중인 거점 하나가 초당 scoreRate 점 (모든 거점 같은 속도, 기획 7.6). acc = [0팀, 1팀] 소수점 누적
export function scoreTick(points, acc, dt, cfg) {
  for (const p of points) if (p.owner >= 0) acc[p.owner] += cfg.scoreRate * dt;
  return [Math.floor(acc[0] + 1e-9), Math.floor(acc[1] + 1e-9)];
}
// 경기 결과 판단 (기획 7.7·7.8). 반환: { over, winner(-1 = 무승부), overtime }
export function judge(scores, goal, timeUp, overtime, overtimeOver) {
  if (scores[0] >= goal || scores[1] >= goal) return { over: true, winner: scores[0] >= goal && scores[0] >= scores[1] ? 0 : 1, overtime };
  if (!timeUp) return { over: false, winner: -1, overtime: false };
  if (scores[0] !== scores[1]) return { over: true, winner: scores[0] > scores[1] ? 0 : 1, overtime };
  if (overtimeOver) return { over: true, winner: -1, overtime: true };
  return { over: false, winner: -1, overtime: true };    // 동점: 연장전 (진행 상황 그대로, 점수가 갈리는 순간 끝)
}
