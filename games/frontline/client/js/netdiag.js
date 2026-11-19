// 네트워크 진단 (클라이언트): 순수 계산만 한다 (DOM·THREE 없음). F3 으로 화면에 보이고, window.__g.netdiag.summary() 로도 읽는다.
//   RTT · 스냅샷 수신 간격/지터/최대 간격 · 메시지 종류별 초당 수/KB · 보간 버퍼 · 언더런(예측으로 그린 비율) ·
//   원격 플레이어 튐(한 프레임에 실제 움직임보다 훨씬 많이 이동) · 내 위치 보정량 · FPS
const ring = n => ({ a: [], n, push(v) { this.a.push(v); if (this.a.length > this.n) this.a.shift(); return v; } });
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const TELEPORT = 6;                       // 한 프레임에 6m 넘게 움직이면 부활·순간이동이지 네트워크 튐이 아니다 (따로 센다)
const JUMP_MIN = 0.5;                     // 한 프레임에 이만큼(m) 넘게, 그리고 실제 속도로 갈 거리의 2배보다 많이 움직이면 "튐"

export class NetDiag {
  constructor(now = () => performance.now()) { this.now = now; this.reset(); }
  reset() {
    this.iv = ring(120); this.lastSnap = 0; this.gaps = 0; this.maxGap = 0;
    this.rtts = ring(40); this.fps = ring(120);
    this.win = { t0: this.now(), counts: {}, bytes: 0 }; this.rate = { counts: {}, kbps: 0 };
    this.frames = 0; this.teleports = 0; this.under = 0; this.jumps = 0; this.lastJump = null; this.maxStep = 0; this.corr = { n: 0, max: 0, last: 0, tele: 0 };
    this.buf = 0; this.delayTicks = 0;
  }
  // 받은 메시지 하나 (종류, 글자 수)
  msg(type, len) {
    const w = this.win, t = this.now();
    w.counts[type] = (w.counts[type] || 0) + 1; w.bytes += len;
    if (t - w.t0 >= 1000) { const s = (t - w.t0) / 1000; this.rate = { counts: Object.fromEntries(Object.entries(w.counts).map(([k, v]) => [k, Math.round(v / s)])), kbps: w.bytes / 1024 / s }; this.win = { t0: t, counts: {}, bytes: 0 }; }
  }
  snap() {
    const t = this.now();
    if (this.lastSnap) { const d = t - this.lastSnap; this.iv.push(d); if (d > 100) this.gaps++; if (d > this.maxGap) this.maxGap = d; }
    this.lastSnap = t;
  }
  pong(rtt) { this.rtts.push(rtt); }
  frame(dtMs) { if (dtMs > 0) this.fps.push(1000 / dtMs); }
  // 보간 버퍼: 서버 현재 추정 − 그리는 시각 (틱)
  buffer(delayTicks, bufMs) { this.delayTicks = delayTicks; this.buf = bufMs; }
  // 원격 플레이어 한 프레임: step = 이번 프레임 이동(m), expect = 그 플레이어 속도 × 프레임 시간(m), under = 예측으로 그림
  remote(step, expect, under) {
    if (step > TELEPORT) { this.teleports++; return; }
    this.frames++; if (under) this.under++;
    if (step > this.maxStep) this.maxStep = step;
    if (step > JUMP_MIN && step > 2 * expect + 0.3) { this.jumps++; this.lastJump = { step, at: this.now() }; }
  }
  correction(err) { if (err >= TELEPORT / 2) { this.corr.tele++; return; } this.corr.n++; this.corr.last = err; if (err > this.corr.max) this.corr.max = err; }
  summary() {
    const iv = this.iv.a;
    return {
      rtt: { avg: mean(this.rtts.a), jitter: sd(this.rtts.a), max: Math.max(0, ...this.rtts.a) },
      snap: { avg: mean(iv), jitter: sd(iv), p99: pct(iv, 0.99), maxGap: this.maxGap, gaps100: this.gaps },
      fps: { avg: mean(this.fps.a), min: Math.min(...(this.fps.a.length ? this.fps.a : [0])) },
      rate: this.rate, buffer: { ms: this.buf, ticks: this.delayTicks },
      remote: { teleports: this.teleports, frames: this.frames, underPct: this.frames ? this.under / this.frames * 100 : 0, jumps: this.jumps, maxStep: this.maxStep },
      correction: this.corr,
    };
  }
}
export const diag = new NetDiag();
