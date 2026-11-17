// 랙 보정 테스트: 서버가 쏜 사람이 보던 순간으로 상대를 되돌려 명중 신고를 확인한다
import { startServer, connect, check, failed, sleep, W } from './helpers.mjs';
import { calcDamage } from '../shared/weapons.js';

const M9 = W('m9');
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const lastS = (c, id) => [...c.msgs].reverse().find(m => m.t === 's' && m.id === id);
// a 가 eye 에서 target 지점을 쏜 명중 신고 (n = 보고 있던 상대 위치의 tick 번호)
const shot = (eye, target, victim, n, part = 'body', dirOverride) => {
  const d = dirOverride || norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  return { t: 'hit', w: M9, o: eye, hits: [[part, 10, victim, d[0], d[1], d[2], n]] };
};

const srv = await startServer({ BOT_FILL: '0', GOAL: '999', MATCH_SECONDS: '120', HIT_CHECK: 'on' });
let exitCode = 0;
try {
  const a = connect(srv.port, 'shooter'); await a.open; await a.waitFor('welcome');
  const b = connect(srv.port, 'target'); await b.open; await b.waitFor('welcome');
  // b 가 계속 입력을 보내서 서버가 위치를 계속 알린다 (가만히 서 있기)
  let bs = 0; const hold = setInterval(() => { b.send({ t: 'in', s: bs, i: [0, 1, 2].map(() => [0, 0, 0, 0, 0, M9, 0]) }); bs += 3; }, 50);
  a.send({ t: 'tp', p: [30, 0, 30], y: Math.PI / 2 }); b.send({ t: 'tp', p: [20, 0, 30], y: 0 });
  await sleep(3400); // 스폰 무적이 끝날 때까지
  const eye = [30, 1.62, 30], body = [20, 1.2, 30];
  const dmgOf = async (msg, label) => { a.msgs.length = 0; a.send(msg); const d = await a.waitFor('dmg', m => m.to === b.me, 700); return d ? d.dmg : 0; };
  const n = () => (lastS(a, b.me) || {}).n;
  const bodyDmg = Math.round(calcDamage(M9, 'body', 10)), legDmg = Math.round(calcDamage(M9, 'leg', 10));

  console.log('[맞는 신고는 인정]');
  check(await dmgOf(shot(eye, body, b.me, n()), 'ok') === bodyDmg, `실제로 상대 몸을 지나는 사격은 인정된다 (피해 ${bodyDmg})`);

  console.log('\n[속인 신고는 버린다]');
  check(await dmgOf(shot(eye, body, b.me, n(), 'body', [0, 0, 1])) === 0, '엉뚱한 방향(상대를 지나지 않음)으로 쏜 명중은 버린다');
  check(await dmgOf(shot([21, 1.62, 30], body, b.me, n())) === 0, '쏜 위치를 상대 바로 앞으로 속이면 버린다');
  check(await dmgOf(shot(eye, [20, 0.4, 30], b.me, n(), 'head')) === legDmg, `다리를 쏘고 머리라고 신고하면 다리 피해로 (${legDmg})`);
  // 벽 너머: 컨테이너(x 20.28~22.72, z 13.97~20.03, 높이 2.59) 양옆에 세운다
  a.send({ t: 'tp', p: [25, 0, 17], y: Math.PI / 2 }); b.send({ t: 'tp', p: [18, 0, 17], y: 0 });
  await sleep(400);
  check(await dmgOf(shot([25, 1.62, 17], [18, 1.2, 17], b.me, n())) === 0, '사이에 벽(컨테이너)이 있으면 버린다');

  console.log('\n[랙 보정: 보던 순간으로 되돌려 확인]');
  a.send({ t: 'tp', p: [30, 0, 30], y: Math.PI / 2 }); b.send({ t: 'tp', p: [20, 0, 30], y: 0 });
  await sleep(400);
  const n0 = n();                                    // 이 순간 b 는 (20, 30)
  b.send({ t: 'tp', p: [20, 0, 40], y: 0 });         // b 가 10m 비켜섬
  await sleep(300);
  check(await dmgOf(shot(eye, body, b.me, n0)) === bodyDmg, '0.3초 전 상대가 있던 자리를 쐈다면 (그때 화면에는 거기 있었으므로) 인정된다');
  check(await dmgOf(shot(eye, body, b.me, n())) === 0, '지금 tick 번호로 빈 자리를 쏘면 버린다');
  await sleep(1300);
  check(await dmgOf(shot(eye, body, b.me, n0)) === 0, '1초보다 옛날 화면이라는 신고는 1초 전으로만 되돌린다 (그때는 이미 비켜섬)');
  clearInterval(hold);
  a.ws.close(); b.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
