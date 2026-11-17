// 무기 스킬 서버 테스트: 서버가 스킬을 확인하고 계산한다 (브라우저가 보낸 값을 그대로 믿지 않는다)
//   대쉬(이동 입력 플래그 → 서버가 이동, 쿨타임) · 아드레날린(쿨타임) · 유탄(유탄 수, 날아가서 터지고 범위 피해) · 과열(열이 오르면 피해 증가, 과열되면 사격 무시)
import { startServer, connect, check, failed, sleep, W } from './helpers.mjs';
import { getSkill } from '../shared/skills.js';
import { calcDamage, WEAPONS } from '../shared/weapons.js';

const AR = W('ar'), M9 = W('m9');
const lastMe = c => [...c.msgs].reverse().find(m => m.t === 'me');
let seq = 0;
async function inputs(c, list) { for (let k = 0; k < list.length; k += 3) { c.send({ t: 'in', s: seq + k, i: list.slice(k, k + 3) }); await sleep(50); } seq += list.length; }
const idle = (wi, n) => Array.from({ length: n }, () => [0, 0, 0, Math.PI, 0, wi, 0]);

const srv = await startServer({ BOT_FILL: '0', GOAL: '999', MATCH_SECONDS: '120', HIT_CHECK: 'off' });
let exitCode = 0;
try {
  console.log('[대쉬: 서버가 이동시키고 쿨타임을 지킨다]');
  const dash = getSkill('dash');
  const a = connect(srv.port, 'dasher', { loadout: [{ id: 'ar', skill: 'dash' }, { id: 'm9' }] }); await a.open; await a.waitFor('welcome');
  a.send({ t: 'tp', p: [30, 0, 30], y: Math.PI }); await sleep(200);
  await inputs(a, idle(AR, 6)); await sleep(150);
  const z0 = lastMe(a).st.p[2];
  await inputs(a, [[0, 0, 8, Math.PI, 0, AR, 0], ...idle(AR, 20)]); await sleep(200); // 플래그 8 = 대쉬
  const z1 = lastMe(a).st.p[2];
  check(Math.abs(z1 - z0 - dash.dist) < 0.8 && lastMe(a).st.dc > 0, `대쉬 키를 보내면 서버가 앞으로 약 ${dash.dist}m 옮기고 쿨타임이 걸린다`, `${(z1 - z0).toFixed(2)}m, cd ${lastMe(a).st.dc}`);
  await inputs(a, [[0, 0, 8, Math.PI, 0, AR, 0], ...idle(AR, 20)]); await sleep(200);
  check(Math.abs(lastMe(a).st.p[2] - z1) < 0.3, '쿨타임 중에 보낸 대쉬는 서버가 무시한다');
  a.ws.close(); seq = 0;
  const n = connect(srv.port, 'nodash', { loadout: [{ id: 'ar', skill: 'adrenaline' }, { id: 'm9' }] }); await n.open; await n.waitFor('welcome');
  n.send({ t: 'tp', p: [30, 0, 30], y: Math.PI }); await sleep(200);
  await inputs(n, idle(AR, 6)); await sleep(150);
  const nz = lastMe(n).st.p[2];
  await inputs(n, [[0, 0, 8, Math.PI, 0, AR, 0], ...idle(AR, 20)]); await sleep(200);
  check(Math.abs(lastMe(n).st.p[2] - nz) < 0.3, '대쉬를 고르지 않은 사람이 대쉬 플래그를 보내도 움직이지 않는다');

  console.log('\n[아드레날린: 쿨타임]');
  const watcher = connect(srv.port, 'watcher'); await watcher.open; await watcher.waitFor('welcome');
  n.send({ t: 'sk', n: 0 });
  check(!!(await watcher.waitFor('sk', m => m.id === n.me && m.e === 'adrenaline', 1500)), '아드레날린을 쓰면 다른 사람에게 알린다');
  watcher.msgs.length = 0; n.send({ t: 'sk', n: 0 }); await sleep(400);
  check(!watcher.find('sk', m => m.id === n.me), '쿨타임 중에는 다시 쓸 수 없다');
  n.send({ t: 'sk', n: 1 }); await sleep(300);
  check(!watcher.find('sk', m => m.id === n.me), '스킬이 없는 자리(보조무기 M9)는 쓸 수 없다');
  n.ws.close(); watcher.ws.close(); seq = 0;

  console.log('\n[유탄: 서버가 날아가는 길과 범위 피해를 계산한다]');
  const gl = getSkill('grenade');
  const g = connect(srv.port, 'grenadier', { loadout: [{ id: 'ar', skill: 'grenade' }, { id: 'm9' }] }); await g.open; await g.waitFor('welcome');
  const v = connect(srv.port, 'victim'); await v.open; await v.waitFor('welcome');
  g.send({ t: 'tp', p: [30, 0, 30], y: 0 }); v.send({ t: 'tp', p: [30, 0, 22], y: 0 });
  await sleep(3400); // 스폰 무적이 끝날 때까지
  const eye = [30, 1.62, 30], toward = [0, -0.18, -1], len = Math.hypot(...toward), dir = toward.map(x => x / len);
  g.send({ t: 'gl', o: eye, d: dir });
  const flew = await v.waitFor('gl', m => m.by === g.me, 1500), boom = await v.waitFor('boom', m => flew && m.id === flew.id, 3000);
  const hurt = await v.waitFor('dmg', m => m.to === v.me && m.from === g.me, 1500);
  check(!!flew && !!boom, '유탄을 쏘면 모두에게 날아감(gl)과 터짐(boom)을 알린다');
  check(!!hurt && hurt.dmg > gl.dmg * 0.3 && hurt.dmg <= gl.dmg, `가까이에서 터지면 범위 피해를 준다 (최대 ${gl.dmg})`, JSON.stringify(hurt && hurt.dmg));
  g.send({ t: 'gl', o: eye, d: dir }); await sleep(100);
  g.msgs.length = 0; g.send({ t: 'gl', o: eye, d: dir }); await sleep(400);
  check(!g.find('gl', m => m.by === g.me), `유탄 ${gl.ammo}발을 다 쓰면 더 쏠 수 없다 (채워질 때까지)`);
  g.send({ t: 'gl', o: [0, 1.6, 0], d: dir }); await sleep(300);
  check(!g.find('gl', m => m.by === g.me), '쏜 위치를 속이면 버린다');
  g.ws.close(); v.ws.close();

  console.log('\n[과열: 열만큼 피해 증가, 과열되면 사격 무시]');
  const oh = getSkill('overheat');
  const h = connect(srv.port, 'heater', { loadout: [{ id: 'ar', skill: 'overheat' }, { id: 'm9' }] }); await h.open; await h.waitFor('welcome');
  const t = connect(srv.port, 'target'); await t.open; await t.waitFor('welcome');
  h.send({ t: 'tp', p: [30, 0, 30] }); t.send({ t: 'tp', p: [30, 0, 25] });
  await sleep(3400);
  const base = Math.round(calcDamage(WEAPONS[AR], 'body', 5));
  h.send({ t: 'hit', w: AR, hits: [['body', 5, t.me]] });
  const cold = await t.waitFor('dmg', m => m.to === t.me, 1500);
  check(cold && cold.dmg === base, `열이 없으면 기본 피해 (${base})`, JSON.stringify(cold && cold.dmg));
  const shots = Math.ceil(1 / oh.heat) - 2;
  for (let k = 0; k < shots; k++) h.send({ t: 'shot', w: AR, o: [30, 1.5, 30], e: [] });
  t.msgs.length = 0;
  h.send({ t: 'hit', w: AR, hits: [['body', 5, t.me]] });
  const hot = await t.waitFor('dmg', m => m.to === t.me, 1500);
  check(hot && hot.dmg > base * (1 + oh.bonus * 0.8), '연사해서 열이 오르면 피해가 커진다 (서버가 계산한 열)', JSON.stringify(hot && hot.dmg));
  for (let k = 0; k < 6; k++) h.send({ t: 'shot', w: AR, o: [30, 1.5, 30], e: [] });
  await sleep(200); t.msgs.length = 0;
  h.send({ t: 'shot', w: AR, o: [30, 1.5, 30], e: [] }); await sleep(300);
  check(!t.find('shot', m => m.id === h.me), '과열되면 식을 때까지 사격이 다른 사람에게 전달되지 않는다');
  h.send({ t: 'shot', w: M9, o: [30, 1.5, 30], e: [] });
  check(!!(await t.waitFor('shot', m => m.id === h.me && m.w === M9, 1000)), '과열 스킬이 없는 무기(M9)는 그대로 쏠 수 있다');
  h.ws.close(); t.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
