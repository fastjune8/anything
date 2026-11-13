// 브라우저 테스트: 실제 Chrome 으로 접속해서 화면과 조작이 동작하는지 확인
//  1) 화면: 봇이 있는 서버에서 접속/HUD/순위표
//  2) 게임플레이: 봇이 없는 서버에서 이동/사격/재장전/무기 교체/명중 판정 (가만히 선 가짜 플레이어를 대상으로)
// Chrome 경로가 다르면 CHROME_PATH 환경변수로 지정한다.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, connect, check, failed, sleep } from './helpers.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log(`Chrome 을 찾을 수 없어 브라우저 테스트를 건너뜁니다 (${CHROME}). CHROME_PATH 로 지정하세요.`);
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const servers = [];
async function openPage(env, query = '') {
  const srv = await startServer(env); servers.push(srv);
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${srv.port}/?auto=Tester&nolock${query}`);
  await page.waitForFunction(() => window.__g && window.__g.me.id >= 0, null, { timeout: 15000 });
  return { srv, page, errors };
}

let exitCode = 0;
try {
  // ───────── 1) 화면 ─────────
  console.log('[화면]');
  {
    const { page, errors } = await openPage({ MATCH_SECONDS: '60', GOAL: '999' });
    await sleep(4000);
    const snap = await page.evaluate(() => ({
      state: window.__g.state, remotes: window.__g.remotes.size, roster: window.__g.roster.size,
      timer: document.getElementById('timer').textContent,
      lbRows: document.querySelectorAll('#lb > div').length,
      env: document.getElementById('envtag').textContent,
      menuHidden: getComputedStyle(document.getElementById('menu')).display === 'none',
    }));
    check(snap.menuHidden, '접속하면 메뉴가 닫히고 게임 화면이 열린다');
    check(snap.state === 'playing', '경기가 진행 중이다');
    check(snap.remotes === 5 && snap.roster === 6, '봇 5명이 화면에 배정된다', `remotes=${snap.remotes}, roster=${snap.roster}`);
    check(/^\d:\d\d$/.test(snap.timer), '남은 시간이 표시된다', snap.timer);
    check(snap.lbRows >= 5, '순위표가 그려진다', `${snap.lbRows}줄`);
    check(snap.env.startsWith('TEST'), '라이브가 아닌 서버에는 환경 표시가 붙는다', snap.env);
    await sleep(7000);
    const later = await page.evaluate(() => ({
      kills: [...window.__g.roster.values()].reduce((n, p) => n + p.k, 0),
      visible: [...window.__g.remotes.values()].filter(r => r.hasPos).length,
    }));
    check(later.visible >= 4, '봇 모델에 위치가 반영된다', `${later.visible}명`);
    check(later.kills >= 1, '봇들의 킬이 순위표에 반영된다', `총 ${later.kills}킬`);
    check(errors.length === 0, '브라우저 오류가 없다', errors.join(' | '));
    await page.close();
  }

  // ───────── 2) 게임플레이 ─────────
  console.log('\n[게임플레이]  (봇 없는 서버, 가만히 선 가짜 플레이어가 대상)');
  {
    const { srv, page, errors } = await openPage({ MATCH_SECONDS: '120', GOAL: '999', BOT_FILL: '0' });
    // 가만히 서 있는 상대 하나 (위치 (10, 0, 10))
    const dummy = connect(srv.port, 'dummy'); await dummy.open;
    await dummy.waitFor('welcome');
    const dummyPos = [10, 0, 10];
    const hold = setInterval(() => dummy.send({ t: 's', p: dummyPos, y: 0, x: 0, c: 0, w: 0 }), 50);
    await page.waitForFunction(() => window.__g.me.alive && [...window.__g.remotes.values()].some(r => r.hasPos), null, { timeout: 10000 });
    await sleep(500);

    await page.evaluate(() => {
      window.__sent = {};
      const g = window.__g, orig = g.net.send.bind(g.net);
      g.net.send = m => { window.__sent[m.t] = (window.__sent[m.t] || 0) + 1; orig(m); };
    });
    const pos = () => page.evaluate(() => ({ x: window.__g.me.pos.x, z: window.__g.me.pos.z }));

    const p0 = await pos();
    await page.evaluate(() => window.__g.input({ key: 'KeyW' }));
    await sleep(1200);
    await page.evaluate(() => window.__g.input({ keyUp: 'KeyW' }));
    const p1 = await pos();
    check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.8, '앞으로 이동한다 (W)', `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)}m`);

    await sleep(600); // 무기 꺼내는 시간
    const a0 = await page.evaluate(() => window.__g.inv[window.__g.cur].ammo);
    await page.evaluate(() => window.__g.input({ fire: true }));
    await sleep(300);
    await page.evaluate(() => window.__g.input({ fire: false }));
    const a1 = await page.evaluate(() => ({ ammo: window.__g.inv[window.__g.cur].ammo, sent: window.__sent }));
    check(a1.ammo < a0, '사격하면 탄이 줄어든다', `${a0} → ${a1.ammo}`);
    check((a1.sent.shot || 0) >= 1, '사격 신호(shot)가 서버로 간다', JSON.stringify(a1.sent));

    await page.evaluate(() => window.__g.startReload());
    await page.waitForFunction(() => window.__g.inv[window.__g.cur].ammo === 30, null, { timeout: 6000 }).catch(() => {});
    check(await page.evaluate(() => window.__g.inv[window.__g.cur].ammo) === 30, '재장전하면 탄창이 가득 찬다 (M4A1 30발)');
    check((await page.evaluate(() => window.__sent.rl || 0)) >= 1, '재장전 신호(rl)가 서버로 간다');

    await page.evaluate(() => window.__g.switchTo(4));
    await page.waitForFunction(() => window.__g.cur === 4, null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => window.__g.cur) === 4, '무기를 교체한다 (5번 AWM)');
    await sleep(1200); // AWM 꺼내는 시간 (끝나기 전의 교체 입력은 무시됨)
    await page.evaluate(() => window.__g.switchTo(0));
    await page.waitForFunction(() => window.__g.cur === 0, null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => window.__g.cur) === 0, '다시 1번 M4A1 으로 교체한다');


    // 채팅: Enter 로 열고, 입력 중에는 이동하지 않고, Enter 로 보내고, Esc 로 취소한다
    const chatOpenNow = () => page.evaluate(() => document.getElementById('chat').classList.contains('open'));
    const logText = () => page.evaluate(() => document.getElementById('chatLog').textContent);
    await page.keyboard.press('Enter');
    check(await chatOpenNow() && await page.evaluate(() => document.activeElement.id) === 'chatIn', 'Enter 를 누르면 채팅 입력창이 열린다');
    const cp0 = await pos();
    await page.keyboard.type('wasd hi', { delay: 30 });
    await sleep(500);
    const cp1 = await pos();
    check(Math.hypot(cp1.x - cp0.x, cp1.z - cp0.z) < 0.05, '채팅 입력 중에는 W A S D 로 이동하지 않는다');
    dummy.msgs.length = 0;
    await page.keyboard.press('Enter');
    const sentChat = await dummy.waitFor('chat', m => m.text === 'wasd hi', 3000);
    check(!!sentChat && sentChat.name === 'Tester', 'Enter 로 보내면 다른 플레이어가 받는다');
    check(!(await chatOpenNow()), '보낸 뒤에는 입력창이 닫힌다');
    await page.waitForFunction(() => document.getElementById('chatLog').textContent.includes('wasd hi'), null, { timeout: 3000 }).catch(() => {});
    check((await logText()).includes('wasd hi'), '내 채팅창에도 메시지가 표시된다');
    dummy.send({ t: 'chat', text: '<b>굵게</b> 안녕' });
    await page.waitForFunction(() => document.getElementById('chatLog').textContent.includes('안녕'), null, { timeout: 3000 }).catch(() => {});
    const html = await page.evaluate(() => document.getElementById('chatLog').innerHTML);
    check((await logText()).includes('<b>굵게</b>') && !html.includes('<b>굵게</b>'), '상대가 보낸 HTML 은 태그로 해석되지 않고 글자 그대로 보인다');
    await page.keyboard.press('Enter'); await page.keyboard.type('취소할 말'); dummy.msgs.length = 0;
    await page.keyboard.press('Escape'); await sleep(800);
    check(!(await chatOpenNow()) && !dummy.find('chat'), 'Esc 로 취소하면 전송되지 않고 입력창이 닫힌다');
    const cp2 = await pos();
    await page.evaluate(() => window.__g.input({ key: 'KeyW' })); await sleep(800); await page.evaluate(() => window.__g.input({ keyUp: 'KeyW' }));
    const cp3 = await pos();
    check(Math.hypot(cp3.x - cp2.x, cp3.z - cp2.z) > 0.5, '채팅을 닫으면 다시 이동할 수 있다');

    // 명중 판정: 가짜 플레이어의 가슴/머리/다리를 향해 광선을 쏴서 부위와 id 가 맞는지
    const ray = await page.evaluate(() => {
      const g = window.__g, r = [...g.remotes.values()].find(x => x.alive && x.hasPos);
      if (!r) return null;
      const shoot = dy => { const h = g.remoteHit({ x: r.pos.x + 6, y: r.pos.y + dy, z: r.pos.z }, { x: -1, y: 0, z: 0 }, 50); return h && { id: h.id, part: h.part, same: h.id === r.id }; };
      return { chest: shoot(1.2), head: shoot(1.61), leg: shoot(0.4), miss: g.remoteHit({ x: r.pos.x + 6, y: r.pos.y + 3, z: r.pos.z }, { x: -1, y: 0, z: 0 }, 50) };
    });
    check(ray && ray.chest && ray.chest.same && ray.chest.part === 'body', '가슴을 겨누면 body 로 판정된다', JSON.stringify(ray && ray.chest));
    check(ray && ray.head && ray.head.part === 'head', '머리를 겨누면 head 로 판정된다', JSON.stringify(ray && ray.head));
    check(ray && ray.leg && ray.leg.part === 'leg', '다리를 겨누면 leg 로 판정된다', JSON.stringify(ray && ray.leg));
    check(ray && ray.miss === null, '머리 위로 빗나가면 판정되지 않는다');

    // 실제 사격으로 명중 → 서버가 피해로 인정하는지 (대상: 가짜 플레이어를 정면에서)
    await page.evaluate(([x, , z]) => {
      const g = window.__g; g.me.pos.set(x - 6, 0, z); g.me.yaw = Math.atan2(-6, 0) + 0; g.me.pitch = 0.0;
    }, dummyPos);
    await page.evaluate(([x, , z]) => {  // 대상을 정확히 향하도록 (yaw: 전방 = (-sin, -cos))
      const g = window.__g, dx = x - g.me.pos.x, dz = z - g.me.pos.z;
      g.me.yaw = Math.atan2(-dx, -dz); g.me.pitch = Math.atan2(1.2 - 1.6, Math.hypot(dx, dz));
    }, dummyPos);
    await sleep(1200); // 무기 꺼내는 시간 + 위치 반영
    dummy.msgs.length = 0;
    await page.evaluate(() => window.__g.input({ fire: true }));
    const gotDmg = await dummy.waitFor('dmg', m => m.to === dummy.me, 5000);
    await page.evaluate(() => window.__g.input({ fire: false }));
    check(!!gotDmg, '실제로 쏴서 맞히면 서버가 상대에게 피해를 준다', gotDmg ? '' : JSON.stringify(await page.evaluate(() => { const g = window.__g, r = [...g.remotes.values()][0]; return { sent: window.__sent, cur: g.cur, ammo: g.inv[g.cur].ammo, alive: g.me.alive, pos: g.me.pos.toArray(), yaw: g.me.yaw, pitch: g.me.pitch, remote: r && r.pos.toArray(), ralive: r && r.alive }; })));

    // 부활: 자동 부활은 없고, 최소 시간이 지난 뒤 아무 키나 누르면 부활한다
    dummy.send({ t: 'hit', w: 4, hits: [['head', 5, await page.evaluate(() => window.__g.me.id)]] });
    await page.waitForFunction(() => !window.__g.me.alive, null, { timeout: 4000 }).catch(() => {});
    check(!(await page.evaluate(() => window.__g.me.alive)), '(준비) 내가 죽었다');
    await sleep(4000);
    check(!(await page.evaluate(() => window.__g.me.alive)), '4초가 지나도 자동으로 부활하지 않는다');
    check((await page.evaluate(() => document.getElementById('deadT').textContent)).includes('아무 키'), '부활 방법 안내가 표시된다');
    await page.keyboard.press('Enter'); await sleep(400);
    check(!(await page.evaluate(() => window.__g.me.alive)), '채팅을 여는 Enter 로는 부활하지 않는다');
    await page.keyboard.press('Escape'); await sleep(200);
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.__g.me.alive, null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => window.__g.me.alive), '아무 키나 누르면 부활한다');

    check(errors.length === 0, '브라우저 오류가 없다', errors.join(' | '));
    clearInterval(hold); dummy.ws.close();
    await page.close();
  }

  // ───────── 3) 로비와 팀 데스매치 ─────────
  console.log('\n[로비 / 팀 데스매치]');
  {
    const { srv, page, errors } = await openPage({ MATCH_SECONDS: '120', GOAL: '999' }, '&mode=tdm');
    await sleep(3000);
    const t = await page.evaluate(() => ({
      team: window.__g.me.team, z: window.__g.me.pos.z,
      goal: document.getElementById('goal').textContent,
      remoteTeams: [...window.__g.remotes.values()].map(r => r.team).sort().join(''),
      allyRows: document.querySelectorAll('#lb .ally').length + document.querySelectorAll('#lb .foe').length,
    }));
    check(t.team === 0 || t.team === 1, '팀전으로 접속하면 팀이 정해진다', `team=${t.team}`);
    check(t.remoteTeams.length === 9 && t.remoteTeams.split('').filter(c => String(c) === String(t.team)).length === 4, '아군 4명 + 적군 5명이 화면에 배정된다', t.remoteTeams);
    check(t.goal.includes('아군') && t.goal.includes('적군'), '상단에 팀 점수가 표시된다', t.goal);
    check(t.allyRows >= 4, '순위표가 아군/적군 색으로 구분된다');
    const ff = await page.evaluate(() => {
      const g = window.__g; const ray = r => g.remoteHit({ x: r.pos.x + 6, y: r.pos.y + 1.2, z: r.pos.z }, { x: -1, y: 0, z: 0 }, 7);
      const now = performance.now();
      const ally = [...g.remotes.values()].find(r => r.team === g.me.team && r.alive && r.hasPos);
      const foe = [...g.remotes.values()].find(r => r.team !== g.me.team && r.alive && r.hasPos && r.invUntil < now);
      return { ally: ally ? ray(ally) : 'none', foeHit: foe ? !!ray(foe) : 'none' };
    });
    check(ff.ally === null || ff.ally === 'none', '아군은 조준해도 명중 판정이 나지 않는다', JSON.stringify(ff.ally));

    // ── 미니맵 / 이름표 (팀전) ──
    console.log('\n[미니맵 / 이름표]');
    await page.waitForFunction(() => window.__g.me.alive, null, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 600));
    const mm = await page.evaluate(() => {
      const c = document.getElementById('minimap'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let painted = 0, blue = 0, gold = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) painted++; if (d[i] < 120 && d[i + 2] > 200 && d[i + 3] > 200) blue++; if (d[i] > 240 && d[i + 1] > 160 && d[i + 1] < 200 && d[i + 2] < 90) gold++; }
      return { shown: getComputedStyle(c).display !== 'none', painted, blue, gold, stats: { ...window.__g.minimapStats } };
    });
    check(mm.shown && mm.painted > 5000, '게임 화면에 미니맵이 그려진다', `칠해진 점 ${mm.painted}`);
    check(mm.gold > 20, '내 위치 표시(주황 삼각형)가 가운데에 있다', `gold ${mm.gold}`);
    check(mm.stats.allies >= 1 && mm.blue > 20, '팀전에서는 아군이 파란 점으로 보인다', JSON.stringify(mm.stats));
    const tags = await page.evaluate(() => {
      const g = window.__g;
      return [...g.remotes.values()].map(r => ({ name: r.name, key: r.rig.tagKey, vis: r.rig.bar.visible }));
    });
    check(tags.length === 9 && tags.every(t => t.key.startsWith(t.name + '|')), '모든 상대에게 이름표가 만들어진다 (이름 포함)', JSON.stringify(tags.slice(0, 2)));
    check(tags.filter(t => t.vis).length >= 1, '살아 있는 상대의 이름표가 보인다');
    // 이름표 크기 = 0.75m × clamp(거리/14, 1, 3.4). 각 상대의 실제 거리로 기대값을 계산해 비교한다 (봇은 계속 움직이므로 위치를 고정하지 않는다)
    const sizes = await page.evaluate(() => {
      const g = window.__g;
      return [...g.remotes.values()].filter(r => r.alive && r.hasPos && r.rig.bar.visible).map(r => {
        const d = Math.hypot(r.pos.x - g.me.pos.x, r.pos.y + 1.7 - (g.me.pos.y + 1.6), r.pos.z - g.me.pos.z);
        return { d: +d.toFixed(1), scale: +r.rig.bar.scale.x.toFixed(2), expect: +(0.75 * Math.min(3.4, Math.max(1, d / 14))).toFixed(2) };
      });
    });
    check(sizes.length >= 3 && sizes.every(z => Math.abs(z.scale - z.expect) / z.expect < 0.12), '이름표 크기가 거리에 비례해 커진다 (멀리서도 읽히게)', JSON.stringify(sizes.slice(0, 4)));
    const nearest = sizes.reduce((m, z) => (z.d < m.d ? z : m)), farthest = sizes.reduce((m, z) => (z.d > m.d ? z : m));
    check(farthest.d < 20 || farthest.scale > nearest.scale, '더 먼 상대의 이름표가 더 크다', `${nearest.d}m→${nearest.scale}, ${farthest.d}m→${farthest.scale}`);
    check(await page.evaluate(() => [...window.__g.remotes.values()].every(r => r.rig.bar.center.y === 0)), '이름표는 머리 위에서 위로 자라서 얼굴을 가리지 않는다');
    check(errors.length === 0, '브라우저 오류가 없다', errors.join(' | '));

    await page.close();
    const lobby = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const lerrors = []; lobby.on('pageerror', e => lerrors.push(e.message)); lobby.on('console', m => { if (m.type() === 'error') lerrors.push(m.text()); });
    await lobby.goto(`http://localhost:${srv.port}/?mode=ffa`);
    await lobby.waitForSelector('#modes button');
    const cards = await lobby.evaluate(() => [...document.querySelectorAll('#modes button')].map(b => b.dataset.mode + (b.classList.contains('on') ? '*' : '')));
    check(String(cards) === 'ffa*,tdm', '로비에 모드 카드 2개가 보이고 현재 모드가 선택돼 있다', String(cards));

    // ── 새로고침 없이 모드/맵 전환 ──
    console.log('\n[새로고침 없는 모드 전환]');
    await lobby.evaluate(() => { window.__marker = 'same-page'; });
    const ffaCount = await lobby.evaluate(() => window.__g.colliderCount);
    await lobby.click('#modes button[data-mode="tdm"]');
    await sleep(500);
    const afterTdm = await lobby.evaluate(() => ({ marker: window.__marker, map: window.__g.map, count: window.__g.colliderCount, url: location.href, join: document.getElementById('join').textContent }));
    check(afterTdm.marker === 'same-page' && !afterTdm.url.includes('mode=tdm'), '팀전 카드를 눌러도 페이지가 다시 열리지 않는다');
    check(afterTdm.map === 'warehouse' && afterTdm.count !== ffaCount, '맵이 그 자리에서 창고로 바뀐다', `${ffaCount} → ${afterTdm.count}`);
    check(afterTdm.join.includes('팀 데스매치'), '입장 버튼 문구가 바뀐다');
    await lobby.click('#modes button[data-mode="ffa"]'); await sleep(300);
    check((await lobby.evaluate(() => ({ map: window.__g.map, count: window.__g.colliderCount }))).map === 'frontline', '다시 개인전을 고르면 전선으로 돌아온다 (이전 맵 구조물이 남지 않음)');
    check(await lobby.evaluate(() => window.__g.colliderCount) === ffaCount, '맵을 오가도 충돌 박스 수가 정확히 복원된다');
    await sleep(1200);
    check((await lobby.textContent('#modes button[data-mode="tdm"] .mc')).length > 0, '모드별 접속 인원 문구가 표시된다');

    // ── 친선전: 방 만들기 ──
    console.log('\n[친선전]');
    await lobby.fill('#name', '방장봇');
    await lobby.click('#tabs button[data-tab="custom"]');
    check(await lobby.isVisible('#paneCustom') && !(await lobby.isVisible('#paneQuick')), '친선전 탭이 열린다');
    await lobby.fill('#roomName', '<i>친구들끼리</i>');
    await lobby.click('#createMode button[data-mode="tdm"]');
    await lobby.check('#optPrivate', { force: false }).catch(() => {});
    await lobby.uncheck('#optPrivate');
    await lobby.check('#optBots');
    await lobby.selectOption('#optMinutes', '3');
    await lobby.click('#createBtn');
    await lobby.waitForFunction(() => window.__g.joined, null, { timeout: 8000 });
    await sleep(1500);
    const made = await lobby.evaluate(() => ({
      marker: window.__marker, map: window.__g.map, team: window.__g.me.team, tag: document.getElementById('roomtag').textContent,
      tagShown: getComputedStyle(document.getElementById('roomtag')).display !== 'none', goal: document.getElementById('goal').textContent,
      room: window.__g.game.room, remotes: window.__g.remotes.size, menu: getComputedStyle(document.getElementById('menu')).display,
    }));
    check(made.marker === 'same-page' && made.menu === 'none', '방을 만들어 입장해도 페이지는 그대로다');
    check(made.map === 'warehouse' && (made.team === 0 || made.team === 1) && made.goal.includes('아군'), '팀전 방이라 창고 맵·팀이 적용된다', JSON.stringify({ map: made.map, team: made.team }));
    check(made.room && made.tagShown && made.tag.includes('<i>친구들끼리</i>') && made.tag.includes(made.room.code), '방 이름(글자 그대로)과 코드가 화면에 표시된다', made.tag);
    check(made.remotes === 9, '봇 채우기를 켜서 5 대 5 가 된다', `remotes ${made.remotes}`);  // (제한 시간 옵션은 서버 테스트에서 확인)
    const code = made.room.code;

    // ── 다른 사람이 목록에서 입장 ──
    const guest = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const gerrors = []; guest.on('pageerror', e => gerrors.push(e.message));
    await guest.goto(`http://localhost:${srv.port}/`);
    await guest.fill('#name', '손님봇');
    await guest.click('#tabs button[data-tab="custom"]');
    await guest.waitForSelector('#roomList .roomrow', { timeout: 6000 });
    const row = await guest.evaluate(() => document.querySelector('#roomList .roomrow').textContent);
    check(row.includes('<i>친구들끼리</i>') && row.includes('팀 데스매치') && row.includes(code), '방 목록에 이름·모드·인원·코드가 보인다 (HTML 은 글자 그대로)', row);
    check(await guest.evaluate(() => !document.querySelector('#roomList .roomrow i')), '방 이름의 HTML 태그가 실제 태그로 만들어지지 않는다');
    await guest.click('#roomList .roomrow button');
    await guest.waitForFunction(() => window.__g.joined, null, { timeout: 8000 });
    await sleep(1200);
    const g = await guest.evaluate(() => ({ map: window.__g.map, code: window.__g.game.room && window.__g.game.room.code, n: window.__g.roster.size }));
    check(g.code === code && g.map === 'warehouse' && g.n === 10, '목록의 입장 버튼으로 같은 방에 들어간다 (맵도 따라 바뀜)', JSON.stringify(g));
    await guest.evaluate(() => { document.getElementById('pause').style.display = 'flex'; }); // 일시정지 창이 떠 있는 상태를 재현 (nolock 이 아닌 실제 상황)
    await guest.click('#leave'); // 실제 마우스 클릭 (클릭이 일시정지 창의 "전투로 복귀"로 번지면 안 된다)
    await sleep(500);
    check(await guest.isVisible('#menu') && !(await guest.evaluate(() => window.__g.joined)), '로비로 나가기를 누르면 로비로 돌아온다');
    check(await guest.evaluate(() => document.pointerLockElement === null) && !(await guest.isVisible('#pause')), '나간 뒤 마우스가 게임 화면에 잠기지 않고 일시정지 창도 남지 않는다');
    await guest.fill('#codeIn', code.toLowerCase());
    await guest.click('#codeJoin');
    await guest.waitForFunction(() => window.__g.joined, null, { timeout: 8000 });
    check(await guest.evaluate(() => window.__g.game.room.code) === code, '코드를 직접 입력해서도 같은 방에 다시 들어간다');
    await guest.evaluate(() => document.getElementById('leave').click());
    await guest.click('#tabs button[data-tab="custom"]');
    await guest.fill('#codeIn', 'ZZZZ'); await guest.click('#codeJoin');
    await guest.waitForFunction(() => document.getElementById('msg').textContent.includes('찾을 수 없'), null, { timeout: 5000 }).catch(() => {});
    check((await guest.textContent('#msg')).includes('찾을 수 없'), '없는 코드는 로비에 안내 문구가 나온다');
    check(gerrors.length === 0, '손님 쪽 브라우저 오류가 없다', gerrors.join(' | '));
    await guest.close();

    // ── 방장: 로비로 나가서 다른 모드 빠른 시작 (새로고침 없이) ──
    console.log('\n[로비로 나간 뒤 다른 모드로]');
    await lobby.evaluate(() => document.getElementById('leave').click());
    await sleep(500);
    const left = await lobby.evaluate(() => ({ joined: window.__g.joined, menu: getComputedStyle(document.getElementById('menu')).display, remotes: window.__g.remotes.size, hud: document.getElementById('hud').classList.contains('on'), tag: getComputedStyle(document.getElementById('roomtag')).display, chat: document.getElementById('chatLog').children.length }));
    check(!left.joined && left.menu !== 'none' && left.remotes === 0 && !left.hud && left.tag === 'none', '나가면 로비가 보이고 방의 상태(다른 플레이어·HUD·방 표시)가 정리된다', JSON.stringify(left));
    await lobby.click('#tabs button[data-tab="quick"]');
    await lobby.click('#modes button[data-mode="ffa"]');
    await lobby.click('#join');
    await lobby.waitForFunction(() => window.__g.joined, null, { timeout: 8000 });
    await sleep(1500);
    const again = await lobby.evaluate(() => ({ marker: window.__marker, map: window.__g.map, team: window.__g.me.team, room: window.__g.game.room, remotes: window.__g.remotes.size, goal: document.getElementById('goal').textContent }));
    check(again.marker === 'same-page' && again.map === 'frontline' && again.team === -1 && again.room === null && again.remotes === 5, '같은 페이지에서 개인전으로 다시 입장한다 (전선 맵, 팀 없음, 봇 5명)', JSON.stringify(again));
    check(again.goal.includes('킬 선승') && !again.goal.includes('아군'), '개인전 표시(팀 점수 없음)로 돌아온다', again.goal);
    check(lerrors.length === 0, '방장 쪽 브라우저 오류가 없다', lerrors.join(' | '));
    await lobby.close();
  }
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  await browser.close();
  servers.forEach(s => s.stop());
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
