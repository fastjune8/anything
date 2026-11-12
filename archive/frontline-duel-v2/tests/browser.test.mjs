// 브라우저 스모크 테스트: 실제 Chrome 으로 접속해서 화면 로직에 오류가 없는지 확인
// Chrome 경로가 다르면 CHROME_PATH 환경변수로 지정한다.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, check, failed, sleep } from './helpers.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log(`Chrome 을 찾을 수 없어 브라우저 테스트를 건너뜁니다 (${CHROME}). CHROME_PATH 로 지정하세요.`);
  process.exit(0);
}

const srv = await startServer({ MATCH_SECONDS: '60', GOAL: '999' });
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://localhost:${srv.port}/?auto=Tester&nolock`);
  await page.waitForFunction(() => window.__g && window.__g.me.id >= 0, null, { timeout: 15000 });
  await sleep(4000);

  const snap = await page.evaluate(() => ({
    state: window.__g.state, hp: window.__g.me.hp,
    remotes: window.__g.remotes.size, roster: window.__g.roster.size,
    timer: document.getElementById('timer').textContent,
    lbRows: document.querySelectorAll('#lb > div').length,
    env: document.getElementById('envtag').textContent,
    menuHidden: getComputedStyle(document.getElementById('menu')).display === 'none',
  }));
  console.log('화면 상태:', JSON.stringify(snap));
  check(snap.menuHidden, '접속하면 메뉴가 닫히고 게임 화면이 열린다');
  check(snap.state === 'playing', '경기가 진행 중이다');
  check(snap.remotes === 5 && snap.roster === 6, '봇 5명이 화면에 배정된다', `remotes=${snap.remotes}, roster=${snap.roster}`);
  check(/^\d:\d\d$/.test(snap.timer), '남은 시간이 표시된다', snap.timer);
  check(snap.lbRows >= 5, '순위표가 그려진다', `${snap.lbRows}줄`);
  check(snap.env.startsWith('TEST'), '라이브가 아닌 서버에는 환경 표시가 붙는다', snap.env);

  // 가만히 있어도 봇이 서로 싸워 킬 피드/순위가 갱신되는지
  await sleep(8000);
  const later = await page.evaluate(() => ({
    kills: [...window.__g.roster.values()].reduce((n, p) => n + p.k, 0),
    visible: [...window.__g.remotes.values()].filter(r => r.hasPos).length,
  }));
  check(later.visible >= 4, '봇 모델에 위치가 반영된다', `${later.visible}명`);
  check(later.kills >= 1, '봇들의 킬이 순위표에 반영된다', `총 ${later.kills}킬`);
  check(errors.length === 0, '브라우저 오류가 없다', errors.join(' | '));
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
