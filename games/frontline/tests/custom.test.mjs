// 서버 규칙 테스트 4: 친선전 (방 만들기, 코드 입장, 방 목록, 비공개, 봇 끄기, 제한 시간)
import { startServer, getStatus, check, failed, sleep } from './helpers.mjs';
import { WebSocket } from 'ws';

function conn(port, msg) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, me: -1, msgs: [], players: new Map(), closed: false };
  ws.on('message', raw => {
    const m = JSON.parse(raw); c.msgs.push(m);
    if (m.t === 'welcome') { c.me = m.id; m.players.forEach(p => c.players.set(p.id, p)); }
    if (m.t === 'pj') c.players.set(m.player.id, m.player);
    if (m.t === 'pl') c.players.delete(m.id);
  });
  ws.on('close', () => { c.closed = true; });
  c.send = m => ws.send(JSON.stringify(m));
  c.find = (t, fn = () => true) => c.msgs.find(m => m.t === t && fn(m));
  c.waitFor = async (t, fn = () => true, timeout = 4000) => { const end = Date.now() + timeout; while (Date.now() < end) { const m = c.find(t, fn); if (m) return m; await sleep(50); } return null; };
  c.open = new Promise((res, rej) => { ws.on('open', () => { c.send({ t: 'join', ...msg }); res(); }); ws.on('error', rej); });
  return c;
}
const rooms = async port => (await (await fetch(`http://localhost:${port}/rooms`)).json()).rooms;

const srv = await startServer({ GOAL: '999' });
let exitCode = 0;
try {
  console.log('[방 만들기]');
  const host = conn(srv.port, { name: '방장', mode: 'tdm', create: { name: '우리끼리 한판', private: false, bots: false, minutes: 3 } });
  await host.open;
  const w = await host.waitFor('welcome');
  check(w && w.room && /^[A-HJ-NP-Z2-9]{4}$/.test(w.room.code), '방을 만들면 4글자 코드가 생긴다', JSON.stringify(w && w.room));
  check(w && w.room.name === '우리끼리 한판' && w.mode === 'tdm' && w.room.minutes === 3, '이름·모드·제한 시간이 그대로 적용된다', JSON.stringify(w && { room: w.room, mode: w.mode }));
  check(w && Math.abs(w.left - 180000) < 3000, '제한 시간 3분이 남은 시간으로 내려온다', `${w && w.left}ms`);
  await sleep(800);
  check(host.players.size === 1 && !host.find('pj'), '봇 채우기를 끄면 봇이 들어오지 않는다');

  console.log('\n[방 목록과 코드 입장]');
  let list = await rooms(srv.port);
  check(list.length === 1 && list[0].code === w.room.code && list[0].humans === 1 && list[0].max === 10 && list[0].mode === 'tdm', '공개 방은 목록에 보인다', JSON.stringify(list));
  const priv = conn(srv.port, { name: '비밀방장', mode: 'ffa', create: { name: '비밀', private: true, bots: true, minutes: 5 } });
  await priv.open; const pw = await priv.waitFor('welcome');
  list = await rooms(srv.port);
  check(list.length === 1 && list.every(r => r.code !== pw.room.code), '비공개 방은 목록에 보이지 않는다');
  await sleep(1200);
  check([...priv.players.values()].filter(p => p.bot).length === 5, '봇 채우기를 켜면 봇이 채워진다 (개인전 6명)');

  const guest = conn(srv.port, { name: '손님', code: w.room.code.toLowerCase() });
  await guest.open; const gw = await guest.waitFor('welcome');
  check(gw && gw.room && gw.room.code === w.room.code && gw.mode === 'tdm', '코드로 입장하면 같은 방에 들어간다 (소문자도 허용)');
  await sleep(300);
  check(host.find('pj', m => m.player.name === '손님'), '방장에게 손님 입장이 알려진다');
  const gp = [...guest.players.values()].map(p => p.team);
  check(gp.length === 2 && gp[0] !== gp[1], '두 사람은 서로 다른 팀으로 배정된다 (인원이 적은 쪽)', JSON.stringify(gp));

  const priv2 = conn(srv.port, { name: '초대받은친구', code: pw.room.code });
  await priv2.open;
  check(!!(await priv2.waitFor('welcome')), '비공개 방도 코드로는 입장할 수 있다');

  console.log('\n[입장 거부]');
  const bad = conn(srv.port, { name: 'x', code: 'ZZZZ' }); await bad.open;
  const d1 = await bad.waitFor('denied');
  check(d1 && d1.reason === 'not_found', '없는 코드는 not_found 로 거부된다');
  await sleep(200); check(bad.closed, '거부되면 연결이 닫힌다');

  console.log('\n[빠른 시작과 분리]');
  const quick = conn(srv.port, { name: '빠른', mode: 'tdm' }); await quick.open;
  const qw = await quick.waitFor('welcome');
  check(qw && qw.room === null, '빠른 시작은 친선전 방에 들어가지 않고 별도의 방을 쓴다');
  const st = await getStatus(srv.port);
  check(st.custom === 2 && st.rooms === 3, '/status 가 친선전 방 수를 알려 준다', JSON.stringify({ rooms: st.rooms, custom: st.custom }));

  console.log('\n[방 정리, 정원, 입력 정리]');
  const full = conn(srv.port, { name: '방장2', mode: 'tdm', create: { name: '정원', bots: false, minutes: 5 } }); await full.open;
  const fw = await full.waitFor('welcome');
  const fill = [];
  for (let i = 0; i < 9; i++) { const c = conn(srv.port, { name: `f${i}`, code: fw.room.code }); await c.open; await c.waitFor('welcome'); fill.push(c); }
  const over = conn(srv.port, { name: '열한번째', code: fw.room.code }); await over.open;
  check((await over.waitFor('denied'))?.reason === 'full', '정원(10명)이 차면 full 로 거부된다');
  fill.forEach(c => c.ws.close()); full.ws.close(); over.ws.close();

  const odd = conn(srv.port, { name: '이름정리', mode: 'ffa', create: { name: '  <b>긴이름</b>\n'.repeat(5), minutes: 999, bots: false } }); await odd.open;
  const ow = await odd.waitFor('welcome');
  check(ow.room.name.length <= 20 && !/\n/.test(ow.room.name) && ow.room.minutes === 5, '방 이름은 20자·한 줄로 정리되고, 허용되지 않은 시간은 5분으로 처리된다', JSON.stringify(ow.room));
  const def = conn(srv.port, { name: '기본이름', mode: 'ffa', create: { bots: false } }); await def.open;
  check((await def.waitFor('welcome')).room.name === '기본이름의 방', '이름이 없으면 "<내 이름>의 방" 이 된다');
  odd.ws.close(); def.ws.close();

  host.ws.close(); guest.ws.close();
  await sleep(700);
  list = await rooms(srv.port);
  check(!list.some(r => r.code === w.room.code), '사람이 모두 나가면 방이 목록에서 사라진다');
  check((await (async () => { const c = conn(srv.port, { name: '늦은', code: w.room.code }); await c.open; return c.waitFor('denied'); })())?.reason === 'not_found', '사라진 방의 코드로는 입장할 수 없다');
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
