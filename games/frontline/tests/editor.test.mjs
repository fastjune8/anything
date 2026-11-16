// 맵 에디터 테스트: 열기 → 새 맵 → 마우스로 물체 놓기 → 검사 → 저장 → 서버/게임에서 그 맵으로 플레이. 라이브(prod)에서는 꺼져 있는지도 확인.
// 저장은 실제 content/maps 에 쓰므로, 끝나면 만든 파일과 목록을 원래대로 되돌린다.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, connect, check, failed, ROOT } from './helpers.mjs';
import { checkMap } from '../shared/content/schema.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAPS = path.join(ROOT, 'content', 'maps'), INDEX = path.join(MAPS, 'index.json');
const TEST_ID = 'zz_editor_test';
const indexBefore = fs.readFileSync(INDEX, 'utf8');
const cleanup = () => { fs.writeFileSync(INDEX, indexBefore); fs.rmSync(path.join(MAPS, `${TEST_ID}.json`), { force: true }); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const servers = [];
let exitCode = 0;
try {
  const srv = await startServer({ BOT_FILL: '0' }); servers.push(srv);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('[열기]');
  await page.goto(`http://localhost:${srv.port}/editor/?map=warehouse`);
  await page.waitForFunction(() => window.__ed && window.__ed.map, null, { timeout: 20000 });
  const opened = await page.evaluate(() => ({ id: window.__ed.map.id, n: window.__ed.map.objects.length, dirty: window.__ed.isDirty(), list: [...document.querySelectorAll('#mapSel option')].map(o => o.value), pal: document.querySelectorAll('#palette button').length }));
  check(opened.id === 'warehouse' && opened.n > 50 && !opened.dirty, '맵을 열면 물체 목록이 보이고, 고친 것이 없는 상태', JSON.stringify(opened));
  check(opened.list.includes('frontline') && opened.pal >= 14, '맵 목록과 물체·스폰·거점 도구가 보인다', JSON.stringify(opened));

  console.log('\n[물체 고르기 / 속성]');
  const bi = await page.evaluate(() => window.__ed.map.objects.findIndex(o => o.type === 'building'));
  await page.evaluate(i => window.__ed.select({ kind: 'obj', i }), bi);
  const fields = await page.evaluate(() => [...document.querySelectorAll('#props .lbl')].map(l => l.textContent));
  check(fields.some(f => f.startsWith('너비')) && fields.some(f => f.includes('북쪽 벽')), '건물을 고르면 스키마대로 입력 칸이 생긴다 (크기, 벽별 문·창문)', fields.slice(0, 8).join(','));
  await page.fill('#props input[type=number] >> nth=2', '20'); // 너비
  await page.dispatchEvent('#props input[type=number] >> nth=2', 'change');
  const w = await page.evaluate(i => ({ w: window.__ed.map.objects[i].w, dirty: window.__ed.isDirty() }), bi);
  check(w.w === 20 && w.dirty, '칸을 고치면 맵 데이터가 바뀌고 "저장 안 됨" 이 된다', JSON.stringify(w));
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  const back = await page.evaluate(i => ({ w: window.__ed.map.objects[i].w, dirty: window.__ed.isDirty() }), bi);
  check(back.w === 18 && !back.dirty, '되돌리기(⌘Z)로 원래대로', JSON.stringify(back));

  console.log('\n[새 맵 → 마우스로 놓기 → 검사 → 저장]');
  const answers = [TEST_ID, '에디터 시험 맵'];
  page.on('dialog', d => d.accept(answers.shift() ?? ''));
  await page.click('#newMap');
  await page.waitForFunction(id => window.__ed.map.id === id, TEST_ID, { timeout: 5000 });
  await page.click('#palette button[data-tool="obj:crate"]');
  const box = await page.locator('#view').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 40);
  const placed = await page.evaluate(() => { const o = window.__ed.map.objects.at(-1); return { type: o.type, x: o.x, z: o.z, sel: window.__ed.sel }; });
  check(placed.type === 'crate' && placed.sel && placed.sel.kind === 'obj' && Number.isFinite(placed.x) && placed.x % 0.5 === 0, '도구를 고르고 바닥을 클릭하면 그 자리(0.5m 격자)에 놓이고 선택된다', JSON.stringify(placed));
  await page.evaluate(() => window.__ed.moveTo(3, -2));
  const moved = await page.evaluate(() => { const o = window.__ed.map.objects.at(-1); return [o.x, o.z]; });
  check(moved[0] === placed.x + 3 && moved[1] === placed.z - 2, '선택한 물체를 옮길 수 있다', JSON.stringify(moved));

  await page.evaluate(() => { window.__ed.select(null); window.__ed.map.half = 5; window.__ed.rebuildNow(); });
  const bad = await page.evaluate(() => ({ errors: window.__ed.errors.length, saveDisabled: document.getElementById('save').disabled, shown: !document.getElementById('errors').hidden }));
  check(bad.errors > 0 && bad.saveDisabled && bad.shown, '맵 밖 스폰 같은 오류가 있으면 표시되고 저장 버튼이 잠긴다', JSON.stringify(bad));
  await page.evaluate(() => { window.__ed.map.half = 40; window.__ed.rebuildNow(); });

  await page.click('#save');
  await page.waitForFunction(() => !window.__ed.isDirty(), null, { timeout: 5000 });
  const file = path.join(MAPS, `${TEST_ID}.json`);
  const savedDef = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  check(savedDef && checkMap(savedDef).length === 0 && savedDef.objects.some(o => o.type === 'crate'), '저장하면 content/maps 에 검사를 통과하는 JSON 파일이 생긴다');
  check(JSON.parse(fs.readFileSync(INDEX, 'utf8')).includes(TEST_ID), '새 맵은 맵 목록(index.json)에 추가된다');
  check(fs.readFileSync(file, 'utf8').split('\n').filter(l => l.includes('"type"')).length === savedDef.objects.length, '저장 파일은 물체 하나가 한 줄 (git 에서 바뀐 곳이 잘 보인다)');
  const listed = await page.evaluate(() => [...document.querySelectorAll('#mapSel option')].map(o => o.value));
  check(listed.includes(TEST_ID), '에디터 맵 목록에도 새 맵이 보인다');

  console.log('\n[저장한 맵으로 플레이]');
  const c = connect(srv.port, 'tester', { mode: 'zone', create: { name: 'x', private: true, bots: false, minutes: 3, map: TEST_ID } }); await c.open;
  const wel = await c.waitFor('welcome');
  check(wel && wel.map === TEST_ID && wel.mode === 'zone', '서버를 다시 켜지 않아도 저장한 맵으로 방을 만들 수 있다', JSON.stringify(wel && { map: wel.map, mode: wel.mode }));
  c.ws.close();
  const game = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const gerr = []; game.on('pageerror', e => gerr.push(e.message));
  await game.goto(`http://localhost:${srv.port}/?auto=Tester&nolock&mode=zone&map=${TEST_ID}&bots=0`);
  await game.waitForFunction(() => window.__g && window.__g.joined, null, { timeout: 15000 });
  const g = await game.evaluate(() => ({ map: window.__g.map, room: window.__g.game.room, colliders: window.__g.colliderCount }));
  check(g.map === TEST_ID && g.room && g.colliders === 5, '시험 플레이 주소로 열면 그 맵의 비공개 방에 바로 들어간다', JSON.stringify(g));
  check(errors.length === 0 && gerr.length === 0, '브라우저 오류가 없다', [...errors, ...gerr].join(' | '));
  await game.close(); await page.close();

  console.log('\n[라이브(prod)에서는 에디터가 꺼져 있다]');
  const prod = await startServer({ APP_ENV: 'prod' }); servers.push(prod);
  const ed = await fetch(`http://localhost:${prod.port}/editor/`);
  const api = await fetch(`http://localhost:${prod.port}/api/maps/${TEST_ID}`, { method: 'PUT', body: '{}' });
  check(ed.status === 404 && api.status === 404, '에디터 페이지와 저장 API 가 없다', `${ed.status} ${api.status}`);
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  cleanup();
  for (const s of servers) s.stop();
  await browser.close();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
