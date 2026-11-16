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
import { startServer, connect, check, failed, ROOT } from './helpers.mjs';
import { checkMap } from '../shared/content/schema.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log(`Chrome 을 찾을 수 없어 브라우저 테스트를 건너뜁니다 (${CHROME}). CHROME_PATH 로 지정하세요.`);
  process.exit(process.env.REQUIRE_CHROME ? 1 : 0);
}
const C = (...p) => path.join(ROOT, 'content', ...p);
const TEST_ID = 'zz_studio_test', GUN_ID = 'zz_gun_test';
const keep = [C('maps', 'index.json'), C('guns', 'index.json'), C('modes.json'), C('models.json'), C('weapons.json')].map(f => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]);
const cleanup = () => {
  for (const [f, text] of keep) { if (text === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, text); }
  fs.rmSync(C('maps', `${TEST_ID}.json`), { force: true }); fs.rmSync(C('guns', `${GUN_ID}.glb`), { force: true });
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
  check((await page.textContent('#homeCards')).includes('준비 중'), '효과는 "준비 중" 으로 자리가 잡혀 있다');
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

  console.log('\n[총 모델]');
  await page.click('.tab.home'); await page.click('[data-cat="models"]'); await page.click('#sampleBtn');
  await page.waitForFunction(() => window.__gv && window.__gv.model && window.__studio.active.kind === 'gun', null, { timeout: 30000 });
  const sm = await page.evaluate(() => { const m = window.__gv.model; return { levels: m.checks.map(x => x.level), spec: { sightY: m.spec.sightY, adsZ: m.spec.adsZ, muzzleZ: m.spec.muzzleZ, mag: !!m.spec.mag, irons: m.spec.irons.length } }; });
  check(sm.levels.every(l => l === 'ok'), '예시 총은 규칙 검사를 모두 통과한다', JSON.stringify(sm.levels));
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
  const gm = await gp.evaluate(() => ({ cur: window.__g.cur, models: window.__g.vmGuns.map(g => g.model || null), sightY: window.__g.vmGuns[2].sightY }));
  check(gm.models[2] === 'zz_gun_test' && Math.abs(gm.sightY - 0.064) < 1e-3, '게임을 열면 MP5 가 등록된 모델로 그려진다 (정조준 높이도 모델의 부착 지점대로)', JSON.stringify(gm));
  check(gm.models.filter(Boolean).length >= 1 && gm.models[6] === null, '모델이 없는 무기는 코드로 만든 총 그대로', JSON.stringify(gm.models));
  check(gerr.length === 0, '게임 화면 오류가 없다', gerr.join(' | '));
  await gctx.close();

  console.log('\n[창 크기 조절]');
  await page.dblclick(`[data-asset="weapon:m4"]`);
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
  await page.click('.tab.home'); await page.click('[data-cat="weapons"]'); await page.dblclick('[data-asset="weapon:ak"]');
  await page.waitForFunction(() => window.__dd && window.__studio.active.key === 'data:weapons', null, { timeout: 10000 });
  check(await page.evaluate(() => window.__dd.data[window.__dd.cur].id) === 'ak' && (await page.textContent('#edKind')).includes('데이터 에디터'), '홈에서 무기 카드를 두 번 누르면 데이터 에디터가 그 무기를 고른 채 열린다');
  const mp5Row = await page.textContent('#overlays > div:not([hidden]) table.cmp tbody tr:nth-child(3)');
  const regList = await page.textContent(`${ACT.tools}`);
  check(mp5Row.includes('시험 소총') && regList.includes('시험 소총') && regList.includes('MP5'), '데이터 에디터에 등록된 모델이 보인다 (무기 표의 모델 열, 도구 상자의 "등록된 모델" 과 연결된 무기)', mp5Row);
  await page.evaluate(() => window.__dd.select(2));
  const opts = await page.evaluate(() => [...document.querySelectorAll('#inspector > div:not([hidden]) select')].flatMap(s => [...s.options].map(o => o.value)));
  check(opts.includes('zz_gun_test'), '무기의 "모델" 은 등록된 모델 중에서 고르는 목록이다');
  await page.evaluate(() => window.__dd.select(0));
  const ttk0 = await page.textContent('#overlays > div:not([hidden]) table.cmp tbody tr:first-child td:nth-child(6)');
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("피해")) input`, '40');
  const ttk1 = await page.textContent('#overlays > div:not([hidden]) table.cmp tbody tr:first-child td:nth-child(6)');
  check(ttk0 !== ttk1 && await page.evaluate(() => window.__dd.isDirty()), '무기 피해를 고치면 비교 표(TTK)가 바로 다시 계산된다', `${ttk0} → ${ttk1}`);
  await page.fill(`${ACT.insp} .row:has(.lbl:text-is("피해")) input`, '0');
  check(await page.evaluate(a => window.__dd.errors.length > 0 && document.querySelector(`${a.bar} [data-r="save"]`).disabled, ACT), '범위를 벗어나면 (피해 0) 오류가 보이고 저장이 잠긴다');
  await page.evaluate(() => { window.__dd.data[0].dmg = 22; window.__dd.render(); });

  console.log('\n[새 무기 만들기 (양식)]');
  await page.click('.tab.home'); await page.click('[data-cat="weapons"]'); await page.click('#newDataBtn');
  await page.waitForSelector('.modal [data-f="id"]', { timeout: 10000 });
  const go = () => page.locator('.modal [data-f="go"]').isDisabled();
  check(await go(), '빈 양식으로는 만들 수 없다');
  await page.fill('.modal [data-f="id"]', 'm4'); await page.fill('.modal [data-f="name"]', '시험총'); await page.fill('.modal [data-f="cls"]', '돌격소총');
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
