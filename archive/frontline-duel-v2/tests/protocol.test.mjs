// 서버 규칙 테스트: 방 / 봇 / 명중 / 경기 종료·재시작 (브라우저 없이 WebSocket 만으로)
import { startServer, connect, getStatus, check, failed, sleep } from './helpers.mjs';

const srv = await startServer({ MATCH_SECONDS: '12', RESTART_SECONDS: '2', GOAL: '999' });
console.log(`임시 서버 포트 ${srv.port}`);
let exitCode = 0;
try {
  console.log('\n[입장과 봇 채우기]');
  const a = connect(srv.port, 'tester-a'); await a.open;
  const welcome = await a.waitFor('welcome');
  check(!!welcome, '입장하면 welcome 을 받는다');
  check(welcome && welcome.goal === 999 && welcome.state === 'playing', '진행 중인 경기에 바로 들어간다 (대기 없음)');
  await sleep(1200);
  const bots = [...a.players.values()].filter(p => p.bot);
  check(bots.length === 5, '혼자 입장하면 봇이 5명 채워진다', `봇 ${bots.length}명`);
  check(!!a.find('spawn', m => m.id === a.me), '내가 스폰된다');

  const st = await getStatus(srv.port);
  check(st.env === 'test' && st.humans === 1 && st.rooms === 1, '/status 가 방 1개, 사람 1명을 보고한다', JSON.stringify(st));

  console.log('\n[봇 동작]');
  await sleep(2500);
  check(a.count('s') > 100, '봇 위치가 계속 전송된다', `s 메시지 ${a.count('s')}개`);
  const movedIds = new Set(a.msgs.filter(m => m.t === 's').map(m => m.id));
  check(bots.every(b => movedIds.has(b.id)), '모든 봇이 움직인다');
  check(a.count('shot') > 0, '봇이 사격한다');

  console.log('\n[명중과 킬]');
  // 봇끼리도 싸우므로, 나와 대상이 모두 살아있는 순간에 쏜다 (살아있음 = 마지막 spawn 이후 kill 당하지 않음)
  const isAlive = id => { let v = false; for (const m of a.msgs) { if (m.t === 'spawn' && m.id === id) v = true; if (m.t === 'kill' && m.victim === id) v = false; } return v; };
  let dmg = null, target = null;
  for (let i = 0; i < 12 && !dmg; i++) {
    target = bots.find(p => isAlive(p.id));
    if (target && isAlive(a.me)) {
      a.send({ t: 'hit', w: 4, hits: [['head', 20, target.id]] });
      dmg = await a.waitFor('dmg', m => m.from === a.me && m.to === target.id, 800);
    } else await sleep(400);
  }
  check(!!dmg, '내가 보낸 명중이 피해로 인정된다');
  const kill = await a.waitFor('kill', m => m.killer === a.me && m.victim === target?.id, 3000);
  check(!!kill && kill.head === true, 'AWM 헤드샷 한 발로 킬 + 헤드샷 표시');
  check(kill && kill.sc.some(([id, k]) => id === a.me && k >= 1), '킬 수가 순위표에 반영된다');
  a.send({ t: 'hit', w: 4, hits: [['body', 5, 99]] });
  a.send({ t: 'hit', w: 4, hits: [['body', 5, a.me]] });
  await sleep(300);
  check(true, '존재하지 않는 대상/자기 자신에 대한 명중 신호를 무시한다 (서버 유지)');

  console.log('\n[다른 사람 입장]');
  const botsBefore = [...a.players.values()].filter(p => p.bot).length;
  const b = connect(srv.port, 'tester-b'); await b.open;
  await b.waitFor('welcome');
  await sleep(800);
  const botsAfter = [...a.players.values()].filter(p => p.bot).length;
  check(botsAfter === botsBefore - 1, '사람이 들어오면 봇이 하나 빠진다', `${botsBefore} → ${botsAfter}`);
  check(!!a.find('pj', m => m.player.name === 'tester-b'), '기존 플레이어에게 새 입장이 알려진다');
  check((await getStatus(srv.port)).humans === 2 && (await getStatus(srv.port)).rooms === 1, '같은 방에 사람 2명');
  b.ws.close(); await sleep(800);
  check([...a.players.values()].filter(p => p.bot).length === botsBefore, '사람이 나가면 봇이 다시 채워진다');

  console.log('\n[경기 종료와 재시작]');
  const end = await a.waitFor('end', () => true, 15000);
  check(!!end, '시간이 지나면 경기가 종료된다');
  check(end && typeof end.winner === 'number' && end.sc.length >= 6, '종료 메시지에 우승자와 전체 순위가 있다');
  const startAgain = await a.waitFor('start', () => true, 6000);
  check(!!startAgain, '잠시 뒤 새 경기가 자동 시작된다');
  check(startAgain && startAgain.players.every(p => p.k === 0 && p.d === 0), '새 경기는 기록이 초기화된다');

  console.log('\n[방 정리]');
  a.ws.close(); await sleep(500);
  const after = await getStatus(srv.port);
  check(after.rooms === 0 && after.humans === 0, '사람이 모두 나가면 방이 사라진다', JSON.stringify(after));
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
