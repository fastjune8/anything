// 옷(캐릭터 꾸미기) 테스트: 데이터 규칙, 옷 GLB 파일(뼈대·재질·예산), 입장 때 옷 정보 전달
import fs from 'node:fs';
import path from 'node:path';
import { startServer, connect, check, failed, sleep, ROOT } from './helpers.mjs';
import { SLOTS, REGIONS, ITEMS, DEFAULTS, COLOR_SLOTS, resolveOutfit, sanitizeOutfit, packOutfit, unpackOutfit, botOutfit, maskBits } from '../shared/cosmetics.js';
import { checkCosmetics } from '../shared/content/schema.js';

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/cosmetics.json'), 'utf8'));
// 폐기한 절차적 옷의 사본 (tests/fixtures/garment/): 프로덕션 카탈로그가 비어 있는 동안에도 데이터 규칙·GLB 규칙을 시험한다
const FIX = path.join(ROOT, 'tests/fixtures/garment');
const fixData = JSON.parse(fs.readFileSync(path.join(FIX, 'cosmetics.fixture.json'), 'utf8'));
const HAS_ITEMS = ITEMS.size > 0;
const REF = { slots: SLOTS, regions: REGIONS, fpRegions: ['chest', 'shoulder_l', 'upperarm_l', 'forearm_l', 'hand_l', 'shoulder_r', 'upperarm_r', 'forearm_r', 'hand_r'] };

console.log('[데이터]');
check(checkCosmetics(data, REF).length === 0, 'content/cosmetics.json 이 검사를 통과한다', checkCosmetics(data, REF).join(' / '));
check(checkCosmetics(fixData, REF).length === 0, '픽스처 카탈로그도 검사를 통과한다', checkCosmetics(fixData, REF).join(' / '));
const bad = JSON.parse(JSON.stringify(fixData));
bad.items.find(i => i.id === 'tactical_jacket_001').fp = undefined;
delete bad.items.find(i => i.id === 'tactical_jacket_001').fp;
check(checkCosmetics(bad, REF).some(e => e.includes('fp 모델이 필요')), '팔을 가리는 옷에 1인칭 모델이 없으면 검사가 막는다');
const bad2 = JSON.parse(JSON.stringify(fixData)); bad2.items[0].mask = ['knee'];
check(checkCosmetics(bad2, REF).some(e => e.includes('없는 몸 영역')), '없는 몸 영역은 검사가 막는다');

console.log('\n[입는 규칙]');
if (!HAS_ITEMS) {
  const bare = resolveOutfit(sanitizeOutfit(null));
  check(Object.keys(bare.items).length === 0 && bare.mask === 0 && bare.fpMask === 0, '카탈로그가 비어 있으면 기본 복장은 맨몸이다 (옷 없음, 가리는 영역 없음)');
  console.log('  (카탈로그가 비어 있어 옷 입고 벗기는 규칙 시험은 건너뜀 — 외부 의상이 등록되면 아래 시험이 다시 켜진다)');
} else {
const full = resolveOutfit(sanitizeOutfit(null));
check(Object.keys(full.items).sort().join() === ['back', 'feet', 'hair', 'hands', 'head', 'lower', 'upper'].join(), '기본 옷 = 세트 001 일곱 벌');
check(full.mask === maskBits(REGIONS.filter(r => !['head', 'neck'].includes(r))), '세트 001 은 머리·목만 남기고 몸을 가린다');
const noUpper = resolveOutfit(sanitizeOutfit({ items: { upper: null } }));
check(!noUpper.items.upper && noUpper.items.lower && !(noUpper.mask & maskBits(['chest'])) && (noUpper.mask & maskBits(['pelvis'])), '상의만 벗으면 상체만 다시 보이고 다른 슬롯은 그대로');
check(!(noUpper.fpMask & maskBits(['forearm_l'])) && (noUpper.fpMask & maskBits(['hand_l'])), '1인칭 가리기도 같이 바뀐다 (팔은 보이고 장갑은 그대로)');
const junk = sanitizeOutfit({ items: { upper: 'tactical_pants_001', hair: 'nope', head: 5 }, palette: 'x', skin: 99 });
check(!('upper' in junk.items) && !('hair' in junk.items) && !('head' in junk.items) && junk.palette === DEFAULTS.palette && junk.skin === DEFAULTS.skin, '슬롯이 안 맞거나 없는 아이템·팔레트·피부는 버리고 기본값');
const ck = packOutfit({ items: { back: null, upper: 'tactical_jacket_001' }, skin: 1 });
check(JSON.stringify(ck) === JSON.stringify([DEFAULTS.palette, 1, ['back', 0]]), '네트워크 모양은 기본과 다른 슬롯만 담는다', JSON.stringify(ck));
check(JSON.stringify(unpackOutfit(ck)) === JSON.stringify(sanitizeOutfit({ items: { back: null }, skin: 1 })), 'pack → unpack 이 같은 선택으로 돌아온다');
check(JSON.stringify(botOutfit(3)) === JSON.stringify(botOutfit(3)), '봇 옷은 번호로 정해진다 (난수 없음)');
}

console.log('\n[옷 GLB 파일]');
function glbJson(file) {
  const b = fs.readFileSync(file); const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}
const bodyTP = glbJson(path.join(ROOT, 'content/characters/hyperfps_thirdperson_v_8.glb'));
const bodyFP = glbJson(path.join(ROOT, 'content/characters/hyperfps_viewmodel_v_7.glb'));
const joints = g => g.skins[0].joints.map(j => g.nodes[j].name);
check(bodyTP.meshes[0].primitives[0].attributes._REGION !== undefined && bodyFP.meshes[0].primitives[0].attributes._REGION !== undefined, '몸·1인칭 팔 GLB 에 몸 영역(_REGION)이 있다');
const BUDGET = { upper: 5000, lower: 4000, head: 2500, hair: 2500, hands: 2000, feet: 2000, back: 2500 };
for (const it of [...ITEMS.values(), ...fixData.items.map(i => ({ ...i, fixture: true }))]) {
  for (const [view, rel] of [['tp', it.tp], ['fp', it.fp]]) {
    if (!rel) continue;
    const file = path.join(it.fixture ? path.join(FIX, 'content') : path.join(ROOT, 'content'), rel);
    if (!fs.existsSync(file)) { check(false, `${it.id} ${view}: 파일이 있다`, rel); continue; }
    const g = glbJson(file);
    const body = view === 'fp' ? bodyFP : bodyTP;
    const mats = (g.materials || []).map(m => m.name.replace(/\.\d+$/, ''));
    const tris = g.meshes.reduce((n, m) => n + m.primitives.reduce((k, p) => k + g.accessors[p.indices].count / 3, 0), 0);
    const cap = view === 'fp' ? 3500 : BUDGET[it.slot];
    let ok = mats.every(m => COLOR_SLOTS.includes(m)) && !(g.textures && g.textures.length) && !(g.animations && g.animations.length) && tris <= cap;
    let note = `재질 ${mats.join(',')} · 삼각형 ${tris}/${cap}`;
    if (it.mount === 'skin') {
      const same = g.skins && JSON.stringify(joints(g)) === JSON.stringify(joints(body));
      ok = ok && same; note += same ? ' · 뼈대 = 몸과 같음' : ' · 뼈대가 몸과 다름';
    } else {
      const parent = g.nodes.find(n => (n.children || []).some(c => g.nodes[c].mesh !== undefined));
      ok = ok && parent && parent.name === it.mount.bone; note += ` · 붙은 뼈 ${parent && parent.name}`;
    }
    check(ok, `${it.id} ${view}: 색 칸 재질만, 텍스처·애니메이션 없음, 예산 안, 뼈대 규칙`, note);
  }
}

console.log('\n[입장: 옷 정보 전달]');
const srv = await startServer({ MATCH_SECONDS: '60', GOAL: '999', BOT_FILL: '4' });
let exitCode = 0;
try {
  const a = await connect(srv.port, 'dresser').ready();
  a.send({ t: 'lo', outfit: { items: { upper: null, back: null, hair: 'tactical_pants_001' }, skin: 2, palette: 'nope' } });
  await a.waitFor('lo');
  a.send({ t: 'rcreate', name: '옷 시험', mode: 'ffa', bots: true });
  const wa = await a.waitFor('welcome');
  const b = await connect(srv.port, 'viewer').ready();
  b.send({ t: 'rjoin', code: wa.room.code });
  const wb = await b.waitFor('welcome');
  const pa = wb.players.find(p => p.id === a.me);
  check(JSON.stringify(pa.ck) === JSON.stringify(HAS_ITEMS ? [DEFAULTS.palette, 2, ['upper', 0], ['back', 0]] : [DEFAULTS.palette, 2]), '고른 옷이 정리되어 방 사람들에게 전달된다 (잘못된 값은 버림)', JSON.stringify(pa.ck));
  const bot = wb.players.find(p => p.bot);
  check(bot && Array.isArray(bot.ck), '봇도 옷 정보가 있다', JSON.stringify(bot && bot.ck));
  const pj = { player: (await a.waitEvent('pj', e => e.p.id === b.me)).p };
  check(JSON.stringify(pj.player.ck) === JSON.stringify([DEFAULTS.palette, DEFAULTS.skin]), '옷을 고르지 않은 사람은 기본 옷', JSON.stringify(pj.player.ck));
  await sleep(100);
} catch (e) {
  console.error('테스트 중 오류:', e);
  exitCode = 1;
} finally {
  srv.stop();
}
console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(exitCode || (failed() ? 1 : 0));
