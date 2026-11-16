// 넘어가기/오르기: 플레이어 앞의 낮은 구조물(창문 턱, 모래주머니, 콘크리트 방벽, 상자 …)을 찾아
// 어디로 어떻게 넘어갈지 계산한다. 순수 함수 (THREE·DOM 의존 없음, 단위 테스트 대상).
//  - vault  : 얇은 장애물을 넘어 반대편에 내려선다 (창문은 몸을 숙여 통과)
//  - mantle : 넓은 장애물 위로 올라선다
export const VAULT = {
  REACH: 0.9,       // 몸 중심에서 이 거리(+몸 반지름) 안에 장애물 앞면이 있어야 한다 (m)
  MAX_H: 1.35,      // 발 기준 이 높이까지 넘을 수 있다
  MAX_DEPTH: 1.3,   // 이보다 두꺼우면 넘지 않고 위로 올라선다
  MIN_CLEAR: 0.75,  // 장애물 윗면 위로 이만큼 비어 있어야 지나갈 수 있다 (창문 1.0m 는 통과)
  SPEED: 3.4,       // 넘어가는 동안 앞으로 가는 속도 (m/s)
  MAX_DROP: 1.2,    // 반대편이 이보다 낮으면 넘은 뒤 떨어진다
};
const SD = 0.05;    // 앞으로 훑는 간격 (m)

// (x, z) 를 중심으로 반지름 r 인 사각 기둥이 높이 [y0, y1] 에서 겹치는 물체들의 가장 높은 윗면 / 가장 낮은 아랫면
function scan(cs, x, z, r, y0, y1) {
  let top = -Infinity, bottom = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ && y1 > c.minY && y0 < c.maxY) {
      if (c.maxY > top) top = c.maxY;
      if (c.minY < bottom) bottom = c.minY;
    }
  }
  return { top, bottom };
}
// 발밑을 받쳐 주는 가장 높은 면 (yMax 이하). 없으면 지면 0
function support(cs, x, z, r, yMax) {
  let s = 0;
  for (const c of cs) if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ && c.maxY <= yMax + 0.001 && c.maxY > s) s = c.maxY;
  return s;
}
const fits = (cs, x, z, r, y, h) => scan(cs, x, z, r, y + 0.01, y + h).top === -Infinity;

// pos = {x, y, z} (발 위치), dir = {x, z} (바라보는 수평 방향, 길이 1)
// opts = { radius, standH, crouchH, minH(이보다 낮은 턱은 그냥 올라서므로 무시) }
// 반환: null 또는 { type, from, to: [x,y,z], top(넘는 높이), duck(지나가는 동안 몸 높이), crouch(도착 후 앉아야 하는가), dur(초) }
export function findVault(cs, pos, dir, opts) {
  const { radius: R, standH, crouchH, minH } = opts;
  const at = d => [pos.x + dir.x * d, pos.z + dir.z * d];

  // 1) 앞을 막는 것 찾기 (발목 높이의 턱은 제외)
  let d0 = -1;
  for (let d = 0; d <= VAULT.REACH + 1e-9; d += SD) {
    const [x, z] = at(d);
    if (scan(cs, x, z, R, pos.y + minH + 0.01, pos.y + standH).top > -Infinity) { d0 = d; break; }
  }
  if (d0 < 0) return null;

  // 2) 앞면 바로 안쪽의 윗면 높이 = 넘을 높이. 너무 높거나(벽) 위가 막혀 있으면(낮은 틈) 안 된다.
  const [fx, fz] = at(d0 + R + 0.06);
  const top = scan(cs, fx, fz, 0.05, pos.y + 0.01, pos.y + VAULT.MAX_H).top;
  const h = top - pos.y;
  if (!(h > minH && h <= VAULT.MAX_H)) return null;
  if (scan(cs, fx, fz, 0.05, top + 0.01, top + VAULT.MIN_CLEAR).top > -Infinity) return null;

  // 발 디딜 곳: 몸 중심의 앞뒤 0.25m 가 모두 윗면 위인가 (얇은 창문 턱에는 서지 않는다)
  const foothold = (x, z) => [-0.25, 0.25].every(k => support(cs, x + dir.x * k, z + dir.z * k, 0.02, top) >= top - 0.01);

  // 3) 앞으로 훑으며: 윗면 위에 설 수 있으면 올라설 자리, 장애물을 지나 내려설 수 있으면 넘어갈 자리
  let clear = 1.9, mantle = null, vault = null;
  for (let d = d0 + SD; d <= d0 + 2 * R + VAULT.MAX_DEPTH + 0.2; d += SD) {
    const [x, z] = at(d);
    const above = scan(cs, x, z, 0.15, top + 0.01, top + 1.9).bottom; // 지나가는 길 위의 천장 (창문 윗벽)
    if (above - top < VAULT.MIN_CLEAR) break;
    clear = Math.min(clear, above - top);
    const s = support(cs, x, z, R, top);
    if (s >= top - 0.01) { // 아직 장애물 위
      // 올라서기: 발 디딜 폭이 충분할 때만 (몸 중심 주변이 윗면 위). 창문 턱처럼 얇은 곳에는 서지 않는다
      if (!mantle && d - d0 >= R && foothold(x, z) && fits(cs, x, z, R, top, crouchH)) mantle = { to: [x, top, z], crouch: !fits(cs, x, z, R, top, standH) };
      continue;
    }
    if (d - d0 - 2 * R > VAULT.MAX_DEPTH) break; // 너무 두껍다
    const y = Math.max(s, top - VAULT.MAX_DROP);
    if (fits(cs, x, z, R, y, crouchH)) vault = { to: [x, y, z], crouch: !fits(cs, x, z, R, y, standH) };
    break;
  }

  const pick = vault ? { type: 'vault', ...vault } : mantle ? { type: 'mantle', ...mantle } : null;
  if (!pick) return null;
  const dist = Math.hypot(pick.to[0] - pos.x, pick.to[2] - pos.z);
  return {
    ...pick, from: [pos.x, pos.y, pos.z], top,
    duck: Math.min(standH, Math.max(0.7, clear - 0.15)),
    dur: Math.min(0.9, 0.22 + dist / VAULT.SPEED + h * 0.15),
  };
}
