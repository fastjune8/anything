// 마우스 이상치 필터 (포인터 락 movementX/Y 스파이크 방어). DOM 에 의존하지 않는 순수 로직 — tests/mousefilter.test.mjs
//   Chrome(특히 macOS)은 포인터 락 직후·창 포커스 변화·커서가 가장자리에 닿을 때 가끔 비정상적으로 큰 movementX 를 한 번 보낸다.
//   예전의 고정 ±400 클램프는 그 한 번이 시점을 약 50° 돌리는 걸 막지 못했다.
//   고립된 스파이크만 버리고, 빠른 플릭(점점 커지는 연속 이벤트)과 프레임 정지 뒤에 몰려 온 합산 값은 그대로 통과시킨다.
export const LOCK_SKIP = 2;     // 포인터 락 직후 첫 이벤트 몇 개는 버린다 (락 직후의 위치 보정 값이 섞여 온다)
export const SPIKE_ABS = 160;   // px. 이보다 작으면 아무리 갑작스러워도 정상으로 본다 (감도 1.05 기준 약 20°) — 빠른 플릭의 첫 이벤트가 걸리지 않게
export const SPIKE_RATIO = 6;   // 최근 크기(지수 평균 최대)의 이 배수를 넘으면 의심
export const GAP_MAX_MS = 40;   // 직전 이벤트와의 간격이 이보다 길면(프레임 정지 뒤 몰린 합산 값) 의심하지 않는다 — 실제 손 움직임의 합이다
export const HARD_MAX = 1500;   // px. 그래도 이보다 큰 한 번은 사람 손이 아니다 (정지 뒤 합산 값도 안전하게 자른다)

export function createMouseFilter() {
  let skip = 0, lastT = 0, recent = 0;
  return {
    onLock() { skip = LOCK_SKIP; lastT = 0; recent = 0; },
    // 반환: [dx, dy, 버렸는가]. t 는 e.timeStamp(ms)
    apply(mx, my, t) {
      const gap = lastT ? t - lastT : 0;
      lastT = t;
      if (skip > 0) { skip--; return [0, 0, true]; }
      const m = Math.max(Math.abs(mx), Math.abs(my));
      if (m >= SPIKE_ABS && m > SPIKE_RATIO * Math.max(recent, 12) && gap < GAP_MAX_MS) return [0, 0, true]; // 고립된 스파이크 (버린 값은 평균에 넣지 않는다)
      recent = Math.max(m, recent * 0.9); // 빠른 플릭은 연속으로 커지므로 따라간다. 멈추면 서서히 줄어든다
      const c = v => Math.max(-HARD_MAX, Math.min(HARD_MAX, v));
      return [c(mx), c(my), false];
    },
  };
}
