// 서버 규칙 테스트 3: 팀 데스매치 (모드 선택, 팀 배정, 아군 사격 무효, 팀 점수, 팀 승패)
import { startServer, getStatus, check, failed, sleep, TEST_LOADOUT, W } from './helpers.mjs';
import { WebSocket } from 'ws';

// 모드를 지정해서 접속하는 클라이언트 (helpers 의 connect 는 기본 모드로만 접속)
function connectMode(port, name, mode) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, me: -1, team: -1, msgs: [], players: new Map() };
  ws.on('message', raw => {
    const m = JSON.parse(raw); c.msgs.push(m);
    if (m.t === 'welcome') { c.me = m.id; c.team = m.team; m.players.forEach(p => c.players.set(p.id, p)); }
    if (m.t === 'pj') c.players.set(m.player.id, m.player);
    if (m.t === 'pl') c.players.delete(m.id);
    if (m.t === 'kill' && m.victim === c.me) setTimeout(() => { if (ws.readyState === 1) c.send({ t: 'respawn' }); }, 1700);
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.find = (t, fn = () => true) => c.msgs.find(m => m.t === t && fn(m));
  c.waitFor = async (t, fn = () => true, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { const m = c.find(t, fn); if (m) return m; await sleep(50); } return null; };
  c.isAlive = id => { let v = false; for (const m of c.msgs) { if (m.t === 'spawn' && m.id === id) v = true; if (m.t === 'kill' && m.victim === id) v = false; } return v; };
  c.spawnedAgo = id => { const s = [...c.msgs].reverse().find(m => m.t === 'spawn' && m.id === id); return s ? Date.now() - s.at : 0; };
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'spawn') c.msgs[c.msgs.length - 1].at = Date.now(); });
  c.open = new Promise((res, rej) => { ws.on('open', () => { c.send({ t: 'join', name, mode, loadout: TEST_LOADOUT }); res(); }); ws.on('error', rej); });
  return c;
}

const srv = await startServer({ MATCH_SECONDS: '16', RESTART_SECONDS: '2', GOAL: '999' });
let exitCode = 0;
try {
  console.log('[모드 선택과 팀 배정]');
  const a = connectMode(srv.port, 'alpha', 'tdm'); await a.open;
  const w = await a.waitFor('welcome');
  check(w && w.mode === 'tdm' && (w.team === 0 || w.team === 1), '팀 데스매치로 입장하면 팀을 배정받는다', JSON.stringify(w && { mode: w.mode, team: w.team }));
  await sleep(1200);
  const teams = () => [0, 1].map(t => [...a.players.values()].filter(p => p.team === t).length);
  check(a.players.size === 10 && String(teams()) === '5,5', '혼자 입장하면 봇이 채워져 5 대 5 가 된다', `총 ${a.players.size}명, 팀 ${teams()}`);
  const mySpawn = a.find('spawn', m => m.id === a.me);
  check(mySpawn && (a.team === 0 ? mySpawn.p[2] > 30 : mySpawn.p[2] < -30), '자기 팀 진영에서 스폰한다', JSON.stringify(mySpawn && mySpawn.p));

  const b = connectMode(srv.port, 'bravo', 'tdm'); await b.open; await b.waitFor('welcome');
  await sleep(800);
  check(a.players.size === 10 && String(teams()) === '5,5', '사람이 더 들어와도 5 대 5 가 유지된다 (봇이 빠진다)', `팀 ${teams()}`);

  const f = connectMode(srv.port, 'solo', 'ffa'); await f.open; const fw = await f.waitFor('welcome');
  const st = await getStatus(srv.port);
  check(fw.mode === 'ffa' && st.rooms === 2 && st.modes.tdm.humans === 2 && st.modes.ffa.humans === 1, '개인전은 별도의 방으로 들어가고, /status 가 모드별 인원을 알려 준다', JSON.stringify(st.modes));
  f.ws.close();

  console.log('\n[아군 사격 무효 / 팀 점수]');
  const AWM = W('awm');
  const sameTeam = a.team === b.team;
  check(sameTeam, '(준비) 두 사람이 같은 팀이다');
  await sleep(3200); // 스폰 무적이 끝날 때까지
  let ffDamage = false;
  for (let i = 0; i < 3; i++) { a.send({ t: 'hit', w: AWM, hits: [['head', 5, b.me]] }); await sleep(250); if (a.find('dmg', m => m.to === b.me && m.from === a.me)) ffDamage = true; }
  check(!ffDamage, '아군을 쏴도 피해가 들어가지 않는다');

  let kill = null;
  for (let i = 0; i < 14 && !kill; i++) {
    const foe = [...a.players.values()].find(p => p.team !== a.team && a.isAlive(p.id) && a.spawnedAgo(p.id) > 3200);
    if (foe && a.isAlive(a.me)) { a.send({ t: 'hit', w: AWM, hits: [['head', 5, foe.id]] }); kill = await a.waitFor('kill', m => m.killer === a.me && m.victim === foe.id, 600); }
    else await sleep(300);
  }
  check(!!kill, '적 팀은 맞힐 수 있다');
  check(kill && Array.isArray(kill.ts) && kill.ts[a.team] >= 1, '킬이 팀 점수에 더해진다', JSON.stringify(kill && kill.ts));

  console.log('\n[팀 승패와 재시작]');
  const end = await a.waitFor('end', () => true, 20000);
  const expected = end ? (end.ts[0] === end.ts[1] ? -1 : end.ts[0] > end.ts[1] ? 0 : 1) : null;
  check(end && end.wt === expected, '시간이 끝나면 점수가 높은 팀이 이긴다 (동점은 무승부)', JSON.stringify(end && { wt: end.wt, ts: end.ts }));
  const again = await a.waitFor('start', () => true, 6000);
  check(again && String(again.ts) === '0,0' && again.players.every(p => p.team === 0 || p.team === 1), '새 경기는 팀 점수가 0 : 0 으로 시작하고 팀은 유지된다');
  a.ws.close(); b.ws.close();
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
