// 서버 시각 추정: 스냅샷에 붙은 tick 번호와 받은 시각으로 "지금 서버는 몇 tick 인가" 를 추정한다.
//   다른 플레이어는 그보다 INTERP_TICKS(0.1초) 앞 시각을 그린다(보간) → 그 값(vt)을 입력에 붙여 보내면 서버가 그 순간으로 되감아 판정한다.
import { TICK_HZ, INTERP_TICKS } from '/shared/sim/config.js';

let off = null; // 서버 tick − (지금 ms × 60/1000)
export const clock = {
  onTick(n) {
    const est = n - performance.now() * TICK_HZ / 1000;
    if (off === null || est > off) off = est;           // 늦게 온 패킷(지연)은 무시하고 가장 이른 추정을 쓴다
    else off += (est - off) * 0.02;                      // 시계가 천천히 어긋나는 것만 따라간다
  },
  reset() { off = null; },
  now() { return off === null ? 0 : off + performance.now() * TICK_HZ / 1000; },
  render() { return this.now() - INTERP_TICKS; },
};
