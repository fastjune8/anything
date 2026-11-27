// 맵 순환 (서버·브라우저 없이 + 임시 서버 1대): 맵 풀에서 경기마다 무작위로 고르고, 같은 맵이 연달아 나오지 않는다.
import { check, failed, startServer, connect, sleep } from './helpers.mjs';
import { poolOf, pickMap } from '../shared/maps/rotation.js';
import { MODES } from '../shared/modes.js';
import { MAP_IDS } from '../shared/maps/index.js';

console.log('[맵 풀 규칙]');
{
  const pool = ['a', 'b', 'c'];
  const seen = new Set(); let repeat = 0, last = null;
  for (let i = 0; i < 300; i++) { const m = pickMap(pool, last); seen.add(m); if (m === last) repeat++; last = m; }
  check(seen.size === 3, '300번 뽑으면 풀의 맵이 전부 나온다');
  check(repeat === 0, '직전 맵은 다시 나오지 않는다 (연속 반복 0회)');
  check(pickMap(['x'], 'x') === 'x', '풀에 맵이 하나뿐이면 그 맵');
  check(pickMap(pool, null, () => 0) === 'a' && pickMap(pool, null, () => 0.999999) === 'c', '난수 0~1 이 풀 전체에 고르게 대응 (끝값도 범위 안)');
  check(poolOf({ map: 'a', mapPool: ['a', 'zz', 'b'] }, ['a', 'b']).join() === 'a,b', '없는 맵은 풀에서 뺀다');
  check(poolOf({ map: 'a' }, ['a', 'b']).join() === 'a', 'mapPool 이 없으면 기본 맵 하나');
  check(poolOf({ map: 'a', mapPool: ['q'] }, ['a']).join() === 'a', '풀이 전부 없는 맵이면 기본 맵으로');
}

console.log('[콘텐츠: 모든 모드가 맵 풀을 갖는다]');
for (const m of Object.values(MODES)) {
  const pool = poolOf(m, MAP_IDS);
  check(pool.length >= 3 && pool.every(id => MAP_IDS.includes(id)), `${m.name}: 맵 ${pool.length}종 (${pool.join(', ')})`);
}

console.log('[서버: 방마다 무작위 · 직접 고른 맵은 고정 · 재매치는 다른 맵]');
{
  const srv = await startServer({ FORCE_MAP: '', MATCH_SECONDS: '2', VICTORY_SECONDS: '0.3', RESULTS_SECONDS: '4' }); // 맵 순환을 켜고, 경기를 2초로 짧게
  try {
    const maps = new Set();
    for (let i = 0; i < 12; i++) {
      const c = await connect(srv.port, `r${i}`).ready();
      c.send({ t: 'rcreate', name: `x${i}`, mode: 'dom', pass: `p${i}`, bots: false });
      const w = await c.waitFor('welcome');
      maps.add(w && w.map); c.close();
    }
    check(maps.size >= 2 && [...maps].every(id => MAP_IDS.includes(id)), `랜덤 방 12개에서 서로 다른 맵이 나온다 (${[...maps].join(', ')})`);

    const f = await connect(srv.port, 'fixed').ready();
    f.send({ t: 'rcreate', name: 'fixed', mode: 'dom', map: 'aster', pass: 'zz', bots: false });
    const wf = await f.waitFor('welcome');
    check(wf && wf.map === 'aster', '맵을 직접 고른 방은 그 맵으로 고정');
    f.close();

    const r = await connect(srv.port, 'rematch').ready();
    r.send({ t: 'rcreate', name: 'rematch', mode: 'ffa', pass: 'rr', bots: false }); // 점령전은 동점이면 연장전이라 시간 종료로 끝나는 개인전으로
    const w0 = await r.waitFor('welcome');
    const end = await r.waitFor('end', () => true, 9000);
    r.send({ t: 'rematch', v: true });
    const start = await r.waitFor('start', () => true, 9000);
    check(!!end && !!start && start.map && start.map !== w0.map && MAP_IDS.includes(start.map), `재매치는 다른 맵으로 (${w0 && w0.map} → ${start && start.map})`);
        r.close();
  } finally { srv.stop(); }
}
await sleep(100);
process.exit(failed() ? 1 : 0);
