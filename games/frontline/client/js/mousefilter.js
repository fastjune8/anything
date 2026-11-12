// 마우스 이동량 필터: 마우스 잠금 상태에서 가끔 들어오는 "혼자 크게 튀는 값"만 걸러낸다.
// 원칙: 실제 움직임은 버리거나 줄이지 않는다 (감도가 상황에 따라 달라지면 안 된다).
//  - 갑자기 큰 값이 들어오면 바로 버리지 않고 한 박자 보류한다.
//  - 바로 다음 값이 같은 방향으로 이어지면 실제로 빠르게 휘두른 것 → 보류한 값까지 그대로 반영한다.
//  - 이어지지 않으면(반대 방향이거나 갑자기 작아지거나 한참 뒤에 오면) 혼자 튄 값 → 버린다.
// DOM 에 의존하지 않아서 단위 테스트가 가능하다.
const SUSPECT_MIN = 150;  // 이보다 작은 이동은 의심하지 않는다 (px)
const SUSPECT_RATIO = 6;  // 최근 평균의 몇 배를 넘으면 의심하는가
const CONFIRM_MS = 50;    // 보류한 값을 "이어진 움직임"으로 인정하는 시간
const MAX_STEP = 400;     // 한 이벤트에서 인정하는 최대 이동량 (px) — 예전부터 쓰던 값

const clampStep = v => Math.max(-MAX_STEP, Math.min(MAX_STEP, v));

export function createMouseFilter() {
  let avg = 0;        // 최근 이동량 평균
  let skip = 0;       // 잠금 직후 버릴 이벤트 수
  let held = null;    // 보류 중인 의심 값 { dx, dy, mag, t }
  return {
    // 마우스 잠금을 새로 얻었을 때: 직후 첫 값은 엉뚱한 경우가 많아 버린다
    reset() { avg = 0; skip = 1; held = null; },
    // now: 현재 시각(ms). 반환: [dx, dy] 또는 null(이번에는 반영할 것 없음)
    apply(dx, dy, now) {
      if (skip > 0) { skip--; return null; }
      const mag = Math.hypot(dx, dy);

      if (held) {
        const h = held; held = null;
        const continues = now - h.t <= CONFIRM_MS && dx * h.dx + dy * h.dy > 0 && mag >= h.mag * 0.3;
        if (continues) { // 실제 휘두르기였다: 보류한 값 + 지금 값을 모두 반영
          avg = avg * 0.4 + ((h.mag + mag) / 2) * 0.6;
          return [clampStep(h.dx) + clampStep(dx), clampStep(h.dy) + clampStep(dy)];
        }
        // 혼자 튄 값이었다: 보류한 값은 버리고 지금 값은 아래에서 평소대로 처리
      }

      if (mag > SUSPECT_MIN && mag > avg * SUSPECT_RATIO + 60) { held = { dx, dy, mag, t: now }; return null; }
      avg = avg * 0.7 + mag * 0.3;
      return [clampStep(dx), clampStep(dy)];
    },
  };
}
