// 서버 시각 추정 · 보간 재생 위치. 구현은 interp.js (NetClock): 수신 지연 편차에 맞춰 버퍼를 늘리고 줄이며, 끊겼다 이어져도 순간이동 없이 따라잡는다.
//   clock.update(dt)  프레임마다 한 번 (main.js) · clock.render()  지금 그리는 서버 tick (입력의 vt 로도 보낸다 → 서버가 그 순간으로 되감아 판정)
import { NetClock } from './interp.js';
export const clock = new NetClock();
