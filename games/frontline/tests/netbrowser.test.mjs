// 실제 Chrome 으로 네트워크 장애 속 동작 확인 (약 1분): 장애 재현 프록시를 사이에 두고 게임에 접속해
//   RTT·수신 간격 측정(F3), 원격 플레이어(서버 AI 봇) 튐, 내 위치 보정, 보간 버퍼를 `window.__g.netdiag` 로 읽는다.
// Chrome 경로가 다르면 CHROME_PATH 환경변수로 지정한다.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, check, failed, sleep } from './helpers.mjs';
import { createProxy } from '../tools/netsim/proxy.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) { console.log(`Chrome 을 찾을 수 없어 건너뜁니다 (${CHROME}).`); process.exit(0); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const servers = [];
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

try {
  const srv = await startServer({ RESPAWN_SECONDS: '1' }); servers.push(srv);
  const proxy = await createProxy({ target: { port: srv.port } });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${srv.port}/?auto=NetTester&nolock&mode=ffa&ws=${proxy.port}`); // 페이지는 서버에서, WebSocket 은 프록시로
  await page.waitForFunction(() => window.__g && window.__g.joined && window.__g.me.alive && window.__g.remotes.size >= 3, null, { timeout: 40000 });
  await sleep(2500);
  const move = () => page.evaluate(() => { const g = window.__g; g.teleport(48.7, 0, -20, Math.PI); g.input({ key: 'KeyW' }); g.input({ key: 'ShiftLeft' }); });
  const measure = async (label, profile, secs) => {
    proxy.setProfile(profile);
    await sleep(3500); // 장애 속에서 시계가 적응할 시간
    await page.evaluate(() => window.__g.netdiag.reset());
    await move();
    await sleep(secs * 1000);
    const s = await page.evaluate(() => window.__g.netdiag.summary());
    await page.evaluate(() => { window.__g.input({ keyUp: 'KeyW' }); window.__g.input({ keyUp: 'ShiftLeft' }); });
    console.log(`  ${label}: RTT ${f(s.rtt.avg, 0)}±${f(s.rtt.jitter, 0)}ms · 스냅샷 ${f(s.snap.avg)}ms ±${f(s.snap.jitter)} 최대 ${f(s.snap.maxGap, 0)} · 버퍼 ${f(s.buffer.ms, 0)}ms · 예측 ${f(s.remote.underPct)}% · 원격 튐 ${s.remote.jumps} (최대 ${f(s.remote.maxStep, 2)}m/프레임) · 내 보정 ${s.correction.n}회 최대 ${f(s.correction.max, 2)}m · FPS ${f(s.fps.avg, 0)} · 수신 ${f(s.rate.kbps)}KB/s`);
    return s;
  };

  console.log('[네트워크 진단 · 실제 브라우저]');
  const calm = await measure('양호 30ms   ', { rtt: 30, jitter: 3, loss: 0 }, 12);
  check(calm.rtt.avg > 20 && calm.rtt.avg < 70, `RTT 를 측정한다 (${f(calm.rtt.avg, 0)}ms, 설정 30ms)`);
  check(calm.snap.avg > 28 && calm.snap.avg < 40, `스냅샷이 약 30Hz 로 온다 (${f(calm.snap.avg)}ms)`);
  check(calm.remote.jumps === 0, `양호한 네트워크에서는 원격 플레이어가 튀지 않는다 (${calm.remote.jumps}회)`);
  check(calm.correction.max < 0.3, `내 위치 보정이 작다 (최대 ${f(calm.correction.max, 2)}m)`);
  const bad = await measure('불안정 100ms 1%', { rtt: 100, jitter: 20, loss: 0.01 }, 20);
  check(bad.rtt.avg > 80 && bad.snap.maxGap > calm.snap.maxGap, `손실 환경이 실제로 걸렸다 (RTT ${f(bad.rtt.avg, 0)}ms, 최대 수신 간격 ${f(bad.snap.maxGap, 0)}ms)`);
  check(bad.remote.jumps <= 2, `불안정(1% 손실)에서도 원격 플레이어 튐이 거의 없다 (${bad.remote.jumps}회)`);
  check(bad.buffer.ms < 260, `보간 버퍼가 상한 안이다 (${f(bad.buffer.ms, 0)}ms)`);
  check(bad.correction.max < 1.5, `내 위치 보정이 크지 않다 (최대 ${f(bad.correction.max, 2)}m)`);

  await page.keyboard.press('F3'); await sleep(600);
  check(await page.isVisible('#netdiag') && (await page.textContent('#netdiag')).includes('RTT'), 'F3 = 네트워크 진단 화면');
  await page.screenshot({ path: 'tests/.last-netbrowser.png' });
  check(errors.length === 0, '화면 오류 없음', errors.slice(0, 3).join(' | '));
  proxy.close();
} catch (e) {
  console.error(e); check(false, '예외', e.message);
} finally {
  await browser.close();
  for (const s of servers) s.stop();
}
process.exit(failed() ? 1 : 0);
