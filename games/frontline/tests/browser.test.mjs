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
    check(errors.length === 0, '브라우저 오류가 없다', errors.join(' | '));

    // 로비: 접속 전 화면에서 모드 카드가 보이고, 다른 모드를 누르면 그 모드로 다시 열린다
    const lobby = await browser.newPage({ viewport: { width: 1000, height: 640 } });
    await lobby.goto(`http://localhost:${srv.port}/?mode=ffa`);
    await lobby.waitForSelector('#modes button');
    const cards = await lobby.evaluate(() => [...document.querySelectorAll('#modes button')].map(b => b.dataset.mode + (b.classList.contains('on') ? '*' : '')));
    check(String(cards) === 'ffa*,tdm', '로비에 모드 카드 2개가 보이고 현재 모드가 선택돼 있다', String(cards));
    await sleep(1200);
    check((await lobby.textContent('#modes button[data-mode="tdm"] .mc')).includes('1명'), '모드별 접속 인원이 표시된다');
    await lobby.click('#modes button[data-mode="tdm"]'); await lobby.waitForLoadState('load'); await lobby.waitForSelector('#modes button.on');
    check(lobby.url().includes('mode=tdm') && (await lobby.textContent('#join')).includes('팀 데스매치'), '팀전 카드를 누르면 팀전 로비로 바뀐다');
    await lobby.close(); await page.close();
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
