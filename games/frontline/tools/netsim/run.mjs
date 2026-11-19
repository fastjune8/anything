// 네트워크 시험 실행기: 실제 서버 + 장애 재현 프록시 + 봇 N명. 관찰자 봇이 원격 플레이어를 "브라우저와 같은 보간 코드"로 그리며 품질을 잰다.
//   node tools/netsim/run.mjs --impl legacy|new --players 4 --secs 25 --rtt 100 --jitter 20 --loss 0.01
//   node tools/netsim/run.mjs --suite            (양호·보통·지연·불안정·매우 불안정 × 인원)
// 측정 (관찰자 화면 기준, 이동 중인 원격 플레이어 전부 합산):
//   튐(jump)   한 프레임에 실제 움직임의 2배+0.5m 넘게 이동    멈춤(stall) 움직이는 상대가 3프레임 넘게 멈춰 보임
//   오차       그려진 위치 ↔ 서버가 보낸 진짜 경로(보간)의 거리   버퍼       그리는 시각이 서버 현재보다 늦은 정도
//   언더런     최신 스냅샷보다 앞서 가서 예측으로 그린 프레임 비율  서버 튐   서버가 보낸 위치가 한 번에 22m/s 넘게 움직인 횟수 (입력이 몰려 처리됨)
import { startServer, sleep } from '../../tests/helpers.mjs';
import { WebSocket } from 'ws';
import { createProxy } from './proxy.mjs';
import { legacy } from './legacy.mjs';
import { BTN } from '../../shared/sim/config.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PROFILES = {
  '양호 30ms': { rtt: 30, jitter: 3, loss: 0 }, '보통 80ms': { rtt: 80, jitter: 8, loss: 0 }, '지연 150ms': { rtt: 150, jitter: 10, loss: 0 },
  '지터 100±40ms': { rtt: 100, jitter: 40, loss: 0 }, '불안정 100ms 1%': { rtt: 100, jitter: 20, loss: 0.01 }, '매우 불안정 150ms 3%': { rtt: 150, jitter: 30, loss: 0.03 },
};
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

async function loadImpl(name) {
  if (name === 'legacy') return legacy;
  const m = await import('../../client/js/interp.js'); // 개선 후 (client/js/interp.js). --maxd N : 버퍼 상한(tick) 조정 시험
  const md = Number(opt('maxd', 0));
  return md ? { ...m.netImpl, makeClock: now => new m.NetClock(now, { maxDelay: md }) } : m.netImpl;
}

export async function runOnce({ impl: implName = 'legacy', players = 4, secs = 25, profile, label = '', impair = 'all', serverEnv = {} }) {
  const impl = await loadImpl(implName);
  const srv = await startServer({ MATCH_SECONDS: '3600', GOAL: '99999', BOT_FILL: '0', ...serverEnv });
  // 관찰자(0번)와 이동하는 쪽(나머지)을 따로 장애 걸 수 있게 프록시를 둘로 나눈다: impair = all | observer(받는 쪽만) | movers(보내는 쪽만)
  const pObs = await createProxy({ target: { port: srv.port } }), pMov = await createProxy({ target: { port: srv.port } });
  const proxy = { stats: { get lost() { return pObs.stats.lost + pMov.stats.lost; } }, setProfile(p) { if (impair !== 'movers') pObs.setProfile(p); if (impair !== 'observer') pMov.setProfile(p); }, close() { pObs.close(); pMov.close(); } };
  const bots = [];
  const mk = idx => {
    const ws = new WebSocket(`ws://127.0.0.1:${(idx === 0 ? pObs : pMov).port}`);
    const b = { idx, ws, id: -1, seq: 0, sent: 0, t0: 0, z: 0, x: 48.7, all: new Map(), snapAt: [], rtts: [], counts: {}, bytes: 0, side: 0, sideT: 0, jumpT: 60, slideT: 0, dir: idx % 2 ? 1 : -1, ready: false };
    ws.on('message', raw => {
      const now = performance.now(), m = JSON.parse(raw);
      b.counts[m.t] = (b.counts[m.t] || 0) + 1; b.bytes += raw.length;
      if (m.t === 'hi') b.hi = true;
      else if (m.t === 'welcome') { b.id = m.id; b.code = m.room && m.room.code; b.welcome = true; }
      else if (m.t === 'pong') b.rtts.push(now - m.c);
      else if (m.t === 'me') { b.z = m.ps.z; b.x = m.ps.x; }
      else if (m.t === 'snap') {
        b.snapAt.push(now); b.lastN = m.n;
        if (b.clock) b.clock.onTick(m.n, true);
        for (const a of m.p) {
          let r = b.all.get(a[0]); if (!r) b.all.set(a[0], r = { id: a[0], all: [], buf: [] });
          const row = { n: m.n, x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5], f: a[6], w: a[7], hp: a[8], c: a[9], vx: a[10], vy: a[11], vz: a[12] };
          r.all.push(row); r.buf.push(row); if (r.buf.length > 40) r.buf.shift();
        }
      }
    });
    ws.send0 = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    ws.on('open', () => ws.send0({ t: 'hello', name: 'bot' + idx }));
    return b;
  };
  // 입력 생성: 복도(x≈48.7, z −32..32)를 질주하며 좌우 이동·점프·슬라이딩
  const gen = b => {
    if (b.z < -32) b.dir = 1; else if (b.z > 32) b.dir = -1; // dir +1 = +z (yaw π)
    const yaw = b.dir > 0 ? Math.PI : 0;
    if (--b.sideT <= 0) { b.side = [-1, 0, 1][(Math.random() * 3) | 0]; b.sideT = 30 + ((Math.random() * 90) | 0); }
    let side = b.side; const cx = Math.cos(yaw);
    if (b.x > 50.0) side = -1 * Math.sign(cx); else if (b.x < 47.3) side = 1 * Math.sign(cx);
    let btn = BTN.sprint;
    if (--b.jumpT <= 0) { b.jumpT = 90 + ((Math.random() * 150) | 0); b.jumpHold = 3; }
    if (b.jumpHold > 0) { btn |= BTN.jump; b.jumpHold--; }
    if (b.slideT > 0) { btn |= BTN.crouch; b.slideT--; } else if (Math.random() < 0.004) b.slideT = 18;
    return [1, side, btn, yaw, 0, 0, b.clock ? b.clock.render() : 0];
  };
  const pump = b => {
    if (!b.moving || b.ws.readyState !== 1) return;
    const target = Math.floor((performance.now() - b.t0) / (1000 / 60)), c = [];
    while (b.sent < target) { c.push(b.idx === 0 ? [0, 0, 0, 0, 0, 0, 0] : gen(b)); b.sent++; }
    if (c.length) { b.ws.send0({ t: 'cmd', s: b.seq, c }); b.seq += c.length; }
  };
  for (let i = 0; i < players; i++) bots.push(mk(i));
  const wait = async (fn, ms = 8000) => { const e = performance.now() + ms; while (performance.now() < e) { if (fn()) return true; await sleep(20); } return false; };
  await wait(() => bots.every(b => b.hi));
  bots[0].ws.send0({ t: 'rcreate', name: 'netsim', mode: 'tdm', bots: false, max: 10, minutes: 10 });
  await wait(() => bots[0].welcome);
  for (const b of bots.slice(1)) b.ws.send0({ t: 'rjoin', code: bots[0].code });
  await wait(() => bots.every(b => b.welcome));
  // 이동 시작 위치
  bots.forEach((b, i) => { b.z = -30 + (i * 60) / Math.max(1, players - 1); b.ws.send0({ t: 'tp', p: [48.7, 0, b.z], y: b.dir > 0 ? Math.PI : 0 }); });
  await sleep(300);
  const obs = bots[0];
  obs.clock = impl.makeClock(() => performance.now());
  bots.slice(1).forEach(b => { b.clock = impl.makeClock(() => performance.now()); });
  // 보내는 쪽 시계는 각자의 수신 스냅샷으로 맞춘다 (vt 용) — 관찰자와 같은 구현
  const t0 = performance.now();
  for (const b of bots) { b.t0 = t0; b.moving = true; b.timer = setInterval(() => pump(b), 33); }
  // 장애 시작 (시계가 맞춰진 뒤)
  await sleep(2500);
  proxy.setProfile(profile);
  const pingTimer = setInterval(() => obs.ws.send0({ t: 'ping', c: performance.now() }), 500);
  await sleep(4000); // 장애 속에서 시계가 적응할 시간
  // 관찰자 렌더 루프 (브라우저처럼 ~60fps)
  const frames = [], renderStart = performance.now();
  let lastT = performance.now();
  const rl = setInterval(() => {
    const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
    obs.clock.update(dt);
    const rt = obs.clock.render();
    for (const r of obs.all.values()) {
      const s = impl.sample(r.buf, rt);
      if (s) frames.push({ id: r.id, t: now, rt, x: s.x, z: s.z, under: s.under, buf: obs.clock.now() - rt });
    }
  }, 16);
  const startN = obs.lastN, snapStart = obs.snapAt.length, rttStart = obs.rtts.length, cnt0 = { ...obs.counts }, bytes0 = obs.bytes;
  await sleep(secs * 1000);
  clearInterval(rl); clearInterval(pingTimer);
  const snapAt = obs.snapAt.slice(snapStart), rtts = obs.rtts.slice(rttStart), bytes = obs.bytes - bytes0;
  const perf = await fetch(`http://127.0.0.1:${srv.port}/perf`).then(r => r.json()).catch(() => null);
  for (const b of bots) { clearInterval(b.timer); b.ws.close(); }
  proxy.close(); srv.stop();

  // ── 분석 ──
  const truthAt = (r, rt) => { // 서버가 보낸 진짜 경로를 rt 에서 보간
    const a = r.all; let lo = 0, hi = a.length - 1;
    if (!a.length) return null;
    if (rt <= a[0].n) return a[0]; if (rt >= a[hi].n) return a[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid].n <= rt) lo = mid; else hi = mid; }
    const k = (rt - a[lo].n) / (a[hi].n - a[lo].n);
    return { x: a[lo].x + (a[hi].x - a[lo].x) * k, z: a[lo].z + (a[hi].z - a[lo].z) * k };
  };
  const jumps = [], errs = [], bufs = [], stallRuns = [];
  let jumpN = 0, under = 0, total = 0, stallFrames = 0;
  for (const r of obs.all.values()) {
    if (r.id === obs.id) continue;
    const fr = frames.filter(q => q.id === r.id);
    let run = 0, runStart = 0;
    for (let i = 1; i < fr.length; i++) {
      const A = fr[i - 1], B = fr[i], T0 = truthAt(r, A.rt), T1 = truthAt(r, B.rt);
      const step = Math.hypot(B.x - A.x, B.z - A.z), tstep = Math.hypot(T1.x - T0.x, T1.z - T0.z);
      total++; if (B.under) under++;
      errs.push(Math.hypot(B.x - T1.x, B.z - T1.z)); bufs.push(B.buf / 60 * 1000);
      if (step > 2 * tstep + 0.5) { jumpN++; jumps.push(step); }
      if (tstep > 0.06 && step < 0.2 * tstep) { if (!run) runStart = B.t; run++; } else { if (run > 3) { stallRuns.push(B.t - runStart); stallFrames += run; } run = 0; }
    }
  }
  let sMax = 0, sBad = 0;
  for (const r of obs.all.values()) for (let i = 1; i < r.all.length; i++) {
    const a = r.all[i - 1], b = r.all[i], dn = b.n - a.n; if (a.n < startN || dn <= 0 || dn > 8) continue; // 시작 때 우리가 보낸 순간이동은 뺀다
    const v = Math.hypot(b.x - a.x, b.z - a.z) / (dn / 60); sMax = Math.max(sMax, v); if (v > 22) sBad++;
  }
  const iv = []; for (let i = 1; i < snapAt.length; i++) iv.push(snapAt[i] - snapAt[i - 1]);
  const sh = (perf && perf.history || []).slice(-Math.max(5, secs - 3));
  const avgS = (g, k) => mean(sh.map(h => g(h)));
  return {
    label, impl: implName, players, profile, secs, impair, serverEnv,
    snap: { avg: mean(iv), sd: sd(iv), max: Math.max(0, ...iv), gaps100: iv.filter(v => v > 100).length, rate: snapAt.length / secs },
    rtt: { avg: mean(rtts), p95: pct(rtts, 0.95), max: Math.max(0, ...rtts) },
    frames: total, jumps: jumpN, jumpMax: Math.max(0, ...jumps), stalls: stallRuns.length, stallMax: Math.max(0, ...stallRuns),
    err: { p50: pct(errs, 0.5), p99: pct(errs, 0.99), max: Math.max(0, ...errs) }, buf: { avg: mean(bufs), max: Math.max(0, ...bufs) },
    under: total ? under / total : 0, truth: { maxSpeed: sMax, bad: sBad },
    rx: { kbps: bytes / 1024 / secs, perType: Object.fromEntries(Object.entries(obs.counts).map(([k, v]) => [k, +((v - (cnt0[k] || 0)) / secs).toFixed(1)])) },
    server: sh.length ? { tick: avgS(h => h.tick.avg), tickMax: Math.max(...sh.map(h => h.tick.max)), intP99: avgS(h => h.interval.p99), intMax: Math.max(...sh.map(h => h.interval.max)), late: sh.reduce((n, h) => n + h.late, 0), bcast: avgS(h => h.bcast.avg), loopP99: avgS(h => h.loop.p99), loopMax: Math.max(...sh.map(h => h.loop.max)), cpu: avgS(h => h.cpu), mem: sh[sh.length - 1].mem, outKbps: avgS(h => h.out.kb), outMsg: avgS(h => h.out.msg) } : null,
    proxy: { lost: proxy.stats.lost },
  };
}

export function row(r) {
  const s = r.server;
  return `${(r.label + (r.impair && r.impair !== 'all' ? '·' + r.impair : '')).padEnd(18)} ${r.impl.padEnd(6)} ${String(r.players).padStart(2)}명 | 스냅샷 ${f(r.snap.avg)}±${f(r.snap.sd)}ms 최대 ${f(r.snap.max, 0)} (>100ms ${r.snap.gaps100}) | RTT ${f(r.rtt.avg, 0)}/${f(r.rtt.p95, 0)} | 버퍼 ${f(r.buf.avg, 0)}ms (최대 ${f(r.buf.max, 0)}) | 튐 ${r.jumps} (최대 ${f(r.jumpMax, 2)}m) 멈춤 ${r.stalls} (최대 ${f(r.stallMax, 0)}ms) | 오차 p50 ${f(r.err.p50 * 100, 0)}cm p99 ${f(r.err.p99 * 100, 0)}cm 최대 ${f(r.err.max, 2)}m | 언더런 ${f(r.under * 100)}% | 서버튐 ${r.truth.bad} (최대 ${f(r.truth.maxSpeed, 0)}m/s)` + (s ? ` | 서버 tick ${f(s.tick, 2)}ms(최대 ${f(s.tickMax)}) 간격 p99 ${f(s.intP99)}ms 최대 ${f(s.intMax)} 지연 ${s.late} 루프 p99 ${f(s.loopP99)} CPU ${f(s.cpu, 0)}% 메모리 ${s.mem}MB 송신 ${f(s.outKbps, 0)}KB/s ${f(s.outMsg, 0)}msg/s` : '');
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const impl = opt('impl', 'legacy'), secs = Number(opt('secs', 25)), players = Number(opt('players', 4));
  const results = [];
  const jobs = opt('suite', false)
    ? Object.entries(PROFILES).filter(([label]) => !opt('only', false) || String(opt('only')).split(',').some(k => label.includes(k))).map(([label, profile]) => ({ label, profile, players, impair: String(opt('impair', 'all')), serverEnv: { ...(opt('stall', false) ? { NETSIM_STALL: String(opt('stall')) } : {}), ...(opt('queue', 'on') === 'off' ? { INPUT_QUEUE: 'off' } : {}) } }))
    : [{ label: String(opt('name', 'custom')), serverEnv: { ...(opt('stall', false) ? { NETSIM_STALL: String(opt('stall')) } : {}), ...(opt('queue', 'on') === 'off' ? { INPUT_QUEUE: 'off' } : {}) }, impair: String(opt('impair', 'all')), profile: { rtt: Number(opt('rtt', 80)), jitter: Number(opt('jitter', 10)), loss: Number(opt('loss', 0)) }, players }];
  for (const j of jobs) { const r = await runOnce({ ...j, impl, secs }); results.push(r); console.log(row(r)); }
  if (opt('json', false)) console.log(JSON.stringify(results));
  process.exit(0);
}
