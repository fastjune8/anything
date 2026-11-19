// 운영과 같은 조건의 서버 부하 시험: 서버 프로세스 하나 + 사람 N명(직접 연결, 프록시 없음) + 나머지는 서버 AI 봇.
//   node tools/netsim/prodload.mjs --humans 1 --secs 60 --mode dom
// 서버 쪽 지표(tick·간격·루프 지연·CPU·메모리·송신량)와, 사람 쪽에서 본 스냅샷 수신 간격을 함께 낸다.
import { startServer, sleep } from '../../tests/helpers.mjs';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const humans = Number(opt('humans', 1)), secs = Number(opt('secs', 60)), mode = opt('mode', 'dom');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const srv = await startServer({ MATCH_SECONDS: '3600', GOAL: '99999' });
const cl = [];
for (let i = 0; i < humans; i++) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`), c = { ws, at: [], seq: 0, t0: 0, n: 0 };
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'snap') c.at.push(performance.now()); if (m.t === 'hi') ws.send(JSON.stringify({ t: 'qm', mode })); if (m.t === 'welcome') { c.ok = true; c.t0 = performance.now(); } });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'h' + i })));
  cl.push(c);
}
const timer = setInterval(() => { for (const c of cl) if (c.ok && c.ws.readyState === 1) { const target = Math.floor((performance.now() - c.t0) / (1000 / 60)), list = []; while (c.n < target) { list.push([0, 0, 0, 0, 0, 0, 0]); c.n++; } if (list.length) { c.ws.send(JSON.stringify({ t: 'cmd', s: c.seq, c: list })); c.seq += list.length; } } }, 33);
await sleep(5000);
cl.forEach(c => { c.skip = c.at.length; });
await sleep(secs * 1000);
const perf = await fetch(`http://127.0.0.1:${srv.port}/perf`).then(r => r.json());
clearInterval(timer);
const h = perf.history.slice(-secs + 2), avg = g => mean(h.map(g)), max = g => Math.max(...h.map(g));
const iv = cl.flatMap(c => { const a = c.at.slice(c.skip), o = []; for (let i = 1; i < a.length; i++) o.push(a[i] - a[i - 1]); return o; });
const f = (v, d = 1) => v.toFixed(d);
console.log(`사람 ${humans}명 + AI 봇 (${mode}) ${secs}초 | 서버 tick 평균 ${f(avg(x => x.tick.avg), 2)}ms (p99 ${f(avg(x => x.tick.p99), 2)} 최대 ${f(max(x => x.tick.max))}) | tick 간격 p99 ${f(avg(x => x.interval.p99))}ms 최대 ${f(max(x => x.interval.max))} 늦은 tick ${h.reduce((n, x) => n + x.late, 0)}회 | 루프 지연 p99 ${f(avg(x => x.loop.p99))}ms 최대 ${f(max(x => x.loop.max))} | 길찾기 ${h.reduce((n, x) => n + x.path.n, 0)}회 최대 ${f(max(x => x.path.max))}ms | GC ${h.reduce((n, x) => n + x.gc.n, 0)}회 최대 ${f(max(x => x.gc.max))}ms (전체 정리 ${h.reduce((n, x) => n + x.gc.major, 0)}회 최대 ${f(max(x => x.gc.majorMax))}ms) 힙 ${h[h.length - 1].heap}MB | 브로드캐스트 평균 ${f(avg(x => x.bcast.avg), 2)}ms 최대 ${f(max(x => x.bcast.max))} | CPU ${f(avg(x => x.cpu))}% 메모리 ${h[h.length - 1].mem}MB | 송신 ${f(avg(x => x.out.kb), 0)}KB/s ${f(avg(x => x.out.msg), 0)}msg/s | 사람이 받은 스냅샷 간격 ${f(mean(iv))}ms p99 ${f(pct(iv, 0.99))} 최대 ${f(Math.max(...iv), 0)} (>100ms ${iv.filter(v => v > 100).length}회)`);
for (const c of cl) c.ws.close();
srv.stop(); process.exit(0);
