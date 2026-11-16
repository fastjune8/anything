// FRONTIER Studio: 게임 콘텐츠를 만드는 도구.
//   홈(허브) = 모든 데이터를 종류별로 보고 고르는 곳 (home.js)
//   편집기   = 데이터 하나를 고치는 작은 창. 탭으로 여러 개를 연다 (docs/: 맵 · 모델 · 데이터, 효과는 준비 중)
//   편집기는 모두 같은 틀: 머리(버튼) / 도구 상자 / 화면 / 속성. 도움말(help.js), 첫 실행 튜토리얼(tour.js)
// 개발 서버(npm run dev)에서만 열린다. 저장하면 content/ 의 파일이 바뀌고, 그 파일을 git 으로 주고받는다.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { createMapDoc, Cancelled } from './docs/map.js';
import { createGunDoc } from './docs/gun.js';
import { createDataDoc } from './docs/data.js';
import { createHome, EDITORS } from './home.js';
import { createHelp } from './help.js';
import { createTour } from './tour.js';
import { initSplitters } from './split.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// ───────── 화면 (모든 3D 편집기가 같이 쓴다) ─────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// ───────── 상태 막대 + 콘솔 ─────────
let conN = 0;
function log(text, level = 'info') {
  const d = el('div', level);
  d.append(el('span', 't', new Date().toLocaleTimeString('ko-KR', { hour12: false })), document.createTextNode(text));
  $('conLog').appendChild(d); $('conLog').scrollTop = 1e9;
  while ($('conLog').children.length > 300) $('conLog').firstChild.remove();
  $('conCount').textContent = `(${++conN})`;
  $('lastLog').textContent = text; $('lastLog').className = level;
}
$('conToggle').addEventListener('click', () => { const shut = $('console').classList.toggle('closed'); $('conSplit').hidden = shut; resize(); });
initSplitters(); // 패널 경계선을 끌어 크기 조절
$('conClear').addEventListener('click', () => { $('conLog').replaceChildren(); conN = 0; $('conCount').textContent = ''; $('lastLog').textContent = ''; });

let flashT = 0;
function flash(text) { const f = $('flash'); f.textContent = text; f.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { f.hidden = true; }, 2800); }

// ───────── 문서 (편집기 탭) ─────────
const docs = new Map(); // key → 편집기 문서
let active = null;      // null = 홈
let weaponsDoc = null; // 열려 있는 무기 데이터 문서가 고치는 중인 값 (없으면 홈이 읽은 최신 파일)
const ctx = {
  canvas, renderer, log, flash,
  changed: () => { renderTabs(); home.render(); },
  refreshAssets: async () => { await home.load(); await ctx.dataChanged('weapons'); },
  openAsset: (key, opts) => openAsset(key, opts),
  play: url => startPlay(url),
  docs: () => docs,
  assets: () => ({ maps: home.data.maps.map(m => m.id), guns: home.data.models.map(m => m.id) }),
  // 무기 데이터: 무기 문서를 열면 그 문서가 고치는 중인 값을 같이 본다 (파츠 장단점 계산 등)
  weapons: () => weaponsDoc || (home.data.weapons.length ? home.data.weapons : WEAPONS), weaponIds: () => ctx.weapons().map(w => w.id), setWeapons: d => { weaponsDoc = d; },
  registry: () => home.data.registry, // 데이터로 등록된 모델
  // 다른 곳(예: 모델 등록)에서 데이터 파일이 바뀌었을 때: 열린 데이터 문서가 고친 게 없으면 다시 읽는다
  async dataChanged(id) { const d = docs.get(`data:${id}`); if (d && d.reload) await d.reload(); },
  // 저장하면서 이름(키)이 바뀐 문서 (예: 파일로 연 모델 → gun:<id>)
  rekey(doc, key) {
    if (doc.key === key) return;
    const old = docs.get(key); if (old && old !== doc) closeDoc(old, true);
    docs.delete(doc.key); doc.key = key; docs.set(key, doc);
    renderTabs(); saveSession(); showEditorHead();
  },
};
// 문서 종류 → [만드는 함수, 편집기]
const FACTORY = { map: [createMapDoc, 'map'], gun: [createGunDoc, 'model'], data: [createDataDoc, 'data'] };

async function openAsset(key, opts = {}) {
  let doc = docs.get(key);
  if (!doc) {
    const [kind, ...rest] = key.split(':'), id = rest.join(':');
    if (!FACTORY[kind]) return null;
    try { doc = await FACTORY[kind][0](ctx, id, opts); }
    catch (e) {
      if (e instanceof Cancelled) return null; // 새 맵 만들기를 취소함
      log(`열 수 없음 (${key}): ${e.message || e}`, 'error'); flash('열 수 없습니다 — 아래 콘솔을 보세요'); return null;
    }
    doc.key = doc.key || key; doc.editor = FACTORY[kind][1];
    if (docs.has(doc.key)) { doc.dispose(); doc = docs.get(doc.key); }
    else {
      for (const [part, host] of [['overlay', 'overlays'], ['tools', 'toolbox'], ['toolbar', 'edBar'], ['inspector', 'inspector']]) { doc[part].hidden = true; $(host).appendChild(doc[part]); }
      docs.set(doc.key, doc);
      log(`열기: ${EDITORS[doc.editor].name} — ${doc.title}`);
    }
  }
  activate(doc);
  if (doc.focus && (opts.select || opts.slot)) doc.focus(opts);
  return doc;
}
function activate(doc) {
  if (active === doc && doc) return;
  if (active) { active.deactivate(); for (const p of ['overlay', 'tools', 'toolbar', 'inspector']) active[p].hidden = true; }
  active = doc;
  $('home').hidden = !!doc; $('editor').hidden = !doc;
  if (doc) {
    for (const p of ['overlay', 'tools', 'toolbar', 'inspector']) doc[p].hidden = false;
    canvas.style.visibility = doc.is3D ? 'visible' : 'hidden';
    showEditorHead(); doc.activate(); resize();
    if (doc.kind === 'map') window.__ed = doc.api; // 자동 테스트용
    if (doc.kind === 'gun') window.__gv = doc.api;
    if (doc.kind === 'data') window.__dd = doc.api;
  } else home.render();
  renderTabs(); saveSession();
}
function showEditorHead() { if (!active) return; const e = EDITORS[active.editor]; $('edKind').textContent = `${e.icon} ${e.name}`; $('edTitle').textContent = active.title; }
async function closeDoc(doc, force) {
  if (!force && doc.isDirty() && !confirm(`"${doc.title}" 에 저장하지 않은 내용이 있습니다. 닫을까요?`)) return;
  if (active === doc) activate(null);
  doc.deactivate(); doc.dispose();
  for (const p of ['overlay', 'tools', 'toolbar', 'inspector']) doc[p].remove();
  docs.delete(doc.key);
  renderTabs(); home.render(); saveSession();
}

// 위쪽 탭: 홈 + 열린 편집기
function renderTabs() {
  const bar = $('tabs'); bar.replaceChildren();
  const h = el('div', `tab home${active ? '' : ' active'}`); h.append(el('span', '', '⌂ 홈')); h.addEventListener('click', () => activate(null)); bar.appendChild(h);
  for (const d of docs.values()) {
    const t = el('div', `tab${d === active ? ' active' : ''}`); t.dataset.key = d.key;
    t.append(el('span', 'k', EDITORS[d.editor].icon), el('span', '', d.title));
    if (d.isDirty()) t.append(el('span', 'dot', '●'));
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = '닫기 (⌘W)'; x.addEventListener('click', e => { e.stopPropagation(); closeDoc(d); });
    t.append(x);
    t.addEventListener('click', () => activate(d));
    t.addEventListener('auxclick', e => { if (e.button === 1) closeDoc(d); });
    bar.appendChild(t);
  }
  const n = [...docs.values()].filter(d => d.isDirty()).length;
  $('unsaved').hidden = !n; $('unsaved').textContent = `저장 안 됨 ${n}`;
  if (active) showEditorHead();
  document.title = `${n ? '• ' : ''}${active ? active.title + ' — ' : ''}FRONTIER Studio`;
}

// 열린 탭을 주소에 남겨 새로고침해도 다시 열리게 한다 (?open=map:warehouse,data:weapons&active=…)
function saveSession() {
  const keys = [...docs.keys()].filter(k => !k.startsWith('gun:file') && !k.startsWith('map:new'));
  const p = new URLSearchParams(location.search);
  p.delete('open'); p.delete('active');
  if (keys.length) p.set('open', keys.join(','));
  if (active && keys.includes(active.key)) p.set('active', active.key);
  history.replaceState(null, '', `${location.pathname}${p.toString() ? '?' + p : ''}`);
}

// ───────── .glb 열기 / 끌어다 놓기 ─────────
async function openGlbFile(file) {
  if (!file) return;
  await openAsset(`gun:file${Date.now()}`, { buffer: await file.arrayBuffer(), name: file.name });
}
$('fileIn').addEventListener('change', () => { openGlbFile($('fileIn').files[0]); $('fileIn').value = ''; });
const main = $('main');
main.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); $('drop').classList.add('over'); } });
main.addEventListener('dragleave', e => { if (!main.contains(e.relatedTarget)) $('drop').classList.remove('over'); });
main.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f && /\.glb$/i.test(f.name)) openGlbFile(f); else flash('.glb 파일만 열 수 있습니다'); });

// ───────── 저장 ─────────
async function saveAll() {
  let n = 0;
  for (const d of docs.values()) if (d.isDirty() && await d.save()) n++;
  flash(n ? `${n}개 저장했습니다` : '저장할 것이 없습니다');
  renderTabs(); home.render();
}
$('saveAll').addEventListener('click', saveAll);
addEventListener('beforeunload', e => { if ([...docs.values()].some(d => d.isDirty())) e.preventDefault(); });

// ───────── 시험 플레이 (화면 안에서 게임 실행) ─────────
let playing = false;
function startPlay(url) {
  if (playing) stopPlay();
  playing = true;
  $('play').hidden = false; $('playFrame').src = url; $('playFrame').focus();
  log('시험 플레이 시작', 'ok');
}
function stopPlay() {
  if (!playing) return;
  playing = false;
  $('playFrame').src = 'about:blank'; $('play').hidden = true;
  log('시험 플레이 멈춤');
}
$('playStop').addEventListener('click', stopPlay);
addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.t === 'studio-stop') stopPlay(); });

// ───────── 키보드: 공통 단축키는 여기서, 나머지는 편집기로 ─────────
let help, tour; // 아래 시작 부분에서 만든다
addEventListener('keydown', e => {
  if (tour && tour.running) { if (e.key === 'Escape') tour.end(); return; }
  if (help && help.isOpen) { if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); help.close(); } return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'F1' || (!typing && !mod && e.key === '?')) { e.preventDefault(); help.open(active ? active.editor : 'common'); return; }
  if (mod && e.code === 'KeyP') { e.preventDefault(); if (playing) stopPlay(); else if (active && active.play) active.play(); return; } // Unity 처럼 ⌘P = 플레이/멈춤
  if (playing) return;
  if (mod && e.code === 'KeyS') { e.preventDefault(); if (e.shiftKey) saveAll(); else if (active) active.save().then(() => { renderTabs(); home.render(); }); return; }
  if (mod && e.code === 'KeyW' && active) { e.preventDefault(); closeDoc(active); return; }
  if (typing) return;
  if (active && active.onKeyDown) active.onKeyDown(e);
});
addEventListener('keyup', e => { if (active && active.onKeyUp) active.onKeyUp(e); });
addEventListener('blur', () => { if (active && active.onBlur) active.onBlur(); });

// ───────── 크기 / 그리기 ─────────
const stage = $('stage');
function resize() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  if (active) active.resize(r.width, r.height);
}
new ResizeObserver(resize).observe(stage);
let lastT = performance.now();
renderer.setAnimationLoop(t => {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (active && active.is3D && !playing) active.frame(dt);
});

// ───────── 업데이트 알림: GitHub 에 새 버전이 있으면 위쪽에 띠 (10분마다 확인) ─────────
let updateDismissed = false;
async function checkUpdate() {
  const v = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  if (!v || !v.ok || !(v.behind > 0) || updateDismissed) return;
  $('update').querySelector('[data-r="msg"]').textContent = `(커밋 ${v.behind}개 · 최근: ${v.latest})${v.localChanges ? ' — 내가 고친 코드가 있으면 먼저 커밋하세요.' : ''}`;
  $('update').hidden = false;
  log(`새 버전 ${v.behind}개가 GitHub 에 있습니다 — git pull 후 새로고침`, 'warn');
}
$('updateClose').addEventListener('click', () => { updateDismissed = true; $('update').hidden = true; });

// ───────── 시작 ─────────
const home = createHome(ctx);
help = createHelp({ onTour: () => tour.start() });
tour = createTour({
  goHome: () => activate(null),
  selectFirst: () => { const m = home.data.maps[0]; home.setCat('maps', m ? `map:${m.id}` : null); },
  openFirstMap: async () => { const m = home.data.maps[0]; if (m) await openAsset(`map:${m.id}`); },
});
$('helpBtn').addEventListener('click', () => help.open(active ? active.editor : 'common'));
await home.load();
renderTabs();
const q = new URLSearchParams(location.search);
for (const k of (q.get('open') || '').split(',').filter(Boolean)) await openAsset(k);
activate(q.get('active') && docs.has(q.get('active')) ? docs.get(q.get('active')) : null);
log('FRONTIER Studio 준비 완료 — 홈에서 데이터를 고르고, 두 번 누르면 편집기가 열립니다. 도움말은 ? (F1)', 'ok');
checkUpdate(); setInterval(checkUpdate, 10 * 60 * 1000);
if (!q.has('notour')) tour.startIfNew();

// 자동 테스트용
window.__studio = { openAsset, activate: key => activate(key ? docs.get(key) : null), closeDoc: key => closeDoc(docs.get(key)), get active() { return active; }, docs, stopPlay, isPlaying: () => playing, saveAll, home, help, tour };
