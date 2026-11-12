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

  console.log('\n[입장 정보]');
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
