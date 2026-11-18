// FRONTIER Studio 테스트 (실제 Chrome)
//  - 첫 실행 튜토리얼(건너뛰기·다시 안 나옴), 홈(데이터 종류·카드·자세히·연결), 도움말(F1)
//  - 맵: 열기 → 속성 고치기·되돌리기 → 카메라·단축키 → 새 맵 → 마우스로 놓기 → 검사 → 저장 → 화면 안 시험 플레이(저장 안 한 내용 그대로)
//  - 총 모델: 예시 총 검사·1인칭·정조준·파츠·스킨 → 규칙을 어긴 모델 → 프로젝트에 저장
//  - 게임 데이터: 무기 비교 표가 고치는 대로 다시 계산 · 모드 저장
//  - 라이브(prod)에서는 스튜디오가 꺼져 있다
// 저장은 실제 content/ 에 쓰므로, 끝나면 만든 파일과 바꾼 파일을 원래대로 되돌린다.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, connect, check, failed, ROOT, W } from './helpers.mjs';
import { checkMap } from '../shared/content/schema.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log(`Chrome 을 찾을 수 없어 브라우저 테스트를 건너뜁니다 (${CHROME}). CHROME_PATH 로 지정하세요.`);
  process.exit(process.env.REQUIRE_CHROME ? 1 : 0);
}
const C = (...p) => path.join(ROOT, 'content', ...p);
const TEST_ID = 'zz_studio_test', GUN_ID = 'zz_gun_test';
const keep = [C('maps', 'index.json'), C('guns', 'index.json'), C('modes.json'), C('models.json'), C('weapons.json'), C('prefabs.json'), C('looks.json'), C('skills.json'), C('effects.json'), C('characters', 'index.json')].map(f => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]);
const cleanup = () => {
  for (const [f, text] of keep) { if (text === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, text); }
  fs.rmSync(C('maps', `${TEST_ID}.json`), { force: true }); fs.rmSync(C('guns', `${GUN_ID}.glb`), { force: true }); fs.rmSync(C('characters', 'zz_test_char.glb'), { force: true });
};
// 지금 화면에 나와 있는 문서의 조각 (탭을 바꾸면 다른 문서의 조각은 숨는다)
const ACT = { bar: '#edBar > div:not([hidden])', tools: '#toolbox > div:not([hidden])', over: '#overlays > div:not([hidden])', insp: '#inspector > div:not([hidden])' };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const servers = [];
let exitCode = 0;
try {
  const srv = await startServer({ BOT_FILL: '0' }); servers.push(srv);
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const answers = [];
  page.on('dialog', d => d.accept(answers.shift() ?? ''));

  console.log('[첫 실행 튜토리얼]');
  await page.goto(`http://localhost:${srv.port}/editor/`); // 예전 에디터 주소도 스튜디오로 간다
  await page.waitForFunction(() => window.__studio && window.__studio.home.data.maps.length, null, { timeout: 60000 });
  await page.waitForSelector('#tour:not([hidden])', { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector('#tourTip h3') || {}).textContent, null, { timeout: 5000 });
  const t1 = await page.textContent('#tourTip');
  await page.click('#tourTip [data-a="next"]');
  await page.waitForFunction(() => document.querySelector('#tourTip h3').textContent === '홈', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400); // 밝히는 상자가 제자리로 움직이는 동안 (0.25초)
  const t2 = await page.evaluate(() => ({ tip: document.querySelector('#tourTip h3').textContent, hole: document.getElementById('tourHole').getBoundingClientRect().width }));
  check(t1.includes('환영') && t2.tip === '홈' && t2.hole > 20, '처음 켜면 튜토리얼이 나오고, 단계마다 화면의 한 부분을 밝혀 설명한다', JSON.stringify(t2));
  await page.click('#tourTip [data-a="skip"]');
  check(await page.locator('#tour').isHidden(), '건너뛰기로 바로 끝낼 수 있다');
  await page.reload();
  await page.waitForFunction(() => window.__studio && window.__studio.home.data.maps.length, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  check(await page.locator('#tour').isHidden() && page.url().includes('/studio/'), '한 번 보거나 건너뛰면 다시 나오지 않는다 (/editor/ → /studio/)');

  console.log('\n[홈: 데이터를 한눈에]');
  const shell = await page.evaluate(() => ({
    home: !document.getElementById('home').hidden, tabs: document.querySelectorAll('.tab').length,
    cats: [...document.querySelectorAll('[data-cat]')].map(c => c.dataset.cat), cards: [...document.querySelectorAll('#homeCards [data-asset]')].map(c => c.dataset.asset),
  }));
  check(shell.home && shell.tabs === 1, '처음엔 홈 탭 하나', JSON.stringify(shell));
  check(['maps', 'models', 'weapons', 'parts', 'modes', 'effects'].every(c => shell.cats.includes(c)) && shell.cards.includes('map:frontline') && shell.cards.includes('map:warehouse'), '종류(맵·모델·무기·파츠·모드·효과)와 맵 카드가 보인다', JSON.stringify(shell));
  await page.click('[data-asset="map:warehouse"]');
  const det = await page.evaluate(() => ({ title: document.querySelector('#homeDetail h2').textContent, rel: [...document.querySelectorAll('#homeDetail .rel button')].map(b => b.textContent), thumb: !!document.querySelector('#homeDetail .big canvas') }));
  check(det.title === '창고' && det.thumb && det.rel.some(r => r.includes('점령전')), '카드를 누르면 자세히(미리보기·정보·이 맵을 쓰는 모드)가 나온다', JSON.stringify(det));
  await page.click('[data-cat="effects"]');
  check((await page.textContent('#homeCards')).includes('유탄 폭발'), '효과 종류에 효과 카드가 있다 (효과 에디터)');
  await page.click('[data-cat="maps"]');
  await page.dblclick('[data-asset="map:frontline"]');
  await page.waitForFunction(() => window.__ed && window.__ed.map && window.__ed.map.id === 'frontline' && !document.getElementById('editor').hidden, null, { timeout: 30000 });
  const ed = await page.evaluate(() => ({ kind: document.getElementById('edKind').textContent, tabs: document.querySelectorAll('.tab').length }));
  check(ed.kind.includes('맵 에디터') && ed.tabs === 2, '카드를 두 번 누르면 맞는 편집기(맵 에디터)가 탭으로 열린다', JSON.stringify(ed));

  console.log('\n[도움말]');
  await page.keyboard.press('F1');
  const hp = await page.evaluate(() => ({ open: !document.getElementById('help').hidden, tab: document.querySelector('#helpTabs .on').textContent, body: document.getElementById('helpBody').textContent }));
  check(hp.open && hp.tab === '맵 에디터' && hp.body.includes('비행') && hp.body.includes('복사'), 'F1 을 누르면 지금 편집기의 사용법·단축키가 열린다', JSON.stringify({ open: hp.open, tab: hp.tab }));
  await page.keyboard.press('Escape');
  check(await page.locator('#help').isHidden(), 'Esc 로 닫힌다');

  console.log('\n[맵: 속성 고치기 / 되돌리기]');
  await page.click('.tab.home'); await page.dblclick('[data-asset="map:warehouse"]');
  await page.waitForFunction(() => window.__ed.map.id === 'warehouse', null, { timeout: 20000 });
  const bi = await page.evaluate(() => window.__ed.map.objects.findIndex(o => o.type === 'building'));
  await page.evaluate(i => window.__ed.select({ kind: 'obj', i }), bi);
  const fields = await page.evaluate(s => [...document.querySelectorAll(`${s} .lbl`)].map(l => l.textContent), ACT.insp);
  check(fields.some(f => f.startsWith('너비')) && fields.some(f => f.includes('북쪽 벽')), '건물을 고르면 스키마대로 입력 칸이 생긴다', fields.slice(0, 8).join(','));
  await page.fill(`${ACT.insp} input[type=number] >> nth=2`, '20');
  await page.dispatchEvent(`${ACT.insp} input[type=number] >> nth=2`, 'change');
  const w = await page.evaluate(i => ({ w: window.__ed.map.objects[i].w, dirty: window.__ed.isDirty(), tab: document.querySelector('.tab.active').textContent }), bi);
  check(w.w === 20 && w.dirty && w.tab.includes('●') && await page.locator('#unsaved').isVisible(), '칸을 고치면 맵이 바뀌고 탭에 ●, 위쪽에 "저장 안 됨" 이 붙는다', JSON.stringify(w));
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  const back = await page.evaluate(i => ({ w: window.__ed.map.objects[i].w, dirty: window.__ed.isDirty() }), bi);
  check(back.w === 18 && !back.dirty, '되돌리기(⌘Z)로 원래대로', JSON.stringify(back));

  console.log('\n[맵: 카메라와 단축키]');
  const box = await page.locator('#view').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const cam = () => page.evaluate(() => { const { camera: c, controls: o } = window.__ed; return { y: c.position.y, tx: o.target.x, tz: o.target.z, ang: Math.atan2(c.position.x - o.target.x, c.position.z - o.target.z) }; });
  const c0 = await cam();
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  const c1 = await cam();
  check(c1.tz < c0.tz - 1, 'W 를 누르고 있으면 카메라가 앞으로 간다', `${c0.tz.toFixed(1)} → ${c1.tz.toFixed(1)}`);
  await page.keyboard.down('e'); await page.waitForTimeout(400); await page.keyboard.up('e');
  const c2 = await cam();
  check(Math.abs(c2.ang - c1.ang) > 0.2, 'E 를 누르면 시점이 돈다');
  await page.mouse.down({ button: 'right' }); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.keyboard.down('e'); await page.waitForTimeout(300); await page.keyboard.up('e'); await page.mouse.up({ button: 'right' });
  check((await cam()).y > c2.y + 1, '오른쪽 버튼을 누른 채 E = 위로 날아오른다 (비행)');
  await page.keyboard.press('Home');
  const c4 = await cam();
  check(Math.abs(c4.tx) < 0.01 && Math.abs(c4.tz) < 0.01, 'Home = 맵 전체 보기');

  console.log('\n[새 맵 → 마우스로 놓기 → 검사 → 저장]');
  answers.push(TEST_ID, '스튜디오 시험 맵');
  await page.click('.tab.home'); await page.click('[data-cat="maps"]'); await page.click('#newMapBtn');
  await page.waitForFunction(id => window.__ed.map.id === id, TEST_ID, { timeout: 8000 });
  await page.click(`${ACT.tools} .tbx-h:has-text("엄폐물")`); // 하나씩 놓는 물체 묶음은 접혀 있다
  await page.click(`${ACT.tools} .tile[data-tool="obj:crate"]`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 40);
  const placed = await page.evaluate(() => { const o = window.__ed.map.objects.at(-1); return { type: o.type, x: o.x, z: o.z, sel: window.__ed.sel }; });
  check(placed.type === 'crate' && placed.sel && placed.x % 0.5 === 0, '도구를 고르고 바닥을 클릭하면 그 자리(0.5m 격자)에 놓인다', JSON.stringify(placed));
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => { const o = window.__ed.map.objects.at(-1); return [o.x, o.z]; });
  check(Math.abs(after[0] - placed.x) + Math.abs(after[1] - placed.z) === 0.5, '방향키로 한 칸(0.5m) 옮긴다', `${[placed.x, placed.z]} → ${after}`);
  await page.keyboard.press('ControlOrMeta+c');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.keyboard.press('ControlOrMeta+v');
  check(await page.evaluate(() => window.__ed.map.objects.filter(o => o.type === 'crate').length) === 2, '⌘C / ⌘V 로 마우스 위치에 붙여넣는다');

  await page.evaluate(() => { window.__ed.select(null); window.__ed.map.half = 5; window.__ed.rebuildNow(); });
  const bad = await page.evaluate(a => ({ n: window.__ed.errors.length, save: document.querySelector(`${a.bar} [data-r="save"]`).disabled, shown: !document.querySelector(`${a.over} .errors`).hidden }), ACT);
  check(bad.n > 0 && bad.save && bad.shown, '맵 밖 스폰 같은 오류가 있으면 표시되고 저장이 잠긴다', JSON.stringify(bad));
  await page.evaluate(() => { window.__ed.map.half = 40; window.__ed.rebuildNow(); });
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !window.__ed.isDirty(), null, { timeout: 8000 });
  const saved = JSON.parse(fs.readFileSync(C('maps', `${TEST_ID}.json`), 'utf8'));
  check(checkMap(saved).length === 0 && saved.objects.filter(o => o.type === 'crate').length === 2, '⌘S 로 저장하면 content/maps 에 검사를 통과하는 파일이 생긴다');
  const inHome = await page.waitForFunction(id => window.__studio.home.data.maps.some(m => m.id === id), TEST_ID, { timeout: 8000 }).then(() => true).catch(() => false); // 저장 뒤 홈이 목록을 다시 읽는 동안
  check(JSON.parse(fs.readFileSync(C('maps', 'index.json'), 'utf8')).includes(TEST_ID) && inHome, '새 맵이 맵 목록(index.json)과 홈에 들어간다');
  const c = connect(srv.port, 'tester', { mode: 'zone', create: { name: 'x', private: true, bots: false, minutes: 3, map: TEST_ID } }); await c.open;
  const wel = await c.waitFor('welcome');
  check(wel && wel.map === TEST_ID, '서버를 다시 켜지 않아도 저장한 맵으로 방을 만들 수 있다');
  c.ws.close();

  console.log('\n[화면 안 시험 플레이 (저장하지 않은 내용 그대로)]');
  await page.evaluate(() => { window.__ed.place && window.__ed.setTool({ kind: 'obj', type: 'box' }); window.__ed.place(5, 5); }); // 저장하지 않은 박스 하나
  const boxes = await page.evaluate(() => window.__ed.map.objects.length);
  await page.keyboard.press('ControlOrMeta+p');
  await page.waitForFunction(() => window.__studio.isPlaying(), null, { timeout: 5000 });
  const frame = page.frameLocator('#playFrame');
  await frame.locator('body').waitFor({ timeout: 20000 });
  const fr = page.frames().find(f => f.url().includes('draft='));
  await fr.waitForFunction(() => window.__g && window.__g.joined, null, { timeout: 60000 });
  const inGame = await fr.evaluate(() => ({ map: window.__g.map, room: window.__g.game.room, colliders: window.__g.colliderCount }));
  check(inGame.map === `draft_${TEST_ID}` && inGame.room && inGame.colliders === boxes, '⌘P 를 누르면 화면 안에서 게임이 열리고, 저장하지 않은 물체까지 그대로 있다', JSON.stringify({ ...inGame, boxes }));
  await page.click('#playStop');
  check(!(await page.evaluate(() => window.__studio.isPlaying())) && await page.locator('#play').isHidden(), '■ 멈춤으로 스튜디오로 돌아온다');

  console.log('\n[맵: 그리기 도구 · 여러 개 선택 · 프리팹]');
  await page.keyboard.press('KeyT'); await page.waitForTimeout(300); // 위에서 보기
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const dragTo = async (a, b2) => { await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b2, { steps: 8 }); await page.mouse.up(); };
  const count = () => page.evaluate(() => window.__ed.map.objects.length);
  let n0 = await count();
  await page.fill(`${ACT.tools} [data-b="wallH"]`, '3.5'); await page.selectOption(`${ACT.tools} [data-b="mat"]`, 'brick');
  await page.click(`${ACT.tools} .tile[data-tool="draw:wall"]`);
  await dragTo(at(0.3, 0.35), at(0.6, 0.37));
  const w1 = await page.evaluate(() => window.__ed.map.objects.at(-1));
  check(w1.type === 'wall' && w1.axis === 'x' && w1.to - w1.from > 5 && w1.h === 3.5 && w1.mat === 'brick', '벽 도구로 바닥을 끌면 곧은 벽이 생기고, 그리기 설정(높이·재질)이 들어간다', JSON.stringify(w1));
  await dragTo(at(0.6, 0.35), at(0.6, 0.6));
  const w2 = await page.evaluate(() => window.__ed.map.objects.at(-1));
  check(w2.axis === 'z' && Math.abs(w2.at - w1.to) < 0.01 && Math.abs(Math.min(w2.from, w2.to) - w1.at) < 0.01, '앞 벽 끝에서 시작하면 이어진다 (ㄱ자)', JSON.stringify({ w1: [w1.to, w1.at], w2: [w2.at, w2.from, w2.to] }));
  await page.click(`${ACT.tools} .tile[data-tool="draw:box"]`);
  await dragTo(at(0.35, 0.45), at(0.45, 0.55));
  const bx = await page.evaluate(() => window.__ed.map.objects.at(-1));
  check(bx.type === 'box' && bx.w > 2 && bx.d > 2, '박스 도구로 끈 크기만큼 박스가 생긴다', JSON.stringify(bx));
  await page.click(`${ACT.tools} .tile[data-tool="scatter"]`);
  const nS = await count();
  await dragTo(at(0.3, 0.7), at(0.65, 0.7));
  check(await count() - nS >= 3, '흩뿌리기: 끈 길을 따라 여러 개가 생긴다', `${(await count()) - nS}개`);
  check(await page.evaluate(() => window.__ed.sel && window.__ed.sel.kind === 'multi'), '흩뿌린 것들이 함께 골라진다');

  await page.click(`${ACT.tools} .tile[data-tool="marquee"]`);
  await dragTo(at(0.28, 0.3), at(0.62, 0.62));
  const ms = await page.evaluate(() => ({ kind: window.__ed.sel && window.__ed.sel.kind, n: window.__ed.sel && window.__ed.sel.list ? window.__ed.sel.list.length : 0 }));
  check(ms.kind === 'multi' && ms.n >= 3, '영역 선택으로 여러 물체를 한 번에 고른다', JSON.stringify(ms));
  const before = await page.evaluate(() => window.__ed.sel.list.map(i => { const o = window.__ed.map.objects[i]; return o.type === 'wall' ? o.at : o.x; }));
  await page.keyboard.press('ArrowRight');
  const afterNudge = await page.evaluate(() => window.__ed.sel.list.map(i => { const o = window.__ed.map.objects[i]; return o.type === 'wall' ? o.at : o.x; }));
  check(afterNudge.some((v, k) => v !== before[k]), '고른 묶음은 방향키로 함께 움직인다');
  await page.keyboard.press('Escape');
  // 프리팹으로 저장 → 찍기
  await page.evaluate(() => window.__ed.selectList(window.__ed.map.objects.map((o, i) => i).slice(-3)));
  await page.click(`${ACT.insp} button:has-text("프리팹으로 저장")`);
  await page.fill('.modal [data-f="id"]', 'zz_test_set'); await page.fill('.modal [data-f="name"]', '시험 묶음');
  await page.click('.modal [data-f="go"]');
  await page.waitForFunction(() => window.__ed.prefabs.some(p => p.id === 'zz_test_set'), null, { timeout: 8000 });
  const pf = JSON.parse(fs.readFileSync(C('prefabs.json'), 'utf8')).find(p => p.id === 'zz_test_set');
  check(pf && pf.objects.length === 3 && !pf.objects.some(o => o.sym), '고른 물체를 프리팹으로 저장하면 content/prefabs.json 에 들어간다 (가운데 기준 좌표)', JSON.stringify(pf && pf.objects.length));
  n0 = await count();
  await page.click(`${ACT.tools} .tile[data-tool="prefab:zz_test_set"]`);
  await page.mouse.click(...at(0.8, 0.8));
  check(await count() === n0 + 3, '팔레트의 프리팹을 고르고 클릭하면 그 자리에 묶음이 찍힌다');
  await page.keyboard.press('ControlOrMeta+z');
  check(await count() === n0, '찍은 것도 ⌘Z 로 한 번에 되돌린다');

  console.log('\n[맵: 높이 — 경사로 · 계단 · 발판 · 작업 높이 · 쌓기]');
  const last = () => page.evaluate(() => window.__ed.map.objects.at(-1));
  await page.fill(`${ACT.tools} [data-b="rise"]`, '3');
  await page.click(`${ACT.tools} .tile[data-tool="draw:ramp"]`);
  await dragTo(at(0.42, 0.62), at(0.46, 0.42));
  const rp = await last();
  check(rp.type === 'ramp' && 'ns'.includes(rp.dir) && rp.len > rp.w && rp.h === 3, '경사로 도구로 끌면 끈 쪽으로 오르는 경사로가 생긴다 (높이 = 오를 높이)', JSON.stringify(rp));
  await page.click(`${ACT.tools} .tile[data-tool="draw:stairs"]`);
  await dragTo(at(0.5, 0.5), at(0.62, 0.52));
  const stp = await last();
  check(stp.type === 'stairs' && 'ew'.includes(stp.dir), '계단 도구: 옆으로 끌면 동/서로 오르는 계단', JSON.stringify(stp));
  await page.click(`${ACT.tools} .tile[data-tool="draw:platform"]`);
  await dragTo(at(0.66, 0.4), at(0.74, 0.5));
  const pl = await last();
  check(pl.type === 'platform' && pl.y === 3 && pl.pillars, '발판 도구: 작업 높이(0) + 오를 높이(3m) 에 기둥 있는 발판', JSON.stringify(pl));
  for (let k = 0; k < 6; k++) await page.keyboard.press('BracketRight');
  check(await page.evaluate(() => window.__ed.brush.level) === 3, '] 를 누르면 작업 높이가 0.5m 씩 올라간다');
  await page.click(`${ACT.tools} .tile[data-tool="draw:box"]`);
  await dragTo(at(0.67, 0.42), at(0.73, 0.48));
  const up = await last();
  check(up.type === 'box' && up.y === 3, '작업 높이 3m 에서 그린 박스는 3m 위(발판 위)에 놓인다', JSON.stringify(up));
  await page.keyboard.press('PageUp');
  check((await last()).y === 3.5, 'PageUp 으로 고른 물체가 0.5m 올라간다');
  await page.keyboard.press('Shift+BracketLeft');
  check(await page.evaluate(() => window.__ed.brush.level) === 0, 'Shift+[ 로 한 층(3m) 내려간다');
  await page.evaluate(() => { window.__ed.brush.stack = true; });
  await page.click(`${ACT.tools} .tile[data-tool="obj:crate"]`);
  await page.mouse.click(...at(0.7, 0.45));
  const cr = await last();
  check(cr.type === 'crate' && Math.abs(cr.y - (3.5 + 1.2)) < 0.05, '물체 위에 쌓기: 상자를 박스 윗면에 올려놓는다', JSON.stringify(cr));
  await page.evaluate(() => { window.__ed.brush.stack = false; });

  console.log('\n[맵: 놓은 물체의 재질 · 색 바꾸기]');
  const setColor = (sel, v) => page.locator(sel).first().evaluate((i, val) => { i.value = val; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const lastI = await page.evaluate(() => window.__ed.map.objects.length - 1); // 방금 쌓은 상자
  await page.evaluate(i => window.__ed.selectList([i]), lastI);
  await page.selectOption(`${ACT.insp} label.row:has(span.lbl:text-is("재질")) select`, 'metal');
  check((await last()).mat === 'metal', '상자처럼 재질 칸이 없던 물체도 오른쪽 "재질" 에서 바꿀 수 있다', JSON.stringify(await last()));
  const n3 = await page.evaluate(() => window.__ed.map.objects.length);
  await page.evaluate(n => window.__ed.selectList([n - 1, n - 2, n - 3]), n3);
  await page.selectOption(`${ACT.insp} [data-r="multiMat"]`, 'brick');
  await setColor(`${ACT.insp} [data-r="multiTint"]`, '#3a8bff');
  const three = await page.evaluate(() => window.__ed.map.objects.slice(-3).map(o => [o.type, o.mat, o.tint]));
  check(three.every(([, m, t]) => m === 'brick' && t === '#3a8bff'), '여러 개를 고르면 "겉모습 한꺼번에" 로 재질·색을 모두 바꾼다', JSON.stringify(three));
  await page.click(`${ACT.insp} [data-r="multiLook"] button:has-text("색 지우기")`);
  check(await page.evaluate(() => window.__ed.map.objects.slice(-3).every(o => o.tint === undefined)), '"색 지우기" 로 원래 색으로');
  await page.keyboard.press('Escape');

  console.log('\n[분위기 에디터]');
  await page.click('.tab.home'); await page.click('[data-cat="looks"]');
  check(await page.locator('#homeCards .acard[data-asset="look:sunlit"] canvas').count() === 1, '홈에 분위기 카드가 미리보기 그림과 함께 보인다');
  await page.dblclick('#homeCards .acard[data-asset="look:sunlit"]');
  await page.waitForFunction(() => window.__lk && window.__studio.active.kind === 'look', null, { timeout: 15000 });
  check((await page.textContent('#edKind')).includes('분위기 에디터'), '두 번 누르면 분위기 에디터가 열린다');
  await page.click(`${ACT.tools} .tile[data-mat="concrete"]`);
  check(await page.evaluate(() => window.__lk.mat) === 'concrete', '왼쪽 재질을 누르면 그 재질을 고친다');
  await setColor(`${ACT.insp} label.row:has(span.lbl:text-is("바탕 색")) input[type=color]`, '#ff8800');
  await page.waitForFunction(() => window.__lk.applied.materials.concrete.base === '#ff8800', null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => window.__lk.applied.materials.concrete.base) === '#ff8800', '재질 색을 바꾸면 견본 장면에 바로 그려진다');
  await page.keyboard.press('Escape');
  await page.click(`${ACT.tools} [data-r="newLook"]`);
  await page.fill('.modal [data-f="id"]', 'zz_dusk'); await page.fill('.modal [data-f="name"]', '시험 해질녘');
  await page.click('.modal [data-f="go"]');
  await page.waitForFunction(() => window.__lk.data.some(l => l.id === 'zz_dusk'), null, { timeout: 3000 });
  const lk = await page.evaluate(() => { const d = window.__lk.data; return { cur: d[window.__lk.cur].id, base: d[window.__lk.cur].materials.concrete.base }; });
  check(lk.cur === 'zz_dusk' && lk.base === '#ff8800', '"+ 새 분위기" 는 지금 분위기를 복사해서 만든다', JSON.stringify(lk));
  await page.fill(`${ACT.insp} label.row:has(span.lbl:text-is("높이 (도)")) input`, '8');
  await page.waitForFunction(() => window.__lk.applied.sun.elev === 8, null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => window.__lk.applied.sun.elev) === 8, '해 높이를 고치면 바로 보인다');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !window.__lk.isDirty(), null, { timeout: 8000 }).catch(() => {});
  const looksFile = JSON.parse(fs.readFileSync(C('looks.json'), 'utf8'));
  check(looksFile.some(l => l.id === 'zz_dusk' && l.sun.elev === 8) && looksFile[0].materials.concrete.base === '#ff8800', '저장하면 content/looks.json 에 들어간다');
  await page.evaluate(k => window.__studio.activate(k), `map:${TEST_ID}`);
  await page.keyboard.press('Escape');
  const lookOpts = await page.$$eval(`${ACT.insp} label.row:has(span.lbl:text-is("분위기 (빛·재질)")) option`, os => os.map(o => o.value));
  check(lookOpts.includes("zz_dusk"), '저장하면 열린 맵 에디터의 분위기 목록에도 바로 생긴다', JSON.stringify(lookOpts));
  await page.selectOption(`${ACT.insp} label.row:has(span.lbl:text-is("분위기 (빛·재질)")) select`, 'zz_dusk');
  check(await page.evaluate(() => window.__ed.map.look) === 'zz_dusk', '맵 설정에서 분위기를 고르면 맵 데이터에 들어간다');

  console.log('\n[캐릭터 (리깅된 모델)]');
  { // 규칙대로 만든 작은 3인칭 리그를 브라우저에서 만들어 .glb 로 연다 (실제 캐릭터 파일은 git 밖이라)
    const opened = await page.evaluate(async () => {
      const THREE = await import('three'), { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const B = {}, bone = (n, parent, x, y, z) => { const b = new THREE.Bone(); b.name = n; b.position.set(x, y, z); (parent ? B[parent] : null)?.add(b); B[n] = b; return b; };
      bone('Root', null, 0, 0, 0); bone('Hips', 'Root', 0, 0.95, 0); bone('Spine', 'Hips', 0, 0.1, 0); bone('Spine1', 'Spine', 0, 0.12, 0); bone('Chest', 'Spine1', 0, 0.12, 0); bone('Neck', 'Chest', 0, 0.2, 0); bone('Head', 'Neck', 0, 0.1, 0);
      for (const [S, sx] of [['Left', 1], ['Right', -1]]) {
        bone(`${S}Shoulder`, 'Chest', 0.06 * sx, 0.15, 0); bone(`${S}UpperArm`, `${S}Shoulder`, 0.12 * sx, 0, 0); bone(`${S}ForeArm`, `${S}UpperArm`, 0.27 * sx, 0, 0); bone(`${S}Hand`, `${S}ForeArm`, 0.25 * sx, 0, 0); bone(`${S}HandGrip`, `${S}Hand`, 0.08 * sx, -0.02, 0);
        bone(`${S}UpperLeg`, 'Hips', 0.1 * sx, -0.05, 0); bone(`${S}LowerLeg`, `${S}UpperLeg`, 0, -0.42, 0); bone(`${S}Foot`, `${S}LowerLeg`, 0, -0.42, 0); bone(`${S}Toe`, `${S}Foot`, 0, -0.06, 0.12);
      }
      bone('BackWeaponSocket', 'Chest', 0, 0.05, -0.15); bone('HipWeaponSocket', 'Hips', -0.18, 0, 0); bone('WeaponRoot', 'Root', 0, 1.2, 0.3); bone('LeftHandIK', 'WeaponRoot', 0, 0, 0.3);
      const geo = new THREE.BoxGeometry(0.4, 1.7, 0.25); geo.translate(0, 0.85, 0);
      const n = geo.attributes.position.count;
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 ? 0 : 1)), 4));
      const list = Object.values(B), mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: 'MAT_Body' }));
      const root = new THREE.Group(); root.add(B.Root, mesh); root.updateMatrixWorld(true);
      mesh.bind(new THREE.Skeleton([B.Hips, ...list.filter(b => b !== B.Hips)]));
      const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
      await window.__studio.openAsset(`gun:file${Date.now()}`, { buffer, name: 'zz_test_char.glb' });
      return true;
    });
    await page.waitForFunction(() => window.__ch && window.__studio.active && window.__studio.active.kind === 'character', null, { timeout: 20000 });
    const ch = await page.evaluate(() => ({ kind: window.__ch.kind, fails: window.__ch.checks.filter(c => c.level === 'fail').map(c => c.text), bones: window.__ch.bones.size, edKind: document.getElementById('edKind').textContent }));
    check(opened && ch.kind === 'tp' && !ch.fails.length && ch.edKind.includes('모델 에디터'), '리깅된 .glb 를 열면 모델 에디터가 캐릭터 보기로 열고 규칙 검사를 통과한다 (3인칭)', JSON.stringify(ch));
    const pose = await page.evaluate(async () => {
      const THREE = await import('three'), c = window.__ch, arm = c.bones.get('LeftForeArm'), hand = c.bones.get('LeftHand');
      const before = hand.getWorldPosition(new THREE.Vector3());
      c.selectBone(arm); arm.rotation.z += 0.8; arm.updateMatrixWorld(true);
      const moved = hand.getWorldPosition(new THREE.Vector3()).distanceTo(before);
      const w = document.querySelector('#toolbox > div:not([hidden]) [data-r="showWeights"]'); w.checked = true; w.dispatchEvent(new Event('change'));
      const colored = !!c.root.getObjectByProperty('isSkinnedMesh', true).geometry.attributes.color;
      return { moved, colored, sel: c.selBone && c.selBone.name };
    });
    check(pose.sel === 'LeftForeArm' && pose.moved > 0.05 && pose.colored, '뼈를 골라 돌려 보고, 고른 뼈의 웨이트를 색으로 본다', JSON.stringify(pose));
    await page.evaluate(() => window.__ch.setGun('ar_lancer'));
    await page.waitForFunction(() => window.__ch.gun && window.__ch.hold, null, { timeout: 10000 }).catch(() => {});
    const hold = await page.evaluate(async () => {
      const THREE = await import('three'), c = window.__ch;
      const rg = c.bones.get('RightHandGrip').getWorldPosition(new THREE.Vector3()), sr = c.gun.getObjectByName('socket_hand_r').getWorldPosition(new THREE.Vector3());
      return { right: +rg.distanceTo(sr).toFixed(4), hold: c.hold };
    });
    check(hold.right < 0.01 && hold.hold, '무기를 고르면 오른손 그립이 총의 socket_hand_r 에 오고(양손 IK), 왼손 결과(당긴 거리)를 알려 준다', JSON.stringify(hold));
    await page.fill(`${ACT.bar} [data-r="charId"]`, 'zz_test_char');
    await page.click(`${ACT.bar} [data-r="save"]`);
    await page.waitForFunction(() => window.__studio.active && window.__studio.active.key === 'char:zz_test_char', null, { timeout: 8000 }).catch(() => {});
    check(fs.existsSync(C('characters', 'zz_test_char.glb')) && JSON.parse(fs.readFileSync(C('characters', 'index.json'), 'utf8')).includes('zz_test_char'), '프로젝트에 저장하면 content/characters/<id>.glb 와 목록이 생긴다');
    await page.click('.tab.home'); await page.click('[data-cat="models"]'); await page.click('#homeHead button:has-text("캐릭터")');
    check(await page.locator('#homeCards [data-asset="char:zz_test_char"]').count() === 1, '홈 → 모델 → 캐릭터 에 저장한 캐릭터가 보인다');
    await page.click('#homeHead button:has-text("총 · 근접")'); // 다음 테스트를 위해 총 목록으로
  }

  console.log('\n[효과 에디터]');
  await page.click('.tab.home'); await page.click('[data-cat="effects"]');
  check(await page.locator('#homeCards [data-asset="fx:grenade_explode"]').count() === 1, '홈에 효과 카드가 보인다 (게임에서 쓰는 효과 표시)');
  await page.dblclick('#homeCards [data-asset="fx:grenade_explode"]');
  await page.waitForFunction(() => window.__fx && window.__studio.active && window.__studio.active.kind === 'effect', null, { timeout: 15000 });
  check((await page.textContent('#edKind')).includes('효과 에디터'), '두 번 누르면 효과 에디터가 열린다');
  await page.waitForFunction(() => window.__fx.stats().particles > 20, null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.__fx.stats().particles) > 20, '미리 보기에서 효과가 재생된다 (게임과 같은 실행기)', JSON.stringify(await page.evaluate(() => window.__fx.stats())));
  await page.click(`${ACT.tools} [data-em="2"]`); // 불티 층
  check(await page.evaluate(() => window.__fx.em) === 2, '층을 누르면 그 층을 고친다');
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("한 번에 뿜는 수")) input`, '300');
  await page.waitForFunction(() => window.__fx.stats().particles > 300, null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.__fx.stats().particles) > 300, '수치를 고치면 바로 다시 재생된다 (불티 300개)', JSON.stringify(await page.evaluate(() => window.__fx.stats())));
  const nEm = await page.evaluate(() => window.__fx.data[window.__fx.cur].emitters.length);
  await page.click(`${ACT.tools} [data-add="ring"]`);
  check(await page.evaluate(n => window.__fx.data[window.__fx.cur].emitters.length === n + 1 && window.__fx.data[window.__fx.cur].emitters.at(-1).kind === 'ring', nEm), '"+ 고리" 로 층을 더한다');
  await page.click(`${ACT.tools} [data-r="newFx"]`);
  await page.fill('.modal [data-f="id"]', 'zz_test_fx'); await page.fill('.modal [data-f="name"]', '시험 효과');
  await page.click('.modal [data-f="go"]');
  await page.waitForFunction(() => window.__fx.data.some(e => e.id === 'zz_test_fx'), null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => window.__fx.data[window.__fx.cur].id) === 'zz_test_fx', '"+ 새 효과" 로 효과를 만든다');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !window.__fx.isDirty(), null, { timeout: 8000 }).catch(() => {});
  const fxFile = JSON.parse(fs.readFileSync(C('effects.json'), 'utf8'));
  check(fxFile.some(e => e.id === 'zz_test_fx') && fxFile.find(e => e.id === 'grenade_explode').emitters[2].count === 300 && !JSON.stringify(fxFile).includes('_off'), '저장하면 content/effects.json 에 들어간다 (미리 보기용 표시는 빼고)');
  await page.waitForTimeout(400);

  console.log('\n[총 모델]');
  await page.click('.tab.home'); await page.click('[data-cat="models"]'); await page.click('#sampleBtn');
  await page.waitForFunction(() => window.__gv && window.__gv.model && window.__studio.active.kind === 'gun', null, { timeout: 30000 });
  const sm = await page.evaluate(() => { const m = window.__gv.model; return { levels: m.checks.map(x => x.level), spec: { sightY: m.spec.sightY, adsZ: m.spec.adsZ, muzzleZ: m.spec.muzzleZ, mag: !!m.spec.mag, irons: m.spec.irons.length } }; });
  check(sm.levels.every(l => l === 'ok'), '예시 총은 규칙 검사를 모두 통과한다', JSON.stringify(sm.levels));
  const mat = await page.evaluate(async () => { // 색 칸별 재질 값을 엔진이 입히고, 효과(열)는 그 총에만
    const gmat = await import('/js/gunmat.js'), d = gmat.gunMats(), g = window.__gv.model.gun;
    const metal = g.mats.find(m => m.userData.slot === 'metal'), dark = g.mats.find(m => m.userData.slot === 'dark');
    gmat.setGunFx(g, { heat: 1 });
    const glow = metal.emissiveIntensity;
    gmat.setGunFx(g, { heat: 0 });
    return { metal: [metal.metalness, metal.roughness], dark: [dark.metalness, dark.roughness], want: [d.slots.metal.metal, d.slots.metal.rough, d.slots.dark.metal, d.slots.dark.rough], glow, cool: metal.emissiveIntensity, own: (() => { const g2 = gmat.dressGun({ group: g.group.clone(true) }); return g2.mats.every(m => !g.mats.includes(m)); })() };
  });
  check(mat.metal[0] === mat.want[0] && mat.metal[1] === mat.want[1] && mat.dark[0] === mat.want[2] && mat.dark[1] === mat.want[3], '총 재질: 색 칸 이름으로 금속성·거칠기를 엔진이 정한다 (content/gunmaterials.json)', JSON.stringify(mat));
  check(mat.glow > 1 && mat.cool === 0 && mat.own, '효과: 열을 올리면 metal 칸이 달아오르고, 총마다 자기 재질이라 다른 총에 번지지 않는다', JSON.stringify(mat));
  { // 모션 클립: smg_hornet 의 reload 를 게임과 같은 코드로 재생 (탄창·왼손이 움직인다)
    const prev = await page.evaluate(() => window.__studio.active.key);
    await page.evaluate(() => window.__studio.openAsset('gun:smg_hornet_v_3'));
    await page.waitForFunction(() => window.__gv && window.__gv.model && window.__studio.active.key === 'gun:smg_hornet_v_3', null, { timeout: 30000 });
    const mo = await page.evaluate(() => {
      const api = window.__gv, g = api.model.gun, rest = g.mag.position.y;
      api.motion.f = 0.3; api.poseMotion();
      const out = { clips: g.clips.map(c => c.name), moved: rest - g.mag.position.y, arm: g.armL.position.length(), ok: api.model.checks.some(c => c.level === 'ok' && c.text.startsWith('클립 reload')) };
      api.motion.f = 0; api.poseMotion();
      out.back = Math.abs(g.mag.position.y - rest);
      return out;
    });
    check(mo.clips.includes('reload') && mo.ok, '모델 에디터가 모션 클립(reload)을 찾고 규칙 검사를 한다', JSON.stringify(mo));
    check(mo.moved > 0.05 && mo.arm > 0.05 && mo.back < 1e-4, '모션을 한 장면씩 넘기면 탄창이 빠지고 왼팔이 따라가며, 처음으로 돌리면 제자리', JSON.stringify(mo));
    await page.evaluate(k => window.__studio.activate(k), prev);
  }
  const melee = await page.evaluate(async () => { // 근접 무기(칼): socket_hand_r + socket_tip, 날 끝이 앞(-Z)
    const THREE = await import('three'), gm = await import('/js/modelrules.js');
    const build = flip => {
      const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ name: 'metal' }), dark = new THREE.MeshStandardMaterial({ name: 'dark' });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.03, 0.2), mat); blade.position.z = flip ? 0.12 : -0.12; root.add(blade);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.1), dark); grip.position.z = flip ? -0.03 : 0.03; root.add(grip);
      const h = new THREE.Object3D(); h.name = 'socket_hand_r'; root.add(h);
      const t = new THREE.Object3D(); t.name = 'socket_tip'; t.position.z = flip ? 0.22 : -0.22; root.add(t);
      return gm.checkModel(root, { bytes: 50000 });
    };
    const ok = build(false), bad = build(true);
    return { ok: ok.map(c => c.level), okText: ok[0].text, bad: bad.filter(c => c.level === 'fail').map(c => c.text) };
  });
  check(melee.okText.includes('근접 무기') && melee.ok.every(l => l === 'ok'), '칼(socket_hand_r + socket_tip)은 근접 무기 규칙으로 검사해 통과한다 (가늠자·총구·왼손 필요 없음)', JSON.stringify(melee.ok));
  check(melee.bad.some(t => t.includes('날 끝이 손잡이보다 뒤')), '날 끝이 뒤를 향하면 근접 무기 규칙에서 잡아낸다', JSON.stringify(melee.bad));
  check(Math.abs(sm.spec.sightY - 0.064) < 1e-3 && Math.abs(sm.spec.adsZ + 0.21) < 1e-3 && Math.abs(sm.spec.muzzleZ + 0.52) < 1e-3 && sm.spec.mag && sm.spec.irons === 2, '.glb 의 부착 지점·부품이 게임 기준점으로 바뀐다', JSON.stringify(sm.spec));
  const toolsNow = await page.evaluate(s => !!document.querySelector(`${s} [data-r="views"]`) && !document.querySelector(`${s} .tile[data-tool]`), ACT.tools);
  check(toolsNow && (await page.textContent('#edKind')).includes('모델 에디터'), '모델은 모델 에디터로 열리고, 도구 상자도 그 편집기 것으로 바뀐다');
  await page.click(`${ACT.tools} [data-view="ads"]`);
  const ads = await page.evaluate(() => { const g = window.__gv.model.gun, h = window.__gv.holder; return Math.abs(h.position.y + g.sightY) < 1e-6 && Math.abs(h.position.z - g.adsZ) < 1e-6; });
  check(ads, '정조준 보기: 게임과 같은 계산으로 조준선이 화면 가운데');
  await page.selectOption(`${ACT.tools} select[data-slot="optic"]`, 'reddot');
  await page.selectOption(`${ACT.tools} select[data-slot="mag"]`, 'ext');
  const wp = await page.evaluate(() => { const g = window.__gv.model.gun; return { up: g.sightY > 0.065, irons: g.irons.every(o => !o.visible), mag: g.mag.scale.y > 1.2 }; });
  check(wp.up && wp.irons && wp.mag, '파츠: 조준경이 socket_optic 위에 붙고(가늠자 숨김), 확장 탄창은 길어진다', JSON.stringify(wp));
  await page.selectOption(`${ACT.tools} [data-r="skinSel"]`, '네온');
  check(await page.evaluate(() => '#' + window.__gv.model.scan.materials.find(x => x.name === 'body').color.getHexString()) === '#ff3fa4', '스킨을 고르면 색 칸의 색이 바뀐다');

  await page.evaluate(async () => { // 규칙을 어긴 모델: 필수 지점 하나 빼고, cm 로 내보낸 것처럼 100배
    const { buildSampleGun } = await import('/studio/samplegun.js');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const g = buildSampleGun(); g.remove(g.getObjectByName('socket_ads')); g.scale.setScalar(100);
    await window.__studio.openAsset('gun:filebroken', { buffer: await new GLTFExporter().parseAsync(g, { binary: true }), name: 'broken.glb' });
  });
  const broken = await page.evaluate(a => ({ fails: window.__gv.model.checks.filter(x => x.level === 'fail').map(x => x.text), save: document.querySelector(`${a.bar} [data-r="save"]`).disabled }), ACT);
  check(broken.fails.some(t => t.includes('socket_ads')) && broken.fails.some(t => t.includes('cm')) && broken.save, '필수 지점이 없거나 100배면 알려 주고 저장이 잠긴다', JSON.stringify(broken.fails));
  await page.evaluate(() => window.__studio.closeDoc('gun:filebroken'));

  await page.click('.tab[data-key="gun:sample"]');
  await page.fill(`${ACT.bar} [data-r="gunId"]`, GUN_ID);
  await page.click(`${ACT.bar} [data-r="save"]`);
  await page.waitForFunction(id => window.__studio.home.data.models.some(m => m.id === id) && window.__studio.active.key === `gun:${id}`, GUN_ID, { timeout: 10000 });
  const glb = C('guns', `${GUN_ID}.glb`);
  check(fs.existsSync(glb) && fs.readFileSync(glb).toString('ascii', 0, 4) === 'glTF' && JSON.parse(fs.readFileSync(C('guns', 'index.json'), 'utf8')).includes(GUN_ID), '프로젝트에 저장하면 content/guns/<id>.glb 와 목록이 생기고, 탭 이름이 그 id 가 된다');

  console.log('\n[데이터로 등록]');
  check(!(await page.locator(`${ACT.bar} [data-r="register"]`).isDisabled()), '저장했고 검사를 통과한 모델은 "데이터로 등록" 할 수 있다');
  await page.click(`${ACT.bar} [data-r="register"]`);
  await page.fill('.modal [data-f="name"]', '시험 소총');
  await page.selectOption('.modal [data-f="weapon"]', 'mp5');
  await page.click('.modal [data-f="go"]');
  await page.waitForFunction(id => window.__studio.home.data.registry.some(m => m.id === id), GUN_ID, { timeout: 10000 });
  const reg = JSON.parse(fs.readFileSync(C('models.json'), 'utf8')).find(m => m.id === GUN_ID), wmp5 = JSON.parse(fs.readFileSync(C('weapons.json'), 'utf8')).find(w => w.id === 'mp5');
  check(reg && reg.name === '시험 소총' && reg.file === `guns/${GUN_ID}.glb` && reg.tris > 100 && wmp5.model === GUN_ID, '등록하면 content/models.json 에 올라가고, 고른 무기(MP5)의 모델이 된다', JSON.stringify({ reg, model: wmp5.model }));
  check((await page.textContent(`${ACT.bar} [data-r="regState"]`)).includes('등록됨'), '모델 에디터에 "등록됨" 이 표시된다');
  await page.click('.tab.home'); await page.click('[data-cat="models"]');
  const card = await page.textContent(`[data-asset="gun:${GUN_ID}"]`);
  check(card.includes('등록됨') && card.includes('시험 소총'), '홈의 모델 카드에 "등록됨" 과 등록한 이름이 보인다', card);
  await page.click('[data-cat="weapons"]'); await page.click('[data-asset="weapon:mp5"]');
  check((await page.textContent('#homeDetail')).includes('시험 소총 (등록된 모델)'), '무기 자세히에 연결된 모델이 보인다');

  console.log('\n[등록한 모델이 게임에 자동으로 적용]');
  const gctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  await gctx.addInitScript(() => localStorage.setItem('fd_loadout', JSON.stringify({ slots: ['mp5', 'm9'], parts: {} })));
  const gp = await gctx.newPage();
  const gerr = []; gp.on('pageerror', e => gerr.push(e.message));
  await gp.goto(`http://localhost:${srv.port}/?auto=Tester&nolock&mode=ffa`);
  await gp.waitForFunction(() => window.__g && window.__g.joined, null, { timeout: 60000 });
  const gm = await gp.evaluate(i => ({ cur: window.__g.cur, models: window.__g.vmGuns.map(g => g.model || null), sightY: window.__g.vmGuns[i].sightY }), W('mp5'));
  check(gm.models[W('mp5')] === 'zz_gun_test' && Math.abs(gm.sightY - 0.064) < 1e-3, '게임을 열면 MP5 가 등록된 모델로 그려진다 (정조준 높이도 모델의 부착 지점대로)', JSON.stringify(gm));
  check(gm.models.filter(Boolean).length >= 1 && gm.models[W('m9')] === null, '모델이 없는 무기는 코드로 만든 총 그대로', JSON.stringify(gm.models));
  check(gerr.length === 0, '게임 화면 오류가 없다', gerr.join(' | '));
  await gctx.close();

  console.log('\n[창 크기 조절]');
  await page.dblclick(`[data-asset="weapon:ar"]`);
  await page.waitForFunction(() => window.__studio.active && window.__studio.active.key === 'data:weapons', null, { timeout: 10000 });
  const tb0 = (await page.locator('#toolbox').boundingBox()).width;
  const sp = await page.locator('#edBody > .split').first().boundingBox();
  await page.mouse.move(sp.x + 2, sp.y + 200); await page.mouse.down(); await page.mouse.move(sp.x + 82, sp.y + 200, { steps: 5 }); await page.mouse.up();
  const tb1 = (await page.locator('#toolbox').boundingBox()).width;
  check(tb1 > tb0 + 60, '경계선을 끌면 도구 상자가 넓어진다', `${tb0} → ${tb1}`);
  await page.locator('#edBody > .split').first().dblclick();
  check(Math.abs((await page.locator('#toolbox').boundingBox()).width - tb0) < 2, '경계선을 더블클릭하면 기본 크기로');
  await page.locator('#edBody > .split').first().click(); await page.locator('#edBody > .split').last().dblclick(); await page.locator('#homeNav').count();
  const lay = await page.evaluate(() => { const t = document.getElementById('toolbox').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(), i = document.getElementById('inspector').getBoundingClientRect(); return { side: t.right <= s.left + 1 && s.right <= i.left + 1, stageW: s.width }; });
  check(lay.side && lay.stageW > 400, '경계선을 클릭·더블클릭만 해도 레이아웃이 깨지지 않는다 (도구 상자 | 화면 | 속성 이 나란히)', JSON.stringify(lay));

  console.log('\n[게임 데이터]');
  await page.click('.tab.home'); await page.click('[data-cat="weapons"]'); await page.dblclick('[data-asset="weapon:m870"]');
  await page.waitForFunction(() => window.__dd && window.__studio.active.key === 'data:weapons', null, { timeout: 10000 });
  check(await page.evaluate(() => window.__dd.data[window.__dd.cur].id) === 'm870' && (await page.textContent('#edKind')).includes('데이터 에디터'), '홈에서 무기 카드를 두 번 누르면 데이터 에디터가 그 무기를 고른 채 열린다');
  const mp5Row = await page.textContent(`#overlays > div:not([hidden]) table.cmp tbody tr:nth-child(${W('mp5') + 1})`);
  const regList = await page.textContent(`${ACT.tools}`);
  check(mp5Row.includes('시험 소총') && regList.includes('시험 소총') && regList.includes('MP5'), '데이터 에디터에 등록된 모델이 보인다 (무기 표의 모델 열, 도구 상자의 "등록된 모델" 과 연결된 무기)', mp5Row);
  await page.evaluate(i => window.__dd.select(i), W('mp5'));
  const opts = await page.evaluate(() => [...document.querySelectorAll('#inspector > div:not([hidden]) select')].flatMap(s => [...s.options].map(o => o.value)));
  check(opts.includes('zz_gun_test'), '무기의 "모델" 은 등록된 모델 중에서 고르는 목록이다');
  await page.evaluate(() => window.__dd.select(0));
  const ttk0 = await page.textContent('#overlays > div:not([hidden]) table.cmp tbody tr:first-child td:nth-child(6)');
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("피해")) input`, '40');
  const ttk1 = await page.textContent('#overlays > div:not([hidden]) table.cmp tbody tr:first-child td:nth-child(6)');
  check(ttk0 !== ttk1 && await page.evaluate(() => window.__dd.isDirty()), '무기 피해를 고치면 비교 표(TTK)가 바로 다시 계산된다', `${ttk0} → ${ttk1}`);
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("피해")) input`, '0');
  check(await page.evaluate(a => window.__dd.errors.length > 0 && document.querySelector(`${a.bar} [data-r="save"]`).disabled, ACT), '범위를 벗어나면 (피해 0) 오류가 보이고 저장이 잠긴다');
  await page.evaluate(() => { window.__dd.data[0].dmg = 24; window.__dd.render(); });

  console.log('\n[스킬 데이터]');
  await page.evaluate(() => window.__dd.select(0)); // 기본 돌격소총
  const skillOpts = await page.evaluate(() => [...document.querySelectorAll('#inspector > div:not([hidden]) .list select')].map(s => [...s.options].map(o => o.value).join(',')));
  check(skillOpts.length === 10 && skillOpts.every(o => o.includes('dash') && o.includes('grenade')), '무기의 "스킬" 칸은 스킬 목록에서 고른다 (기본 돌격소총: 주무기 5 + 보조무기 5)', JSON.stringify(skillOpts.length));
  await page.click('.tab.home'); await page.click('[data-cat="skills"]');
  check(await page.locator('#homeCards [data-asset="skill:dash"]').count() === 1, '홈에 스킬 카드가 보인다');
  await page.dblclick('#homeCards [data-asset="skill:dash"]');
  await page.waitForFunction(() => window.__studio.active && window.__studio.active.key === 'data:skills', null, { timeout: 10000 });
  check(await page.evaluate(() => window.__dd.data[window.__dd.cur].id) === 'dash', '스킬 카드를 두 번 누르면 데이터 에디터의 스킬 탭이 그 스킬을 고른 채 열린다');
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("쿨타임 (초)")) input`, '4');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !window.__dd.isDirty(), null, { timeout: 8000 }).catch(() => {});
  check(JSON.parse(fs.readFileSync(C('skills.json'), 'utf8')).find(x => x.id === 'dash').cd === 4, '스킬 수치를 고치고 저장하면 content/skills.json 에 들어간다');
  await page.evaluate(() => { window.__dd.data[window.__dd.cur].id = 'dash_x'; window.__dd.render(); });
  check(await page.evaluate(a => window.__dd.errors.some(e => e.includes('없는 스킬')) && document.querySelector(`${a.bar} [data-r="save"]`).disabled, ACT), '무기가 쓰고 있는 스킬의 id 를 바꾸면 오류로 알리고 저장이 잠긴다');
  await page.evaluate(() => { window.__dd.data[window.__dd.cur].id = 'dash'; window.__dd.render(); });

  console.log('\n[새 무기 만들기 (양식)]');
  await page.click('.tab.home'); await page.click('[data-cat="weapons"]'); await page.click('#newDataBtn');
  await page.waitForSelector('.modal [data-f="id"]', { timeout: 10000 });
  const go = () => page.locator('.modal [data-f="go"]').isDisabled();
  check(await go(), '빈 양식으로는 만들 수 없다');
  await page.fill('.modal [data-f="id"]', 'ar'); await page.fill('.modal [data-f="name"]', '시험총'); await page.fill('.modal [data-f="cls"]', '돌격소총');
  check(await go() && (await page.textContent('.modal:not(#help)')).includes('이미 있습니다'), '이미 있는 id 는 안 된다');
  await page.fill('.modal [data-f="id"]', 'zz_new_gun');
  check(await go(), '새 무기는 모델을 고르기 전에는 만들 수 없다');
  await page.selectOption('.modal [data-f="model"]', GUN_ID);
  check(!(await go()), '모든 칸을 채우면 만들 수 있다');
  await page.click('.modal [data-f="go"]');
  const nw = await page.evaluate(() => { const w = window.__dd.data.at(-1); return { id: w.id, name: w.name, model: w.model, dmg: w.dmg, sel: window.__dd.data[window.__dd.cur].id, errors: window.__dd.errors }; });
  check(nw.id === 'zz_new_gun' && nw.model === GUN_ID && nw.dmg > 0 && nw.sel === 'zz_new_gun' && !nw.errors.length, '기준 무기의 수치로 새 무기가 생기고 선택된다', JSON.stringify(nw));
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !window.__dd.isDirty(), null, { timeout: 8000 });
  check(JSON.parse(fs.readFileSync(C('weapons.json'), 'utf8')).some(w => w.id === 'zz_new_gun' && w.model === GUN_ID), '저장하면 content/weapons.json 에 들어간다');
  await page.evaluate(() => { window.__dd.data.at(-1).model = undefined; delete window.__dd.data.at(-1).model; window.__dd.render(); });
  check(await page.evaluate(() => window.__dd.errors.some(e => e.includes('모델이 있어야'))), '새 무기에서 모델을 빼면 검사 오류 (저장 잠김)');
  await page.evaluate(() => window.__dd.undo && window.__dd.render());

  await page.click(`${ACT.tools} .tile:has-text("모드")`);
  await page.waitForFunction(() => window.__studio.active.key === 'data:modes', null, { timeout: 10000 });
  await page.evaluate(() => { window.__dd.select(0); });
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("혼자 점령하는 시간 (초)")) input`, '9');
  await page.dispatchEvent(`${ACT.insp} .row:has(.lbl:text-is("혼자 점령하는 시간 (초)")) input`, 'change');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !window.__dd.isDirty(), null, { timeout: 8000 });
  check(JSON.parse(fs.readFileSync(C('modes.json'), 'utf8'))[0].zone.capture === 9, '모드 수치(점령 시간)를 고치고 ⌘S 하면 content/modes.json 에 저장된다');
  // 예전 버전이 남긴 잘못된 크기 값(null → 'nullpx')이 있어도 기본 크기로 열린다
  await page.evaluate(() => localStorage.setItem('fs_layout_v1', JSON.stringify({ '--ed-l': null, '--ed-r': null })));
  await page.goto(`http://localhost:${srv.port}/studio/?open=map:frontline&active=map:frontline`);
  await page.waitForFunction(() => window.__ed && window.__ed.map && window.__ed.map.id === 'frontline', null, { timeout: 30000 });
  const fresh = await page.evaluate(() => { const t = document.getElementById('toolbox').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return { tb: Math.round(t.width), side: t.right <= s.left + 1, stageW: s.width }; });
  check(fresh.side && fresh.tb === 220 && fresh.stageW > 400, '다시 열면 항상 기본 크기 (예전 잘못된 값이 남아 있어도)', JSON.stringify(fresh));
  check(errors.length === 0, '스튜디오 브라우저 오류가 없다', errors.join(' | '));
  await page.close();

  console.log('\n[라이브(prod)에서는 스튜디오가 꺼져 있다]');
  const prod = await startServer({ APP_ENV: 'prod' }); servers.push(prod);
  const st = await Promise.all(['/studio/', '/editor/'].map(u => fetch(`http://localhost:${prod.port}${u}`).then(r => r.status)));
  const api = await Promise.all(['maps/x', 'guns/x', 'content/modes', 'drafts/x'].map(u => fetch(`http://localhost:${prod.port}/api/${u}`, { method: 'PUT', body: '{}' }).then(r => r.status)));
  check(st.every(s => s === 404) && api.every(s => s === 404), '스튜디오 페이지와 저장·시험 플레이 API 가 없다', `${st} ${api}`);
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
