// FRONTIER Studio: 게임 콘텐츠를 만드는 도구 (Unity 에디터와 비슷한 틀).
//   왼쪽 = 콘텐츠 목록 + 문서별 도구, 가운데 = 탭 + 화면(게임과 같은 코드로 그림) + 콘솔, 오른쪽 = 속성
//   문서 = 열어서 고치는 것 하나 (맵, 총 모델, 무기 목록, 파츠, 모드). 문서 종류는 docs/ 에 있다.
// 개발 서버(npm run dev)에서만 열린다. 저장하면 content/ 의 파일이 바뀌고, 그 파일을 git 으로 주고받는다.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { createMapDoc, Cancelled } from './docs/map.js';
import { createGunDoc } from './docs/gun.js';
import { createDataDoc, DATA_DOCS } from './docs/data.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// ───────── 화면 (모든 3D 문서가 같이 쓴다) ─────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// ───────── 콘솔 ─────────
let conN = 0;
function log(text, level = 'info') {
  const d = el('div', level);
  d.append(el('span', 't', new Date().toLocaleTimeString('ko-KR', { hour12: false })), document.createTextNode(text));
  $('conLog').appendChild(d); $('conLog').scrollTop = 1e9;
  while ($('conLog').children.length > 300) $('conLog').firstChild.remove();
  $('conCount').textContent = `${++conN}`;
}
$('conClear').addEventListener('click', () => { $('conLog').replaceChildren(); conN = 0; $('conCount').textContent = ''; });
$('conToggle').addEventListener('click', () => { const c = $('console').classList.toggle('closed'); $('conToggle').textContent = c ? '펼치기' : '접기'; resize(); });

let flashT = 0;
function flash(text) { const f = $('flash'); f.textContent = text; f.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { f.hidden = true; }, 2800); }

// ───────── 문서 (탭) ─────────
const docs = new Map(); // key → doc
let active = null;
const ctx = {
  canvas, renderer, log, flash,
  changed: () => { renderTabs(); renderAssets(); },
  refreshAssets: () => loadAssets(),
  openAsset: key => openAsset(key),
  play: url => startPlay(url),
  assets: () => assets,
  // 무기 데이터: 무기 문서를 열면 그 문서가 고치는 중인 값을 같이 본다 (파츠 문서의 장단점 계산 등)
  weapons: () => weaponsRef, weaponIds: () => weaponsRef.map(w => w.id), setWeapons: d => { weaponsRef = d; },
  // 저장하면서 이름(키)이 바뀐 문서 (예: 파일로 연 총 모델 → gun:<id>)
  rekey(doc, key) {
    if (doc.key === key) return;
    const old = docs.get(key); if (old && old !== doc) closeDoc(old);
    docs.delete(doc.key); doc.key = key; docs.set(key, doc);
    renderTabs(); renderAssets(); saveSession();
  },
};
let weaponsRef = WEAPONS;

const FACTORY = { map: createMapDoc, gun: createGunDoc, data: createDataDoc };
async function openAsset(key, opts = {}) {
  if (docs.has(key)) { activate(docs.get(key)); return docs.get(key); }
  const [kind, ...rest] = key.split(':'), id = rest.join(':');
  if (!FACTORY[kind]) return null;
  let doc;
  try { doc = await FACTORY[kind](ctx, id, opts); }
  catch (e) {
    if (e instanceof Cancelled) return null; // 새 맵 만들기를 취소함
    log(`열 수 없음 (${key}): ${e.message || e}`, 'error'); flash('열 수 없습니다 — 콘솔을 보세요'); return null;
  }
  if (docs.has(doc.key)) { doc.dispose(); activate(docs.get(doc.key)); return docs.get(doc.key); } // 같은 것이 이미 열려 있음
  doc.key = doc.key || key;
  for (const [part, host] of [['overlay', 'overlays'], ['tools', 'tools'], ['toolbar', 'docBar'], ['inspector', 'inspector']]) {
    doc[part].hidden = true; $(host).appendChild(doc[part]);
  }
  docs.set(doc.key, doc);
  activate(doc);
  log(`열기: ${doc.title}`);
  return doc;
}
function activate(doc) {
  if (active === doc) return;
  if (active) { active.deactivate(); for (const p of ['overlay', 'tools', 'toolbar', 'inspector']) active[p].hidden = true; }
  active = doc;
  $('empty').hidden = !!doc;
  canvas.style.visibility = doc && doc.is3D ? 'visible' : 'hidden';
  if (doc) {
    for (const p of ['overlay', 'tools', 'toolbar', 'inspector']) doc[p].hidden = false;
    doc.activate(); resize();
    // 자동 테스트용: 지금 문서의 조작 함수
    if (doc.kind === 'map') window.__ed = doc.api;
    if (doc.kind === 'gun') window.__gv = doc.api;
    if (doc.kind === 'data') window.__dd = doc.api;
  }
  renderTabs(); renderAssets(); saveSession();
}
async function closeDoc(doc) {
  if (doc.isDirty() && !confirm(`"${doc.title}" 에 저장하지 않은 내용이 있습니다. 닫을까요?`)) return;
  doc.deactivate(); doc.dispose();
  for (const p of ['overlay', 'tools', 'toolbar', 'inspector']) doc[p].remove();
  docs.delete(doc.key);
  if (active === doc) { active = null; activate([...docs.values()].at(-1) || null); }
  renderTabs(); renderAssets(); saveSession();
}
function renderTabs() {
  const bar = $('tabs'); bar.replaceChildren();
  for (const d of docs.values()) {
    const t = el('div', `tab${d === active ? ' active' : ''}`);
    t.dataset.key = d.key;
    t.append(el('span', '', `${d.icon || ''} ${d.title}`));
    if (d.isDirty()) t.append(el('span', 'dot', '●'));
    const x = el('button', 'x', '×'); x.title = '닫기'; x.addEventListener('click', e => { e.stopPropagation(); closeDoc(d); });
    t.append(x);
    t.addEventListener('click', () => activate(d));
    t.addEventListener('auxclick', e => { if (e.button === 1) closeDoc(d); });
    bar.appendChild(t);
  }
  document.title = `${active ? (active.isDirty() ? '• ' : '') + active.title + ' — ' : ''}FRONTIER Studio`;
}

// 열린 탭을 주소에 남겨 새로고침해도 다시 열리게 한다 (?open=map:warehouse,data:weapons&active=…)
function saveSession() {
  const keys = [...docs.keys()].filter(k => !k.startsWith('gun:file') && !k.startsWith('map:new'));
  const p = new URLSearchParams();
  if (keys.length) p.set('open', keys.join(','));
  if (active && keys.includes(active.key)) p.set('active', active.key);
  history.replaceState(null, '', `${location.pathname}${p.toString() ? '?' + p : ''}`);
}

// ───────── 콘텐츠 목록 ─────────
let assets = { maps: [], guns: [] };
async function loadAssets() {
  const get = u => fetch(u, { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  const [maps, guns] = await Promise.all([get('/content/maps/index.json'), get('/content/guns/index.json')]);
  assets = { maps, guns };
  renderAssets();
}
function renderAssets() {
  const box = $('assets'); box.replaceChildren();
  const section = (title, items, actions = []) => {
    const s = el('div', 'asec'), h = el('header');
    h.append(el('span', '', title), el('span', 'grow'));
    for (const [label, fn, id] of actions) { const b = el('button', '', label); if (id) b.id = id; b.addEventListener('click', fn); h.appendChild(b); }
    s.appendChild(h);
    if (!items.length) s.appendChild(el('div', 'aempty', '없음'));
    for (const [key, icon, label, small] of items) {
      const d = docs.get(key);
      const it = el('div', `aitem${d ? ' open' : ''}${d && d === active ? ' active' : ''}`);
      it.dataset.asset = key; it.title = key;
      it.append(el('i', '', icon), el('span', '', label));
      if (d && d.isDirty()) it.append(el('small', '', '●'));
      else if (small) it.append(el('small', '', small));
      it.addEventListener('click', () => openAsset(key));
      s.appendChild(it);
    }
    box.appendChild(s);
  };
  const extraMaps = [...docs.values()].filter(d => d.kind === 'map' && !assets.maps.includes(d.id)).map(d => [d.key, '▦', d.id, '새 맵']);
  section('맵', [...assets.maps.map(id => [`map:${id}`, '▦', id]), ...extraMaps], [['+ 새 맵', () => openAsset(`map:new${Date.now()}`, { create: true }), 'newMapBtn']]);
  const extraGuns = [...docs.values()].filter(d => d.kind === 'gun' && !assets.guns.includes(d.id)).map(d => [d.key, '⌐', d.title, '저장 안 함']);
  section('총 모델', [...assets.guns.map(id => [`gun:${id}`, '⌐', id]), ...extraGuns], [['.glb 열기', () => $('fileIn').click(), 'openGlbBtn'], ['예시', () => openAsset('gun:sample'), 'sampleBtn']]);
  section('게임 데이터', DATA_DOCS.map(d => [`data:${d.id}`, '≡', d.title, d.file]));
}

// .glb 파일 열기 / 끌어다 놓기
const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.glb,model/gltf-binary', hidden: true, id: 'fileIn' });
document.body.appendChild(fileIn);
async function openGlbFile(file) {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  await openAsset(`gun:file${Date.now()}`, { buffer, name: file.name });
}
fileIn.addEventListener('change', () => { openGlbFile(fileIn.files[0]); fileIn.value = ''; });
const stage = $('stage');
stage.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); $('drop').classList.add('over'); } });
stage.addEventListener('dragleave', () => $('drop').classList.remove('over'));
stage.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f && /\.glb$/i.test(f.name)) openGlbFile(f); else flash('.glb 파일만 열 수 있습니다'); });

// ───────── 저장 ─────────
async function saveAll() {
  let n = 0;
  for (const d of docs.values()) if (d.isDirty()) { if (await d.save()) n++; }
  flash(n ? `${n}개 저장했습니다` : '저장할 것이 없습니다');
  renderTabs(); renderAssets();
}
$('saveAll').addEventListener('click', saveAll);
addEventListener('beforeunload', e => { if ([...docs.values()].some(d => d.isDirty())) e.preventDefault(); });

// ───────── 시험 플레이 (화면 안에서 게임 실행) ─────────
let playing = false;
function startPlay(url) {
  if (playing) stopPlay();
  playing = true;
  $('play').hidden = false;
  $('playFrame').src = url;
  $('playFrame').focus();
  log(`시험 플레이 시작: ${url}`, 'ok');
}
function stopPlay() {
  if (!playing) return;
  playing = false;
  $('playFrame').src = 'about:blank';
  $('play').hidden = true;
  log('시험 플레이 멈춤');
  canvas.focus();
}
$('playStop').addEventListener('click', stopPlay);
addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.t === 'studio-stop') stopPlay(); });
ctx.stopPlay = stopPlay;
ctx.isPlaying = () => playing;

// ───────── 키보드: 문서로 넘긴다 ─────────
addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === 'KeyP') { e.preventDefault(); if (playing) stopPlay(); else if (active && active.play) active.play(); return; } // Unity 처럼 ⌘P = 플레이/멈춤
  if (playing) return;
  if (mod && e.code === 'KeyS') { e.preventDefault(); if (e.shiftKey) saveAll(); else if (active) active.save().then(() => { renderTabs(); renderAssets(); }); return; }
  if (mod && e.code === 'KeyW' && active) { e.preventDefault(); closeDoc(active); return; }
  if (typing) return;
  if (active && active.onKeyDown) active.onKeyDown(e);
});
addEventListener('keyup', e => { if (active && active.onKeyUp) active.onKeyUp(e); });
addEventListener('blur', () => { if (active && active.onBlur) active.onBlur(); });

// ───────── 크기 / 그리기 ─────────
function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
  if (active) active.resize(r.width, r.height);
}
new ResizeObserver(resize).observe(stage);

let lastT = performance.now();
renderer.setAnimationLoop(t => {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (active && active.is3D && !playing) active.frame(dt);
});

// ───────── 시작 ─────────
await loadAssets();
const q = new URLSearchParams(location.search);
const want = (q.get('open') || '').split(',').filter(Boolean);
if (!want.length && assets.maps.length) want.push(`map:${assets.maps[0]}`);
for (const k of want) await openAsset(k);
if (q.get('active') && docs.has(q.get('active'))) activate(docs.get(q.get('active')));
log('FRONTIER Studio 준비 완료 — 왼쪽 목록에서 열고, ⌘S 저장, ⌘P 시험 플레이', 'ok');

// 자동 테스트용
window.__studio = { openAsset, activate: key => activate(docs.get(key)), closeDoc: key => closeDoc(docs.get(key)), get active() { return active; }, docs, stopPlay, isPlaying: () => playing, saveAll };
