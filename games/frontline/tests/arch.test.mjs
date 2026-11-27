// 구조 가드 (서버·브라우저 없이, 1초 미만): 모듈 간 의존 방향이 무너지지 않게 지킨다.
//   코드가 커져도 꼬이지 않게 "누가 누구를 알아도 되는가" 를 규칙 표(RULES)로 적어 두고, 어기면 어디가 왜 틀렸는지 알려 준다.
//   새 규칙은 RULES 에 한 항목 추가. 규칙을 일부러 바꿀 때는 docs/ARCHITECTURE.md 의 "클라이언트 구조" 도 같이 고친다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, failed } from './helpers.mjs';
import { SIGHTS, sightFor, wantsDot, defaultParts, bindSight, viewOf } from '../client/js/weaponview.js';
import { WEAPONS } from '../shared/weapons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 파일 → 불러오는 모듈 목록 ('three' 같은 패키지는 그대로, 프로젝트 파일은 루트 기준 경로로)
function importsOf(file) {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)) {
    const spec = m[1] || m[2];
    if (spec.startsWith('.')) out.push(path.normalize(path.join(path.dirname(file), spec)));
    else if (spec.startsWith('/')) out.push(spec.slice(1)); // '/shared/...' = 루트 기준
    else out.push(spec);
  }
  return out;
}

const clientFiles = walk('client/js'), sharedFiles = walk('shared'), serverFiles = walk('server');
const graph = Object.fromEntries(clientFiles.map(f => [f, importsOf(f).filter(i => clientFiles.includes(i))]));

// 규칙: file(들)이 불러오면 안 되는 것. forbid 는 정규식 또는 함수
const RULES = [
  { name: 'shared/ (서버·브라우저 공용)는 client·server·studio·three 에 의존하지 않는다', files: sharedFiles, forbid: /^(client|server|studio)\/|^three(\/|$)/ },
  { name: 'server/ 는 client·studio 를 불러오지 않는다', files: serverFiles, forbid: /^(client|studio)\// },
  { name: 'predict.js(예측·넷코드)는 연출 모듈을 모른다 — 사건은 onSimEvents 로 내보내고 playerfx.js 가 받는다',
    files: ['client/js/predict.js'], forbid: /^client\/js\/(sfx|audio|fx|vfx|effects|dashfx|hud|viewmodel|remotes|minimap|objective|playerfx|selfview)\.js$/ },
  { name: 'recoil.js(반동 수치)는 상태·유틸만 쓴다', files: ['client/js/recoil.js'], forbid: i => !/^client\/js\/(state|util)\.js$/.test(i) },
  { name: 'weaponview.js(무기가 보이는 방식)는 순수 모듈 — 아무것도 불러오지 않는다', files: ['client/js/weaponview.js'], forbid: () => true },
];

for (const r of RULES) {
  const bad = [];
  for (const f of r.files) for (const i of importsOf(f)) if (typeof r.forbid === 'function' ? r.forbid(i) : r.forbid.test(i)) bad.push(`${f} → ${i}`);
  check(bad.length === 0, r.name, bad.join(', '));
}

// 순환 참조 (client/js 안)
{
  const cycles = []; const state = {}; const stack = [];
  const dfs = v => { state[v] = 1; stack.push(v); for (const w of graph[v]) { if (state[w] === 1) cycles.push([...stack.slice(stack.indexOf(w)), w].map(x => path.basename(x)).join(' → ')); else if (!state[w]) dfs(w); } stack.pop(); state[v] = 2; };
  for (const f of clientFiles) if (!state[f]) dfs(f);
  check(cycles.length === 0, 'client/js 모듈끼리 순환 참조가 없다', cycles.slice(0, 3).join(' | '));
}

// wp(1인칭 무기 상태) 필드별 쓰는 모듈 — 전역 가변 상태가 얽히지 않게, 새 필드는 쓰는 모듈을 여기에 정해야 한다 (읽기는 누구나)
const WP_OWNERS = {
  cur: ['predict', 'loadout', 'state'], slot: ['predict', 'loadout'], adsT: ['predict'], drawT: ['predict'], cooldown: ['predict'], reload: ['predict'], sprintT: ['predict'], sprinting: ['predict'],
  kickP: ['recoil'], kickY: ['recoil'], burstN: ['recoil'], burstSeed: ['recoil'], sinceShot: ['recoil'],
  shots: ['playerfx'], side: ['playerfx'], vmKick: ['playerfx'], flashT: ['playerfx'], swing: ['playerfx'], stepDist: ['playerfx'], bobPhase: ['playerfx'], kThrow: ['playerfx', 'kunai'],
  swayX: ['viewmodel'], swayY: ['viewmodel'],
};
{
  const bad = [];
  const ASSIGN = /\bwp\.(\w+)(?:\[[^\]]*\])?\s*(?:[-+*/]?=(?!=)|\+\+|--)|(?:\+\+|--)wp\.(\w+)|\bwp\.(\w+)\s*=\s*wp\.(\w+)\s*=/g;
  for (const f of clientFiles) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
    const mod = path.basename(f, '.js');
    for (const m of src.matchAll(ASSIGN)) for (const field of m.slice(1).filter(Boolean)) {
      if (!(field in WP_OWNERS)) bad.push(`${mod}.js 가 정해지지 않은 wp.${field} 를 쓴다`);
      else if (!WP_OWNERS[field].includes(mod)) bad.push(`wp.${field} 는 ${WP_OWNERS[field].join('·')} 만 쓴다 (${mod}.js 가 씀)`);
    }
  }
  check(bad.length === 0, 'wp 필드는 정해진 모듈만 쓴다 (다른 모듈은 읽기만)', [...new Set(bad)].slice(0, 4).join(' | '));
}

// 무기 시각 규칙 (weaponview.js)
{
  const byId = id => WEAPONS.find(w => w.id === id);
  check(wantsDot(byId('ar')) && wantsDot(byId('mp5')) && wantsDot(byId('revolver')), '기본 무기(AR·SMG·리볼버)는 도트 사이트를 달 수 있다');
  check(!wantsDot(byId('awm')) && !wantsDot(byId('knife')) && !wantsDot(byId('kunai')), '저격(스코프)·근접·쿠나이는 도트 사이트 대상이 아니다');
  check(defaultParts(byId('ar')).optic === 'reddot' && Object.keys(defaultParts(byId('awm'))).length === 0, '기본 부품: 도트 사이트 대상만 조준경을 단다');
  check(sightFor(byId('ar'), { optic: [0, 0] }) === 'dot' && sightFor(byId('ar'), {}) === 'iron' && sightFor(byId('awm'), {}) === 'scope', '조준 방식: 조준경 받침이 있으면 도트, 없으면 가늠자, 스코프 무기는 스코프');
  const wi = WEAPONS.findIndex(w => w.id === 'mp5');
  bindSight(wi, 'dot');
  check(viewOf(wi).sight === 'dot' && viewOf(wi).ads === SIGHTS.dot, 'bindSight 로 알린 조준 방식을 viewOf 가 돌려준다');
  check(Object.values(SIGHTS).every(s => ['reticle', 'crosshair', 'cameraKick', 'vmKick', 'flash', 'light', 'fireClip'].every(k => k in s)), '모든 조준 방식이 같은 항목을 갖는다 (새 방식을 추가할 때 빠뜨리지 않게)');
}

process.exit(failed() ? 1 : 0);
