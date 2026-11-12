// 마우스 이동량 필터: 마우스 잠금 상태에서 가끔 들어오는 "한 번 크게 튀는 값"을 걸러낸다.
// (커서가 화면 가장자리에서 가운데로 되돌려질 때 브라우저가 엉뚱하게 큰 이동량을 보내는 경우가 있다)
// DOM 에 의존하지 않아서 단위 테스트가 가능하다.
const SPIKE_MIN = 90;   // 이보다 작은 이동은 튀는 값으로 보지 않는다 (px)
const SPIKE_RATIO = 6;  // 최근 평균의 몇 배를 넘으면 튀는 값으로 보는가
const MAX_STEP = 250;   // 한 번에 인정하는 최대 이동량 (px)

export function createMouseFilter() {
  let avg = 0;   // 최근 이동량의 평균
  let skip = 0;  // 잠금 직후 버릴 이벤트 수
  return {
    // 마우스 잠금을 새로 얻었을 때: 직후 몇 개는 엉뚱한 값인 경우가 많아 버린다
    reset() { avg = 0; skip = 2; },
    // 반환: [dx, dy] 또는 null(버림)
    apply(dx, dy) {
      if (skip > 0) { skip--; return null; }
      const mag = Math.hypot(dx, dy);
      if (mag > SPIKE_MIN && mag > avg * SPIKE_RATIO + 40) {
        // 갑자기 튄 값 하나는 버린다. 다만 진짜로 빠르게 휘두르는 중이면 다음 값부터는 통과하도록 평균을 올려 둔다.
        avg = avg * 0.5 + mag * 0.5;
        return null;
      }
      avg = avg * 0.7 + mag * 0.3;
      const clampStep = v => Math.max(-MAX_STEP, Math.min(MAX_STEP, v));
      return [clampStep(dx), clampStep(dy)];
    },
  };
}
