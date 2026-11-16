// 서버 권한 이동 테스트 (M1): 입력으로만 움직이고, 위치는 서버가 정한다
import { startServer, connect, check, failed, sleep } from './helpers.mjs';

const FWD = yaw => [1, 0, 0, yaw, 0, 6, 0]; // 앞으로 (무기 6 = M9), [앞뒤, 좌우, 플래그, yaw, pitch, 무기, 정조준]
const IDLE = [0, 0, 0, 0, 0, 6, 0];
const lastMe = c => [...c.msgs].reverse().find(m => m.t === 'me');
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
// 입력을 실제 시간에 맞춰 보낸다 (0.05초마다 3개 = 1초에 60개)
async function sendInputs(c, from, list) {
  for (let k = 0; k < list.length; k += 3) { c.send({ t: 'in', s: from + k, i: list.slice(k, k + 3) }); await sleep(50); }
  return from + list.length;
}

const srv = await startServer({ BOT_FILL: '0', GOAL: '999', MATCH_SECONDS: '120' });
let exitCode = 0;
try {
  const a = connect(srv.port, 'alpha'); await a.open; await a.waitFor('welcome');
  const b = connect(srv.port, 'bravo'); await b.open; await b.waitFor('welcome');
  a.send({ t: 'tp', p: [30, 0, 30], y: Math.PI / 2 }); // 열린 곳에서, 서쪽(-x)을 보고 (앞 10m 가 비어 있다)
  b.send({ t: 'tp', p: [-20, 0, -50], y: 0 });
  await sleep(300);

  console.log('[입력으로 움직이고, 위치는 서버가 정한다]');
  let seq = 0;
  const start = lastMe(a).st.p;
  check(Math.abs(start[0] - 30) < 1e-6 && Math.abs(start[2] - 30) < 1e-6, '(준비) 순간이동한 위치가 서버 상태에 들어간다', JSON.stringify(start));
  seq = await sendInputs(a, seq, Array.from({ length: 60 }, () => FWD(Math.PI / 2)));
  const after1 = await a.waitFor('me', m => m.q === seq - 1, 3000);
  const moved = after1 ? dist2(start, after1.st.p) : 0;
  check(after1 && moved > 3 && moved < 5.4 && after1.st.p[0] < 30, '1초 동안 앞으로 입력하면 서버가 걷는 속도만큼 옮긴다 (보낸 입력 번호까지 처리했다고 알려 준다)', `${moved.toFixed(2)}m`);
  const seen = await b.waitFor('s', m => m.id === a.me && Math.abs(m.p[0] - after1.st.p[0]) < 0.01, 2000);
  check(!!seen, '다른 사람은 서버가 계산한 위치를 받는다');

  console.log('\n[속도 핵 · 위치 조작 막기]');
  const p0 = lastMe(a).st.p;
  a.send({ t: 'in', s: seq, i: Array.from({ length: 120 }, () => FWD(Math.PI / 2)) }); seq += 120; // 2초 분량을 한꺼번에
  const burst = await a.waitFor('me', m => m.q === seq - 1, 3000);
  const fast = burst ? dist2(p0, burst.st.p) : 99;
  check(burst && fast < 2.6, '한꺼번에 많은 입력을 보내도 실제 시간만큼만 처리한다 (2초 분량 → 0.5초 분량 이하)', `${fast.toFixed(2)}m`);
  const p1 = burst.st.p;
  a.send({ t: 's', p: [0, 0, 0], y: 0, x: 0, c: 0, w: 0 }); // 예전 방식: 위치를 직접 보냄
  seq = await sendInputs(a, seq, [IDLE, IDLE, IDLE]);
  const kept = await a.waitFor('me', m => m.q === seq - 1, 2000);
  check(kept && dist2(p1, kept.st.p) < 0.5, '브라우저가 위치를 직접 보내도 무시한다', JSON.stringify(kept && kept.st.p));

  console.log('\n[명중 거리는 서버가 잰다]');
  await sleep(3200); // 스폰 무적이 끝날 때까지
  a.msgs.length = 0;
  a.send({ t: 'hit', w: 6, hits: [['body', 1, b.me]] }); // M9: 15m 부터 약해진다. 실제 거리는 70m 이상인데 1m 라고 거짓말
  const dmg = await a.waitFor('dmg', m => m.to === b.me, 2000);
  check(dmg && dmg.dmg < 20, '브라우저가 보낸 거리 대신 서버 위치로 거리를 재서 피해를 계산한다 (먼 거리 = 약한 피해)', JSON.stringify(dmg && dmg.dmg));
  a.ws.close(); b.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}

console.log('\n[라이브(prod)에서는 순간이동을 받지 않는다]');
const prod = await startServer({ APP_ENV: 'prod', BOT_FILL: '0' });
try {
  const c = connect(prod.port, 'charlie'); await c.open; await c.waitFor('welcome');
  await sleep(200);
  const before = lastMe(c).st.p;
  c.send({ t: 'tp', p: [33, 0, 33] });
  await sendInputs(c, 0, [IDLE, IDLE, IDLE]);
  const now = await c.waitFor('me', m => m.q === 2, 2000);
  check(now && dist2(before, now.st.p) < 0.5, '라이브 서버는 tp 를 무시한다', JSON.stringify(now && now.st.p));
  c.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  prod.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
