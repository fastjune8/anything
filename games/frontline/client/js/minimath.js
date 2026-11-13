// 미니맵 좌표 계산 (DOM·THREE 에 의존하지 않아서 단위 테스트가 가능하다)
// 규칙: 내가 보는 방향이 화면 위쪽. yaw 는 게임의 시선 각도 (앞 = (-sin yaw, -cos yaw), 오른쪽 = (cos yaw, -sin yaw))

// 월드 좌표(wx, wz) → 미니맵 중심 기준 화면 좌표(px, 위가 -y). k = 1m 당 픽셀 수
export function toMini(px, pz, yaw, wx, wz, k) {
  const dx = wx - px, dz = wz - pz;
  return { x: (dx * Math.cos(yaw) - dz * Math.sin(yaw)) * k, y: (dx * Math.sin(yaw) + dz * Math.cos(yaw)) * k };
}

// 미니맵(반지름 radiusPx 의 원) 안에 들어오는가
export function inMini(p, radiusPx, margin = 4) { return Math.hypot(p.x, p.y) <= radiusPx - margin; }

// 적을 미니맵에 보여 줄지: 총을 쏜 지 showMs 이내일 때만 (벽 너머 위치를 계속 알려 주지 않는다)
export function enemyVisible(now, shotAt, showMs = 2000) { return now - shotAt <= showMs; }
