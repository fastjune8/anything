// 서버 성능 계측 (프로세스 전체, 방 여러 개를 합산). 1초마다 요약을 만들어 /status(perf) · /perf 로 보여 주고, PERF_LOG=1 이면 로그에도 남긴다.
//   tick      한 번의 방 tick 을 계산하는 데 걸린 시간 (ms)          — 이게 16.7ms 에 가까워지면 서버가 모자란 것
//   interval  같은 방의 tick 사이 실제 간격 (ms, 목표 16.67)         — 흔들리면 이벤트 루프가 막힌 것 (플레이어에게는 지터로 보인다)
//   bcast     스냅샷·사건을 만들고 보내는 데 걸린 시간 (ms)
//   loop      이벤트 루프 지연 (monitorEventLoopDelay, ms)
//   cpu       프로세스 CPU 사용률 (코어 1개 = 100%) · mem = RSS(MB)
//   in/out    초당 메시지 수와 KB (out 은 JSON 문자열 길이 기준)
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import { PERF_LOG } from './config.js';

const loop = monitorEventLoopDelay({ resolution: 4 });
loop.enable();
let win = fresh();
let cpu0 = process.cpuUsage(), t0 = process.hrtime.bigint();
let probe = () => ({ players: 0, rooms: 0 });
export const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
export const history = [];
export let last = null;

function fresh() { return { tick: [], interval: [], bcast: [], path: [], gc: [], gcMajor: [], msgIn: 0, bytesIn: 0, msgOut: 0, bytesOut: 0, late: 0 }; }
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r2 = v => Math.round(v * 100) / 100;
const stat = a => ({ avg: r2(mean(a)), p99: r2(pct(a, 0.99)), max: r2(a.length ? Math.max(...a) : 0) });

export const perf = {
  setProbe(fn) { probe = fn; },
  tick(ms) { win.tick.push(ms); },
  interval(ms) { win.interval.push(ms); if (ms > 25) win.late++; }, // 25ms 넘으면 tick 하나를 건너뛴 셈 (목표 16.7ms)
  bcast(ms) { win.bcast.push(ms); },
  path(ms) { win.path.push(ms); },   // 봇 길찾기(A*) 한 번
  gc(ms, major) { win.gc.push(ms); if (major) win.gcMajor.push(ms); }, // 가비지 컬렉션 정지 한 번 (major = 전체 정리)
  out(len) { win.msgOut++; win.bytesOut += len; },
  in(len) { win.msgIn++; win.bytesIn += len; },
};

function summarize() {
  const now = process.hrtime.bigint(), wall = Number(now - t0) / 1e9, cu = process.cpuUsage(cpu0);
  const w = win; win = fresh(); cpu0 = process.cpuUsage(); t0 = now;
  const p = probe();
  last = {
    at: new Date().toISOString(), players: p.players, rooms: p.rooms,
    tick: stat(w.tick), path: { n: w.path.length, ...stat(w.path) }, gc: { n: w.gc.length, ...stat(w.gc), major: w.gcMajor.length, majorMax: r2(w.gcMajor.length ? Math.max(...w.gcMajor) : 0) }, heap: Math.round(process.memoryUsage().heapUsed / 1048576), interval: stat(w.interval.length ? w.interval : [0]), bcast: stat(w.bcast), late: w.late,
    loop: { avg: r2(loop.mean / 1e6), p99: r2(loop.percentile(99) / 1e6), max: r2(loop.max / 1e6) },
    cpu: r2((cu.user + cu.system) / 1e6 / wall * 100), mem: Math.round(process.memoryUsage().rss / 1048576),
    in: { msg: Math.round(w.msgIn / wall), kb: r2(w.bytesIn / 1024 / wall) }, out: { msg: Math.round(w.msgOut / wall), kb: r2(w.bytesOut / 1024 / wall) },
  };
  loop.reset();
  history.push(last); if (history.length > 120) history.shift();
  if (PERF_LOG) console.log(`[perf] ${JSON.stringify(last)}`);
}
try { new PerformanceObserver(l => { for (const e of l.getEntries()) perf.gc(e.duration, ((e.detail && e.detail.kind) ?? e.kind) === 4); }).observe({ entryTypes: ['gc'] }); } catch { /* GC 계측 불가 환경 */ }
setInterval(summarize, 1000).unref();
