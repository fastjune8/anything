// 서버 규칙 테스트 2: 스폰 무적 (봇 없는 서버에서 사람 둘로 확인)
import { startServer, connect, check, failed, sleep } from './helpers.mjs';

const srv = await startServer({ MATCH_SECONDS: '120', GOAL: '999', BOT_FILL: '0' });
let exitCode = 0;
try {
  console.log('[스폰 무적 3초]');
  const a = connect(srv.port, 'attacker'); await a.open; await a.waitFor('welcome');
  const b = connect(srv.port, 'victim'); await b.open; await b.waitFor('welcome');
  const bSpawn = await a.waitFor('spawn', m => m.id === b.me);
  const spawnedAt = Date.now();
  check(bSpawn && bSpawn.inv === 3000, '스폰 메시지에 무적 시간(3000ms)이 들어 있다', JSON.stringify(bSpawn));

  const M9 = 6;
  a.send({ t: 'hit', w: M9, hits: [['body', 5, b.me]] });
  await sleep(700);
  check(!a.find('dmg', m => m.to === b.me), '스폰 직후에는 맞아도 피해를 받지 않는다');

  await sleep(Math.max(0, 3150 - (Date.now() - spawnedAt)));
  a.send({ t: 'hit', w: M9, hits: [['body', 5, b.me]] });
  check(!!(await a.waitFor('dmg', m => m.to === b.me && m.from === a.me, 2000)), '3초가 지나면 피해를 받는다');

  console.log('\n[쏘면 무적 해제]');
  const c = connect(srv.port, 'shooter'); await c.open; await c.waitFor('welcome');
  await a.waitFor('spawn', m => m.id === c.me);
  c.send({ t: 'shot', w: M9, o: [0, 1.5, 0], e: [] });
  await sleep(150);
  a.send({ t: 'hit', w: M9, hits: [['body', 5, c.me]] });
  check(!!(await a.waitFor('dmg', m => m.to === c.me && m.from === a.me, 2000)), '무적 중에 사격한 사람은 바로 피해를 받는다');

  console.log('\n[부활: 자동 부활 없음, 입력하면 부활]');
  b.autoRespawn = false;
  const AWM = 4;
  a.send({ t: 'hit', w: AWM, hits: [['head', 5, b.me]] });
  const killed = await a.waitFor('kill', m => m.victim === b.me, 2000);
  check(!!killed, '(준비) 상대를 죽였다');
  const spawnsBefore = a.msgs.filter(m => m.t === 'spawn' && m.id === b.me).length;
  const spawnCount = () => a.msgs.filter(m => m.t === 'spawn' && m.id === b.me).length - spawnsBefore;
  b.send({ t: 'respawn' });
  await sleep(500);
  check(spawnCount() === 0, '죽은 직후의 부활 요청은 무시된다 (최소 1.5초)');
  await sleep(3500);
  check(spawnCount() === 0, '4초가 지나도 자동으로 부활하지 않는다');
  b.send({ t: 'respawn' });
  await sleep(500);
  check(spawnCount() === 1, '최소 시간이 지난 뒤 요청하면 부활한다');
  b.send({ t: 'respawn' }); await sleep(300);
  check(spawnCount() === 1, '살아 있을 때의 부활 요청은 무시된다');

  console.log('\n[체력 회복이 다른 사람에게도 보인다]');
  {
    await sleep(3200); // 부활 직후 무적이 끝나기를 기다린 뒤 한 대 맞힌다
    a.send({ t: 'hit', w: M9, hits: [['body', 5, b.me]] });
    check(!!(await a.waitFor('dmg', m => m.to === b.me && m.hp < 100, 2000)), '(준비) 상대가 체력을 잃었다');
    const aA = a.msgs.length;
    await sleep(6200); // 마지막 피해 후 5초가 지나면 0.5초마다 +5
    const heal = a.msgs.slice(aA).filter(m => m.t === 'rh' && m.id === b.me);
    check(heal.length >= 1 && heal[heal.length - 1].hp > heal[0].hp - 1, '회복하면 다른 사람에게도 rh(id, hp) 가 전달된다', `${heal.length}번`);
    check(b.msgs.filter(m => m.t === 'hp').length >= 1 && !a.msgs.slice(aA).some(m => m.t === 'hp'), '본인에게는 기존 hp 메시지가 가고, 다른 사람에게는 hp 가 가지 않는다 (옛 화면 호환)');
    check(!b.msgs.some(m => m.t === 'rh' && m.id === b.me), '회복하는 본인에게는 rh 가 가지 않는다');
  }

  console.log('\n[입장 정보]');
  await sleep(3100); a.send({ t: 'hit', w: M9, hits: [['body', 5, b.me]] }); await sleep(300);
  const d = connect(srv.port, 'late'); await d.open;
  const w = await d.waitFor('welcome');
  const bInfo = w && w.players.find(p => p.id === b.me);
  check(bInfo && bInfo.hp < 100 && bInfo.hp > 0, '나중에 들어온 사람도 다른 사람의 현재 체력을 받는다 (머리 위 체력바용)', JSON.stringify(bInfo));
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
