// 원격 플레이어 보간과 서버 시계 (순수 계산 — 브라우저와 Node 시험 도구가 같이 쓴다).
//
//  ■ 서버 시계 추정 (NetClock)
//    스냅샷에는 서버 tick 번호 n 이 붙어 온다. 받은 시각과 비교하면 "지금 서버가 몇 tick 인가" 를 알 수 있고, 가장 빨리 온 패킷(= 지연이 가장 작은 것)이 기준이다.
//    "그리는 시각(head)" 은 서버 현재보다 D tick 늦게 흐르는 재생 위치다. D 는 최근 5초의 수신 지연 편차(95%)로 정해 흔들리는 네트워크에서는 커지고 안정되면 줄어든다 (6~14 tick).
//    head 는 거꾸로 가지도, 점프하지도 않는다: 목표보다 느리면 최대 +25% 로 따라잡고, 앞서면 최대 −10% 로 늦춘다.
//    최신 스냅샷보다 3 tick 이상 앞서가지 못한다 → 데이터가 끊기면 head 가 멈췄다가, 다시 오면 부드럽게 따라잡는다 (예측으로 멀리 가지도, 뒤늦게 순간이동하지도 않는다).
//  ■ 보간 (sample)
//    head 를 앞뒤 스냅샷 사이로 선형 보간. 끊겼을 때만 마지막 속도로 최대 3 tick(0.05초) 예측.
import { TICK_HZ } from '../../shared/sim/config.js';

export const SNAP_TICKS = 2;       // 서버가 스냅샷을 보내는 간격 (tick)
export const MAX_EXTRAP = 3;
const MAX_DLY_SAMPLE = 20;        // 지연 샘플 하나가 목표 버퍼에 줄 수 있는 최대 영향 (tick)
const STALL_MEMORY_MS = 3000;     // 네트워크 정체 뒤 이 시간 동안은 부드럽게(순간이동 없이) 따라잡는다       // 최신 스냅샷보다 앞서갈 수 있는 한계 (tick)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class NetClock {
  constructor(nowMs = () => performance.now(), o = {}) {
    this.nowMs = nowMs; this.minD = o.minDelay ?? 6; this.maxD = o.maxDelay ?? 14;
    this.reset();
  }
  reset() { this.est = []; this.dly = []; this.off = null; this.newest = -Infinity; this.D = this.minD; this.head = null; this.stalled = false; this.stallAt = -Infinity; }
  // 스냅샷(또는 사건 묶음)을 받았다. isSnap 만 지연 계산에 쓴다 (30Hz 로 규칙적으로 오는 것)
  onTick(n, isSnap = true) {
    if (n > this.newest) this.newest = n;
    if (!isSnap) return;
    const e = n - this.nowMs() * TICK_HZ / 1000;
    this.est.push(e); if (this.est.length > 150) this.est.shift();
    let m = -Infinity; for (const v of this.est) if (v > m) m = v;
    this.off = m;
    this.dly.push(Math.min(MAX_DLY_SAMPLE, m - e)); if (this.dly.length > 120) this.dly.shift(); // 한 번의 긴 정지(접속 직후 로딩 등)가 오래 영향을 주지 않게 샘플 하나는 20tick 까지만
    const s = [...this.dly].sort((a, b) => a - b), p = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    const target = clamp(SNAP_TICKS + p + 1, this.minD, this.maxD);
    this.D += (target - this.D) * (target > this.D ? 0.25 : 0.02); // 빨리 늘리고 천천히 줄인다
  }
  now() { return this.off === null ? 0 : this.off + this.nowMs() * TICK_HZ / 1000; }
  render() { return this.head === null ? 0 : this.head; }
  // 서버 현재 추정과 그리는 시각의 차이 (tick)
  get delay() { return this.head === null ? 0 : this.now() - this.head; }
  // 프레임마다 한 번 (dt = 실제 흐른 초)
  update(dt) {
    if (this.off === null) return;
    const goal = this.now() - this.D, t = this.nowMs();
    // 네트워크가 막혔다 풀린 직후에는 어긋나도 순간이동하지 않고 따라잡는다. 그 밖(접속 직후·탭 복귀 등)에 0.2초 넘게 뒤처지면 바로 맞춘다
    const snapAt = t - this.stallAt < STALL_MEMORY_MS ? 40 : 12;
    const adv = dt * TICK_HZ;                          // 이번 프레임에 실시간만큼 전진하면
    const err = goal - (this.head === null ? goal : this.head + adv); // 전진한 뒤에도 남는 어긋남 (+ = 아직 뒤처짐). 프레임이 길어도(낮은 FPS) 정상 상태에서는 0
    if (this.head === null || Math.abs(err) > snapAt) this.head = goal;
    else this.head += adv + clamp(err * 0.2, -0.1 * adv, 0.25 * adv); // 남은 어긋남의 20% 씩 메운다 (속도는 실시간의 90%~125%)
    const lim = this.newest + MAX_EXTRAP;
    this.stalled = this.head > lim;
    if (this.stalled) { this.head = lim; this.stallAt = t; }
  }
}

// buf: 시각(n) 순서의 스냅샷 목록 [{ n, x, y, z, yaw, pitch, c, vx, vy, vz, f, w, hp }]. 반환: 보간 결과 + under(예측으로 그림) 또는 null
export function sample(buf, rt) {
  if (!buf.length) return null;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].n > rt) i--;
  const B = buf[i], A = i > 0 ? buf[i - 1] : null;
  if (A && A.n <= rt && rt <= B.n && B.n > A.n) { // 두 스냅샷 사이 (최신보다 앞서가면 아래에서 예측)
    const k = (rt - A.n) / (B.n - A.n);
    return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, yaw: angLerp(A.yaw, B.yaw, k), pitch: A.pitch + (B.pitch - A.pitch) * k, c: A.c + (B.c - A.c) * k, vx: B.vx, vy: B.vy, vz: B.vz, vs: Math.max(Math.hypot(A.vx, A.vz), Math.hypot(B.vx, B.vz)), f: k < 0.5 ? A.f : B.f, w: B.w, hp: B.hp, under: false };
  }
  const ex = clamp(rt - B.n, 0, MAX_EXTRAP) / TICK_HZ;
  return { x: B.x + B.vx * ex, y: B.y + B.vy * ex, z: B.z + B.vz * ex, yaw: B.yaw, pitch: B.pitch, c: B.c, vx: B.vx, vy: B.vy, vz: B.vz, vs: Math.hypot(B.vx, B.vz), f: B.f, w: B.w, hp: B.hp, under: rt > B.n };
}
export const netImpl = { name: 'new', makeClock: now => new NetClock(now), sample };
