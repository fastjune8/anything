// 네트워크 단위 테스트 (서버 없이, 1초 안팎): 서버 시계·보간(client/js/interp.js) · 입력 큐(server) 규칙
import { check, failed } from './helpers.mjs';
import { NetClock, sample, MAX_EXTRAP } from '../client/js/interp.js';
import { NetDiag } from '../client/js/netdiag.js';

// 가짜 시계: 진짜 시간 대신 우리가 흘린다
function sim(arrivals, { frameMs = 1000 / 60, until }) {
  let t = 0; const clock = new NetClock(() => t);
  const steps = [], heads = [], delays = [], stall = [];
  let ai = 0, prev = null;
  for (t = 0; t <= until; t += frameMs) {
    while (ai < arrivals.length && arrivals[ai].at <= t) { clock.onTick(arrivals[ai].n, true); ai++; }
    clock.update(frameMs / 1000);
    const h = clock.render();
    if (prev !== null) steps.push(h - prev);
    prev = h; heads.push(h); delays.push(clock.delay); stall.push(clock.stalled);
  }
  return { clock, steps, heads, delays, stall };
}
// 서버는 2 tick(33.3ms) 마다 스냅샷. 도착 시각 = 보낸 시각 + 지연(ms). TCP 처럼 순서는 지킨다
function stream(secs, delayAt) {
  const out = []; let last = 0;
  for (let n = 0; n <= secs * 60; n += 2) { const sent = n * 1000 / 60; const at = Math.max(last, sent + delayAt(sent)); last = at; out.push({ n, at }); }
  return out;
}
const max = a => Math.max(...a), min = a => Math.min(...a);

console.log('[보간 sample]');
{
  const b = [{ n: 10, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, c: 0, vx: 6, vy: 0, vz: 0, f: 0, w: 0, hp: 100 }, { n: 12, x: 0.2, y: 0, z: 0, yaw: 0, pitch: 0, c: 0, vx: 6, vy: 0, vz: 0, f: 0, w: 0, hp: 100 }];
  check(Math.abs(sample(b, 11).x - 0.1) < 1e-9 && !sample(b, 11).under, '두 스냅샷 사이는 선형 보간');
  const e = sample(b, 14);
  check(e.under && Math.abs(e.x - (0.2 + 6 * 2 / 60)) < 1e-9, '최신 스냅샷 뒤는 속도로 예측 (under 표시)');
  check(Math.abs(sample(b, 40).x - (0.2 + 6 * MAX_EXTRAP / 60)) < 1e-9, `예측은 ${MAX_EXTRAP} tick 에서 멈춘다 (멀리 가지 않는다)`);
  check(sample([], 5) === null, '스냅샷이 없으면 null');
}

console.log('[서버 시계 · 양호한 네트워크]');
{
  const r = sim(stream(10, () => 40 + Math.random() * 4), { until: 10000 });
  const steady = r.steps.slice(120);
  check(min(r.heads.map((h, i) => (i ? h - r.heads[i - 1] : 0)).slice(60)) >= 0, '그리는 시각은 절대 거꾸로 가지 않는다');
  check(Math.abs(mean(steady) - 1) < 0.03, `정상 속도로 흐른다 (프레임당 ${mean(steady).toFixed(3)} tick, 1 = 정확히 실시간)`);
  check(Math.abs(mean(r.delays.slice(300)) - 6) < 1.2 && r.clock.D < 7, `지연이 안정적이면 버퍼는 최소 6 tick (${(mean(r.delays.slice(300)) * 1000 / 60).toFixed(0)}ms)`);
  check(!r.stall.slice(120).some(Boolean), '끊김 없음');
}

console.log('[서버 시계 · 낮은 FPS]');
{
  for (const fps of [60, 30, 10]) {
    const r = sim(stream(10, () => 40 + Math.random() * 4), { until: 10000, frameMs: 1000 / fps });
    const d = mean(r.delays.slice(Math.floor(r.delays.length * 0.4))), st = r.steps.slice(Math.floor(r.steps.length * 0.4)).map(v => v / (60 / fps));
    check(Math.abs(d - r.clock.D) < 1.2, `${fps}fps: 버퍼가 목표(${r.clock.D.toFixed(1)}tick)에 맞는다 (평균 ${d.toFixed(1)}tick)`);
    check(min(st) >= 0.88 && max(st) <= 1.27, `${fps}fps: 재생 속도가 실시간의 90~125% 안 (${min(st).toFixed(2)}~${max(st).toFixed(2)})`);
  }
}

console.log('[서버 시계 · 0.4초 정체 후 몰려옴 (TCP 손실)]');
{
  // 3초 지점에서 0.4초 동안 아무것도 못 받다가 한꺼번에 도착
  const arr = stream(12, s => (s >= 3000 && s < 3000 + 400 ? 3400 - s + 40 : 40));
  const r = sim(arr, { until: 12000 });
  const perFrameMax = max(r.steps.slice(60)), perFrameMin = min(r.steps.slice(60));
  check(perFrameMin >= 0, '정체 중에도 거꾸로 가지 않는다');
  check(perFrameMax <= 1.25 + 1e-6, `몰려온 뒤에도 한 프레임에 ${perFrameMax.toFixed(2)} tick 이하로만 따라잡는다 (순간이동 없음, 상한 1.25)`);
  check(r.stall.some(Boolean), '데이터가 없는 동안 멈춘다 (예측으로 멀리 가지 않는다)');
  const after = r.delays.slice(Math.floor(r.delays.length * 0.9));
  check(mean(after) < 8, `정체가 끝나면 버퍼가 다시 줄어든다 (끝 ${(mean(after) * 1000 / 60).toFixed(0)}ms)`);
  // 옛 방식(버퍼 고정 6 tick, 3 tick 예측 후 정지)과 비교: 같은 입력에서 그리는 시각이 얼마나 튀는가
  let t = 0, off = null, prevRt = null, jump = 0, ai = 0;
  for (t = 0; t <= 12000; t += 1000 / 60) {
    while (ai < arr.length && arr[ai].at <= t) { const est = arr[ai].n - arr[ai].at * 60 / 1000 + 0 * t; const e2 = arr[ai].n - t * 60 / 1000; off = off === null || e2 > off ? e2 : off + (e2 - off) * 0.02; void est; ai++; }
    const rt = off + t * 60 / 1000 - 6; if (prevRt !== null && t > 1000) jump = Math.max(jump, Math.abs(rt - prevRt)); prevRt = rt;
  }
  check(true, `(참고) 옛 시계는 같은 상황에서 프레임당 시각이 최대 ${jump.toFixed(2)} tick 움직였다`);
}

console.log('[서버 시계 · 지터에 적응]');
{
  const calm = sim(stream(15, () => 50), { until: 15000 }), noisy = sim(stream(15, s => 50 + (Math.floor(s / 700) % 2 ? 90 : 0) + Math.random() * 20), { until: 15000 });
  check(noisy.clock.D > calm.clock.D + 2, `흔들리는 네트워크는 버퍼를 늘린다 (D ${calm.clock.D.toFixed(1)} → ${noisy.clock.D.toFixed(1)} tick)`);
  check(noisy.clock.D <= 14 + 1e-9, '버퍼 상한 14 tick (0.23초) — 서버 되감기 한도(22tick) 안');
  const under = noisy.stall.filter(Boolean).length / noisy.stall.length;
  check(under < 0.02, `충분히 늘려서 멈추는 프레임이 2% 미만 (${(under * 100).toFixed(1)}%)`);
  // 안정되면 다시 줄어든다
  const recover = sim([...stream(15, s => 50 + (Math.floor(s / 700) % 2 ? 90 : 0)), ...stream(20, () => 50).map(a => ({ n: a.n + 15 * 60 + 2, at: a.at + 15000 }))], { until: 35000 });
  check(recover.clock.D < noisy.clock.D - 1, `안정되면 천천히 줄어든다 (D ${recover.clock.D.toFixed(1)})`);
}

console.log('[진단 NetDiag]');
{
  let t = 0; const d = new NetDiag(() => t);
  for (let i = 0; i < 100; i++) { t += i === 50 ? 300 : 33.3; d.snap(); }
  const s = d.summary();
  check(s.snap.maxGap > 290 && s.snap.gaps100 === 1 && Math.abs(s.snap.avg - 33.3) < 6, `수신 간격: 평균 ${s.snap.avg.toFixed(1)} 최대 ${s.snap.maxGap.toFixed(0)}ms, 100ms 초과 ${s.snap.gaps100}회`);
  d.remote(0.12, 0.12, false); d.remote(2.5, 0.1, false); d.remote(0.3, 0.1, true);
  check(d.summary().remote.jumps === 1 && d.summary().remote.underPct > 30, '원격 튐 판정: 실제 속도의 2배·0.5m 넘게 움직인 프레임만 센다');
  d.pong(80); d.pong(120);
  check(Math.abs(d.summary().rtt.avg - 100) < 1e-9 && d.summary().rtt.jitter > 0, 'RTT 평균·지터');
}

function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
process.exit(failed() ? 1 : 0);
