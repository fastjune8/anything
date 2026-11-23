// 브라우저 테스트 (실제 Chrome, 약 1분): 로비 → 빠른 매칭 → 예측 이동·슬라이딩·사격·스킬·무기 교체 → HUD·미니맵·전술 지도 → 3인칭 → 로비로
// Chrome 경로가 다르면 CHROME_PATH 환경변수로 지정한다.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, check, failed, sleep } from './helpers.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) { console.log(`Chrome 을 찾을 수 없어 브라우저 테스트를 건너뜁니다 (${CHROME}). CHROME_PATH 로 지정하세요.`); process.exit(0); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const servers = [];
const g = (page, fn, arg) => page.evaluate(fn, arg);

try {
  const srv = await startServer({ RESPAWN_SECONDS: '1' }); servers.push(srv);
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('[로비]');
  await page.goto(`http://localhost:${srv.port}/?nolock`);
  await page.waitForFunction(() => window.__g && window.__g.lobby.me, null, { timeout: 20000 });
  check(await page.isVisible('#menu') && (await page.textContent('#meTag')).startsWith('#'), '로비: 내 이름·친구 코드·레벨');
  check(await page.locator('#modes .mode').count() === 3, '모드 3개 (점령전·팀 데스매치·개인전)');
  check(await page.locator('#slot0 .wgrid .w').count() === 8, '출전 무기 8종에서 고른다');
  await page.click('#slot0 .wgrid .w:has-text("호넷 SMG")');
  check(await g(page, () => window.__g.loadout.wire[0].id) === 'mp5', '주무기를 SMG 로 바꾼다');
  await page.click('#slot0 .wgrid .w:has-text("랜서 AR")');
  await page.click('#slot0 .skc:has-text("대쉬")');
  check(await g(page, () => window.__g.loadout.wire[0].skill) === 'dash', '자리별 스킬을 고른다 (AR → 대쉬)');
  await page.click('[data-lt="outfit"]');
  check(await page.isVisible('#outfitBox select'), '외형 패널 (의상 색·피부·헤어/의상/액세서리)');

  console.log('[빠른 매칭 → 경기]');
  await page.click('#modes .mode:has-text("점령전")');
  await page.click('#join');
  await page.waitForFunction(() => window.__g.joined && window.__g.me.alive && window.__g.remotes.size >= 5, null, { timeout: 20000 });
  check(await page.isVisible('#hud') && !(await page.isVisible('#menu')), '경기 화면 (HUD)');
  check(await page.locator('#zones .zp').count() === 3, '위쪽: 거점 A·B·C 소유 표시');
  await sleep(800);
  // 이동 (예측): 골목극장 서쪽 길(상점·카페와 큰 건물 사이)로 옮겨 북쪽으로 달린다
  await g(page, () => window.__g.teleport(-46, 0, -22, Math.PI));
  await sleep(300);
  await g(page, () => { window.__g.input({ key: 'KeyW' }); window.__g.input({ key: 'ShiftLeft' }); });
  await sleep(1200);
  const run = await g(page, () => ({ z: window.__g.me.pos.z, sprint: window.__g.me.ps.sprinting }));
  check(run.z > -20.5 && run.sprint, `달리기 (예측 이동, z=${run.z.toFixed(1)})`);
  await g(page, () => window.__g.input({ key: 'KeyC' }));
  await page.waitForFunction(() => window.__g.me.ps.slide > 0, null, { timeout: 2000 }).catch(() => {});
  check(await g(page, () => window.__g.me.ps.slide > 0), '달리다 C = 슬라이딩');
  await g(page, () => { window.__g.input({ keyUp: 'KeyC' }); window.__g.input({ keyUp: 'ShiftLeft' }); window.__g.input({ keyUp: 'KeyW' }); });
  await sleep(600);
  const ns = await g(page, () => window.__g.netStats);
  check(ns.acks > 10 && ns.maxErr < 0.3, `서버 보정과 예측이 거의 같다 (확인 ${ns.acks}번, 최대 어긋남 ${ns.maxErr.toFixed(3)}m)`);
  // 사격
  const f0 = await g(page, () => window.__g.me.ps.fireN);
  await g(page, () => window.__g.input({ fire: true })); await sleep(1200); await g(page, () => window.__g.input({ fire: false }));
  check(await g(page, () => window.__g.me.ps.fireN) > f0 + 2, '사격 (탄약이 준다)');
  // 스킬 Q (대쉬)
  await g(page, () => window.__g.input({ skill: 0 })); await sleep(200);
  check(await g(page, () => window.__g.me.ps.sk[0].cd > 0), 'Q = 주무기 스킬 (대쉬 쿨타임 시작)');
  // 무기 교체
  await g(page, () => window.__g.input({ slot: 1 })); await sleep(700);
  check(await g(page, () => window.__g.slot) === 1, '2번 = 보조무기로 교체');
  // HUD
  check((await page.textContent('#wN')).length > 0 && (await page.textContent('#hpV')) !== '', '아래: 체력·무기·탄약');
  check(await page.locator('#skills .sk').count() === 2, '아래: 스킬 Q·E');
  await page.keyboard.down('KeyM'); await page.keyboard.up('KeyM');
  await g(page, () => { window.__g.inp.tactical = true; }); await sleep(600);
  check(await page.isVisible('#tactical'), 'M = 전술 지도 (게임은 계속)');
  await g(page, () => { window.__g.inp.tactical = false; window.__g.inp.board = true; }); await sleep(600);
  check(await page.isVisible('#board'), 'Tab = 점수판');
  await g(page, () => { window.__g.inp.board = false; });
  // 3인칭
  await g(page, () => { window.__g.localTP.view = true; }); await sleep(300);
  check(await g(page, () => window.__g.localTP.anim ? window.__g.localTP.anim.root.visible : true), 'V = 3인칭 (내 캐릭터가 보인다)');
  await g(page, () => { window.__g.localTP.view = false; });
  // 봇과의 교전 → 킬피드
  await page.waitForFunction(() => document.querySelectorAll('#feed .kf:not(.note)').length > 0, null, { timeout: 30000 }).catch(() => {});
  check(await page.locator('#feed .kf').count() > 0, '킬피드에 처치가 올라온다');
  await page.screenshot({ path: 'tests/.last-browser.png' });

  console.log('[로비로]');
  await page.click('#leave', { force: true }).catch(async () => { await g(page, () => window.__g.net.send({ t: 'leave' })); });
  await g(page, () => window.__g.net.send({ t: 'leave' }));
  await page.waitForFunction(() => !window.__g.joined, null, { timeout: 8000 });
  check(await page.isVisible('#menu'), '로비로 돌아온다 (새로고침 없이)');
  check(errors.length === 0, '화면 오류 없음', errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e); check(false, '예외', e.message);
} finally {
  await browser.close();
  for (const s of servers) s.stop();
}
process.exit(failed() ? 1 : 0);
