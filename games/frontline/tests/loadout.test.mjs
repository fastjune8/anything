// 서버 규칙 테스트 5: 출전 무기(2개)와 파츠 — 들고 온 무기로만 쏘고 맞힐 수 있고, 파츠가 피해 계산과 사격 전달에 반영된다
import { startServer, connect, check, failed, sleep } from './helpers.mjs';
import { WEAPONS, calcDamage } from '../shared/weapons.js';
import { applyParts } from '../shared/parts.js';

const idx = id => WEAPONS.findIndex(w => w.id === id);
const M4 = idx('m4'), MP5 = idx('mp5'), AWM = idx('awm'), M9 = idx('m9');

const srv = await startServer({ MATCH_SECONDS: '60', GOAL: '999', BOT_FILL: '0' });
let exitCode = 0;
try {
  console.log('[입장: 출전 무기 전달과 정리]');
  const a = connect(srv.port, 'loader', { loadout: [{ id: 'm4', parts: { barrel: 'suppressor', optic: 'scope_hi', junk: 1 } }, { id: 'mp5', parts: {} }, { id: 'awm' }] });
  await a.open; await a.waitFor('welcome');
  const b = connect(srv.port, 'watcher'); await b.open;
  const wb = await b.waitFor('welcome');
  const la = wb.players.find(p => p.id === a.me).lo;
  check(JSON.stringify(la) === JSON.stringify([[M4, { barrel: 'suppressor' }], [MP5, {}]]), '무기는 2개까지, 달 수 없는 파츠는 버리고 방 사람들에게 전달된다', JSON.stringify(la));
  const pj = await a.waitFor('pj', m => m.player.id === b.me);
  check(JSON.stringify(pj.player.lo) === JSON.stringify([[AWM, {}], [M9, {}]]), '나중에 들어온 사람의 출전 무기도 알려진다');
  const c = connect(srv.port, 'broken', { loadout: { id: 'awm' } }); await c.open;
  const wc = await c.waitFor('welcome');
  check(JSON.stringify(wc.players.find(p => p.id === c.me).lo) === JSON.stringify([[M4, {}], [M9, {}]]), '형식이 깨진 출전 무기는 기본 무기(M4A1, M9)로 입장한다');
  c.ws.close();

  console.log('\n[명중: 들고 온 무기와 파츠 성능]');
  await sleep(3300); // 스폰 무적이 끝날 때까지
  a.send({ t: 'hit', w: AWM, hits: [['head', 5, b.me]] });
  a.send({ t: 'hit', w: M9, hits: [['body', 5, b.me]] });
  await sleep(400);
  check(!a.find('dmg', m => m.to === b.me), '들고 오지 않은 무기(AWM, M9)의 명중 신고는 무시된다');
  a.send({ t: 'hit', w: M4, hits: [['body', 60, b.me]] });
  const d = await a.waitFor('dmg', m => m.to === b.me && m.from === a.me, 2000);
  const withPart = Math.round(calcDamage(applyParts(WEAPONS[M4], { barrel: 'suppressor' }), 'body', 60)), plain = Math.round(calcDamage(M4, 'body', 60));
  check(!!d && d.dmg === withPart && withPart < plain, `소음기를 단 M4A1 의 60m 피해는 파츠가 반영된 값이다 (${withPart}, 기본 ${plain})`, JSON.stringify(d));

  console.log('\n[사격 전달: 소음기 표시]');
  const o = [0, 1.5, 0];
  a.send({ t: 'shot', w: M4, o, e: [] });
  const quiet = await b.waitFor('shot', m => m.id === a.me && m.w === M4, 2000);
  check(!!quiet && quiet.q === 1, '소음기를 단 무기의 사격에는 조용함 표시(q)가 붙는다');
  a.send({ t: 'shot', w: MP5, o, e: [], q: 1 });
  const loud = await b.waitFor('shot', m => m.id === a.me && m.w === MP5, 2000);
  check(!!loud && loud.q === undefined, '소음기가 없는 무기는 클라이언트가 q 를 붙여 보내도 지워진다');
  a.send({ t: 'shot', w: AWM, o, e: [] });
  await sleep(400);
  check(!b.find('shot', m => m.id === a.me && m.w === AWM), '들고 오지 않은 무기의 사격은 전달되지 않는다');
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
