// 점령전 테스트: 거점 게이지 규칙(순수 함수) + 실제 서버에서 점령·점수·교전·승리, 봇이 거점으로 가는지
import { startServer, connect, check, failed, sleep } from './helpers.mjs';
import { stepZone } from '../server/modes/zone.js';
import { MODES } from '../shared/modes.js';
import { getMap } from '../shared/maps/index.js';

const CFG = MODES.zone.zone;
const fresh = () => ({ owner: -1, capTeam: -1, progress: 0, contested: false });
const run = (z, n, sec) => { let cap = -1; for (let t = 0; t < sec; t += 0.05) { const c = stepZone(z, n, 0.05, CFG); if (c >= 0) cap = c; } return cap; };

console.log('[거점 게이지 규칙]');
{
  const z = fresh();
  run(z, [1, 0], CFG.capture * 0.5);
  check(z.capTeam === 0 && Math.abs(z.progress - 0.5) < 0.02, '혼자 들어가면 정해진 시간의 절반이 지나면 게이지가 절반', JSON.stringify(z));
  const cap = run(z, [1, 0], CFG.capture * 0.55);
  check(cap === 0 && z.owner === 0 && z.progress === 0, '게이지가 다 차면 그 팀의 거점이 된다');

  const a = fresh(), b = fresh();
  run(a, [1, 0], 2); run(b, [3, 0], 2);
  check(b.progress > a.progress * 1.9, '인원이 많으면 더 빨리 점령한다 (3명 = 2배)', `${a.progress.toFixed(2)} vs ${b.progress.toFixed(2)}`);

  const c = fresh(); run(c, [1, 0], 3); const before = c.progress;
  run(c, [2, 1], 3);
  check(c.contested && c.progress === before, '양 팀이 함께 있으면 교전 중 — 게이지가 멈춘다');

  const d = fresh(); run(d, [1, 0], 4);
  run(d, [0, 1], 2);
  check(d.capTeam === 0 && d.progress < 0.5 && d.progress > 0, '상대가 채우던 게이지는 먼저 깎아야 한다');
  run(d, [0, 1], 4);
  check(d.capTeam === 1 && d.progress > 0, '다 깎은 뒤에야 내 팀 게이지가 찬다');

  const e = fresh(); run(e, [1, 0], 4); run(e, [0, 0], 40);
  check(e.progress === 0 && e.capTeam === -1, '아무도 없으면 게이지가 천천히 사라진다');
  check(getMap('warehouse').zones.length === 1, '창고 맵에 거점이 정의되어 있다');
}

console.log('\n[서버: 점령과 점수, 교전, 승리]');
const GOAL = 4;
const srv = await startServer({ BOT_FILL: '0', GOAL: String(GOAL), MATCH_SECONDS: '90', RESTART_SECONDS: '2' });
let exitCode = 0;
try {
  const a = connect(srv.port, 'alpha', { mode: 'zone' }); await a.open;
  const w = await a.waitFor('welcome');
  check(w && w.mode === 'zone' && w.map === 'warehouse' && w.zone && w.zone.o === -1, '점령전에 들어가면 맵과 거점 상태(주인 없음)를 받는다', JSON.stringify(w && { mode: w.mode, map: w.map, zone: w.zone }));
  const team = w.team, zone = getMap('warehouse').zones[0];
  a.send({ t: 'tp', p: [zone.x + 2, 0, zone.z + 2] }); // 위치는 서버가 정한다 → 테스트용 순간이동
  const half = await a.waitFor('zone', m => m.ct === team && m.p >= 0.4, 7000);
  check(!!half, '거점 안에 들어가면 내 팀 게이지가 찬다', JSON.stringify(a.msgs.filter(m => m.t === 'zone').slice(-1)));
  const cap = await a.waitFor('zcap', m => m.team === team, 8000);
  check(!!cap, '다 차면 점령 알림(zcap)이 온다');
  const scored = await a.waitFor('zone', m => m.o === team && m.ts[team] >= 1, 3000);
  check(!!scored, '거점을 가진 팀은 1초마다 1점', JSON.stringify(scored && scored.ts));

  const b = connect(srv.port, 'bravo', { mode: 'zone' }); await b.open;
  const bw = await b.waitFor('welcome');
  check(bw.team !== team && bw.zone.o === team, '나중에 들어온 사람은 다른 팀 + 지금 거점 상태를 받는다');
  b.send({ t: 'tp', p: [zone.x - 2, 0, zone.z - 2] });
  const contested = await a.waitFor('zone', m => m.c === 1, 3000);
  const scoreAt = contested ? contested.ts[team] : -1;
  await sleep(2200);
  const last = [...a.msgs].reverse().find(m => m.t === 'zone');
  check(contested && last.c === 1 && last.ts[team] === scoreAt, '양 팀이 함께 있으면 교전 중 — 점수가 멈춘다', JSON.stringify(last));

  b.send({ t: 'tp', p: [30, 0, 40] }); // 상대가 거점을 떠난다
  const end = await a.waitFor('end', () => true, 10000);
  check(end && end.wt === team && end.ts[team] === GOAL, '목표 점수에 먼저 닿은 팀이 이긴다', JSON.stringify(end && { wt: end.wt, ts: end.ts }));
  const again = await a.waitFor('start', () => true, 5000);
  check(again && again.zone && again.zone.o === -1 && String(again.ts) === '0,0', '새 경기는 거점이 비고 점수가 0 : 0', JSON.stringify(again && again.zone));
  a.ws.close(); b.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}

console.log('\n[봇: 싸울 상대가 없으면 거점으로]');
const srv2 = await startServer({ MATCH_SECONDS: '90' });
try {
  const c = connect(srv2.port, 'watcher', { mode: 'zone' }); await c.open;
  await c.waitFor('welcome');
  c.send({ t: 'tp', p: [0, 30, 0] }); // 하늘 위 (거점 높이 밖, 봇 시야에도 잘 안 걸린다)
  const got = await c.waitFor('zone', m => m.n[0] + m.n[1] >= 2, 45000) // 스폰에서 거점까지 걸어오는 데 보통 15~25초 (기기가 바쁘면 더);
  check(!!got, '봇들이 거점에 들어간다', JSON.stringify([...c.msgs].reverse().find(m => m.t === 'zone')));
  const owned = await c.waitFor('zcap', () => true, 50000); // 보통 20초 안팎 (서로 싸우느라 늦어질 수 있다)
  check(!!owned, '봇끼리도 거점을 점령한다');
  c.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv2.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
