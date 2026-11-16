// FRONTIER 맵 에디터: content/maps/*.json 을 고친다.
// 게임과 같은 코드(shared/maps/build.js 로 펼치고 client/js/world.js 로 그림)를 쓰므로 보이는 그대로 게임에 나온다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from '/js/world.js';
import { expandObject, buildLayout } from '/shared/maps/build.js';
import { OBJECT_SCHEMAS, objectSpec, ZONE, checkMap } from '/shared/content/schema.js';
import { MODES } from '/shared/modes.js';
import { buildForm } from './form.js';

const $ = id => document.getElementById(id);
const r2 = v => Math.round(v * 100) / 100;
const GRID = 0.5;
const TEAM_COLOR = { '-1': 0xe9ecef, 0: 0x5aa9ff, 1: 0xff4b3a };
const TEAM_NAME = { '-1': '개인전 스폰', 0: '0팀 스폰', 1: '1팀 스폰' };

// ───────── 상태 ─────────
let map = null;            // 고치는 중인 맵 데이터
let mapIds = [];
let sel = null;            // { kind: 'obj', i } | { kind: 'spawn', team, i } | { kind: 'zone', i } | null(맵 설정)
let tool = null;           // 배치 도구: { kind: 'obj', type } | { kind: 'spawn', team } | { kind: 'zone' } | null(선택)
let saved = '';            // 마지막으로 저장한(불러온) 내용
let snap = '';             // 되돌리기 기준 (마지막 확정 상태)
const undoStack = [], redoStack = [];

// ───────── 3D ─────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;
const scene = new THREE.Scene();
const world = buildWorld(scene, renderer);
scene.fog.density = 0.0015; // 위에서 내려다보므로 안개를 옅게
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
camera.position.set(0, 80, 70);
const controls = new OrbitControls(camera, canvas);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }; // 왼쪽 = 선택/이동/배치, 오른쪽 = 회전(Shift = 이동), 휠 = 확대
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.screenSpacePanning = false;

const pickGroup = new THREE.Group(), markGroup = new THREE.Group(), selGroup = new THREE.Group(), helpGroup = new THREE.Group();
scene.add(pickGroup, markGroup, selGroup, helpGroup);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const pickMat = new THREE.MeshBasicMaterial({ visible: false });
const edgeGeo = new THREE.EdgesGeometry(unitBox);
const selMat = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true });
const selMirrorMat = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true, opacity: 0.35 });

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 바닥 격자와 맵 경계
function drawHelpers() {
  for (const c of [...helpGroup.children]) { helpGroup.remove(c); c.geometry && c.geometry.dispose(); }
  const size = map.half * 2;
  const g1 = new THREE.GridHelper(size, Math.round(size), 0x000000, 0x000000); g1.material.opacity = 0.08; g1.material.transparent = true; g1.position.y = 0.02;
  const g5 = new THREE.GridHelper(size, Math.round(size / 5), 0x000000, 0x000000); g5.material.opacity = 0.2; g5.material.transparent = true; g5.position.y = 0.03;
  const h = map.half, pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => new THREE.Vector3(x, 0.05, z));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb43a }));
  helpGroup.add(g1, g5, edge);
}

// 맵 전체를 다시 그린다 (박스 수백 개라 매번 새로 만들어도 충분히 빠르다)
let rebuildQueued = false;
function rebuild() { if (!rebuildQueued) { rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuildNow(); }); } }
function rebuildNow() {
  world.setMap(buildLayout(map));
  for (const c of [...pickGroup.children]) pickGroup.remove(c);
  map.objects.forEach((o, i) => {
    const { boxes, trees } = expandObject(o);
    boxes.forEach((b, k) => {
      const m = new THREE.Mesh(unitBox, pickMat);
      m.scale.set(b.w, b.h, b.d); m.position.set(b.x, b.y + b.h / 2, b.z);
      m.userData = { kind: 'obj', i, mirror: !!o.sym && k >= boxes.length / 2 };
      pickGroup.add(m);
    });
    trees.forEach((t, k) => {
      const m = new THREE.Mesh(unitBox, pickMat);
      m.scale.set(1.2 * t.s, 5 * t.s, 1.2 * t.s); m.position.set(t.x, 2.5 * t.s, t.z);
      m.userData = { kind: 'obj', i, mirror: !!o.sym && k >= trees.length / 2 };
      pickGroup.add(m);
    });
  });
  drawMarkers(); drawSelection(); validate(); updateTitle();
}

// 스폰 지점(기둥)과 거점(원)
function drawMarkers() {
  for (const c of [...markGroup.children]) { markGroup.remove(c); c.geometry && c.geometry.dispose(); }
  const spawnGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.8, 16);
  const add = (list, team) => (list || []).forEach(([x, z], i) => {
    const m = new THREE.Mesh(spawnGeo, new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.85 }));
    m.position.set(x, 0.9, z); m.userData = { kind: 'spawn', team, i };
    markGroup.add(m);
  });
  add(map.spawns.ffa, -1);
  (map.spawns.team || []).forEach((list, t) => add(list, t));
  (map.zones || []).forEach((zn, i) => {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(zn.r, zn.r, 0.3, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    disc.position.set(zn.x, 0.15, zn.z); disc.userData = { kind: 'zone', i };
    const ring = new THREE.Mesh(new THREE.RingGeometry(zn.r - 0.15, zn.r, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(zn.x, 0.32, zn.z); ring.userData = { kind: 'zone', i };
    markGroup.add(disc, ring);
  });
}

function drawSelection() {
  for (const c of [...selGroup.children]) selGroup.remove(c);
  if (!sel) return;
  if (sel.kind === 'obj') {
    for (const m of pickGroup.children) {
      if (m.userData.i !== sel.i) continue;
      const l = new THREE.LineSegments(edgeGeo, m.userData.mirror ? selMirrorMat : selMat);
      l.scale.copy(m.scale).multiplyScalar(1.01); l.position.copy(m.position); l.renderOrder = 10;
      selGroup.add(l);
    }
  } else {
    for (const m of markGroup.children) {
      const u = m.userData;
      if (u.kind === sel.kind && u.i === sel.i && (sel.kind !== 'spawn' || u.team === sel.team)) {
        const l = new THREE.BoxHelper(m, 0xffd23a); l.material.depthTest = false; l.renderOrder = 10; selGroup.add(l);
      }
    }
  }
}

// ───────── 고치기 / 되돌리기 ─────────
const isDirty = () => JSON.stringify(map) !== saved;
// 한 번의 고침이 끝났을 때 (끌기를 놓음, 칸 입력 완료, 추가/삭제)
function commit() {
  const now = JSON.stringify(map);
  if (now === snap) return;
  undoStack.push(snap); if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0; snap = now;
  updateTitle();
}
function restore(text) {
  map = JSON.parse(text); snap = text;
  if (sel && !selected()) sel = null;
  rebuildNow(); drawHelpers(); renderPanel();
}
function undo() { if (undoStack.length) { redoStack.push(snap); restore(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(snap); restore(redoStack.pop()); } }

// 선택한 것의 실제 데이터
function selected() {
  if (!sel) return null;
  if (sel.kind === 'obj') return map.objects[sel.i] || null;
  if (sel.kind === 'zone') return (map.zones || [])[sel.i] || null;
  if (sel.kind === 'spawn') { const list = sel.team < 0 ? map.spawns.ffa : (map.spawns.team || [])[sel.team]; return (list && list[sel.i]) || null; }
  return null;
}
function spawnList(team) {
  if (team < 0) return map.spawns.ffa;
  if (!map.spawns.team) map.spawns.team = [[], []];
  return map.spawns.team[team];
}

// 옮기기: orig(옮기기 시작할 때의 복사본) 에서 (dx, dz) 만큼
function moveTo(orig, dx, dz) {
  if (sel.kind === 'spawn') { const list = spawnList(sel.team); list[sel.i] = [r2(orig[0] + dx), r2(orig[1] + dz)]; return; }
  const o = selected();
  if (o.type === 'wall') {
    const along = (o.axis || 'x') === 'x' ? dx : dz, across = (o.axis || 'x') === 'x' ? dz : dx;
    o.from = r2(orig.from + along); o.to = r2(orig.to + along); o.at = r2(orig.at + across);
    o.ops = (orig.ops || []).map(op => ({ ...op, at: r2(op.at + along) }));
    return;
  }
  o.x = r2(orig.x + dx); o.z = r2(orig.z + dz);
  if (o.type === 'building' && orig.ops) { // 건물의 문·창문 위치는 절대 좌표라 같이 옮긴다
    o.ops = {};
    for (const [side, list] of Object.entries(orig.ops)) o.ops[side] = (list || []).map(op => ({ ...op, at: r2(op.at + (side === 'n' || side === 's' ? dx : dz)) }));
  }
}

// 새로 놓을 물체의 기본값
function newObject(type, x, z) {
  const base = { type };
  switch (type) {
    case 'box': return { ...base, x, y: 0, z, w: 2, h: 2, d: 2, mat: 'concrete' };
    case 'wall': return { ...base, axis: 'x', at: z, from: r2(x - 4), to: r2(x + 4), h: 2.8, t: 0.35, mat: 'brick', ops: [] };
    case 'building': return { ...base, x, z, w: 8, d: 6, h: 3, mat: 'brick', roof: true, ops: { n: [], s: [{ at: x, w: 1.6, type: 'door' }], e: [], w: [] } };
    case 'container': return { ...base, x, z, axis: 'x', tint: '#2f5d8a' };
    case 'crate': return { ...base, x, z, s: 1.2 };
    case 'sandbags': return { ...base, x, z, len: 4, axis: 'x' };
    case 'barrier': return { ...base, x, z, axis: 'x' };
    case 'barrel': return { ...base, x, z, tint: '#7a2a1e' };
    case 'tree': return { ...base, x, z, s: 1 };
    default: return { ...base, x, z };
  }
}

function place(x, z) {
  if (tool.kind === 'obj') { map.objects.push(newObject(tool.type, x, z)); sel = { kind: 'obj', i: map.objects.length - 1 }; }
  else if (tool.kind === 'spawn') { const list = spawnList(tool.team); list.push([x, z]); sel = { kind: 'spawn', team: tool.team, i: list.length - 1 }; }
  else if (tool.kind === 'zone') {
    if (!map.zones) map.zones = [];
    const ids = new Set(map.zones.map(zn => zn.id));
    const id = 'ABCDEFGH'.split('').find(c => !ids.has(c)) || `Z${map.zones.length}`;
    map.zones.push({ id, name: `거점 ${id}`, x, z, r: 6 }); sel = { kind: 'zone', i: map.zones.length - 1 };
  }
  rebuildNow(); commit(); renderPanel();
}

function removeSelected() {
  if (!sel) return;
  if (sel.kind === 'obj') map.objects.splice(sel.i, 1);
  else if (sel.kind === 'zone') map.zones.splice(sel.i, 1);
  else if (sel.kind === 'spawn') spawnList(sel.team).splice(sel.i, 1);
  sel = null; rebuildNow(); commit(); renderPanel();
}
function duplicateSelected() {
  if (!sel || sel.kind !== 'obj') return;
  const copy = JSON.parse(JSON.stringify(selected()));
  map.objects.push(copy); sel = { kind: 'obj', i: map.objects.length - 1 };
  moveTo(JSON.parse(JSON.stringify(copy)), 2, 2);
  rebuildNow(); commit(); renderPanel();
}
function rotateSelected() {
  const o = sel && sel.kind === 'obj' ? selected() : null;
  if (!o) return;
  const rot = ((o.rot || 0) + 90) % 360;
  if (rot) o.rot = rot; else delete o.rot;
  rebuildNow(); commit(); renderPanel();
}

// ───────── 마우스 ─────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function aim(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function groundPoint(e, snap = !e.altKey) {
  aim(e);
  if (!ray.ray.intersectPlane(ground, hit)) return null;
  const s = v => (snap ? Math.round(v / GRID) * GRID : r2(v));
  return [s(hit.x), s(hit.z)];
}
function pick(e) {
  aim(e);
  const m = ray.intersectObjects(markGroup.children, false)[0] || ray.intersectObjects(pickGroup.children, false)[0];
  return m ? m.object.userData : null;
}

let drag = null; // { start: [x, z], orig, mirror, moved }
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const p = groundPoint(e);
  if (tool) { if (p) place(p[0], p[1]); if (!e.shiftKey) setTool(null); return; } // Shift 를 누르고 있으면 계속 놓기
  const u = pick(e);
  sel = u ? (u.kind === 'spawn' ? { kind: 'spawn', team: u.team, i: u.i } : { kind: u.kind, i: u.i }) : null;
  drawSelection(); renderPanel();
  if (u && p) drag = { start: p, orig: JSON.parse(JSON.stringify(selected())), mirror: !!u.mirror, moved: false };
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = groundPoint(e);
  if (!p) return;
  let dx = p[0] - drag.start[0], dz = p[1] - drag.start[1];
  if (drag.mirror) { dx = -dx; dz = -dz; } // 대칭 복사본을 끌면 원본은 반대로 움직인다
  if (!dx && !dz && !drag.moved) return;
  drag.moved = true;
  moveTo(drag.orig, dx, dz); rebuild();
});
canvas.addEventListener('pointerup', () => { if (drag && drag.moved) { commit(); renderPanel(); } drag = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ───────── 키보드 ─────────
addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
  if (e.key === 'r' || e.key === 'R') rotateSelected();
  if (e.key === 'Escape') { setTool(null); sel = null; drawSelection(); renderPanel(); }
  if (e.key === 't' || e.key === 'T') topView();
  if (e.key === 'f' || e.key === 'F') focusSelected();
});

function topView() { camera.position.set(controls.target.x, map.half * 2.2, controls.target.z + 0.01); }
function focusSelected() {
  const m = selGroup.children[0];
  if (!m) return;
  const d = camera.position.clone().sub(controls.target);
  controls.target.set(m.position.x, 0, m.position.z);
  camera.position.copy(controls.target).add(d.setLength(Math.min(d.length(), 30)));
}

// ───────── 화면: 도구 / 속성 / 검사 ─────────
function setTool(t) {
  tool = t;
  for (const b of document.querySelectorAll('#palette button')) b.classList.toggle('on', !!t && b.dataset.tool === toolKey(t));
  canvas.style.cursor = t ? 'crosshair' : 'default';
  $('hintTool').textContent = t ? '바닥을 클릭해 놓기 · Shift+클릭 = 계속 놓기 · Esc = 취소' : '';
}
const toolKey = t => (t.kind === 'obj' ? `obj:${t.type}` : t.kind === 'spawn' ? `spawn:${t.team}` : 'zone');

function buildPalette() {
  const pal = $('palette');
  const group = (title, items) => {
    pal.appendChild(Object.assign(document.createElement('h3'), { textContent: title }));
    for (const [label, t] of items) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.tool = toolKey(t);
      b.addEventListener('click', () => setTool(tool && toolKey(tool) === toolKey(t) ? null : t));
      pal.appendChild(b);
    }
  };
  group('물체', Object.entries(OBJECT_SCHEMAS).map(([type, s]) => [s.label, { kind: 'obj', type }]));
  group('스폰 지점', [['개인전', { kind: 'spawn', team: -1 }], ['0팀 (파랑)', { kind: 'spawn', team: 0 }], ['1팀 (빨강)', { kind: 'spawn', team: 1 }]]);
  group('모드', [['거점 (점령전)', { kind: 'zone' }]]);
}

const MAP_FIELDS = { fields: { name: { kind: 'str', label: '이름' }, half: { kind: 'num', label: '맵 절반 크기 (m)', min: 10, max: 250, step: 1, hint: '외곽 벽은 따로 옮겨야 한다' } } };
function renderPanel() {
  const panel = $('props');
  panel.replaceChildren();
  const h = { onInput: () => rebuild(), onCommit: () => { commit(); renderPanel(); } };
  const title = t => panel.appendChild(Object.assign(document.createElement('h2'), { textContent: t }));
  const btns = list => {
    const d = document.createElement('div'); d.className = 'btns';
    for (const [label, fn, cls] of list) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); d.appendChild(b); }
    panel.appendChild(d);
  };
  const o = selected();
  if (!o) {
    title(`맵 설정 · ${map.id}`);
    buildForm(panel, MAP_FIELDS, map, { ...h, onInput: () => { rebuild(); drawHelpers(); } });
    const n = map.objects.length, sp = map.spawns.ffa.length, tm = (map.spawns.team || []).map(l => l.length).join(' / ') || '없음';
    panel.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: `물체 ${n}개 · 개인전 스폰 ${sp}곳 · 팀 스폰 ${tm} · 거점 ${(map.zones || []).length}개` }));
    panel.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: '물체를 클릭하면 여기서 고칠 수 있습니다.' }));
    return;
  }
  if (sel.kind === 'obj') {
    title(`${OBJECT_SCHEMAS[o.type].label} #${sel.i}`);
    buildForm(panel, objectSpec(o.type), o, { ...h, skip: ['type'] });
    btns([['회전 (R)', rotateSelected], ['복제 (⌘D)', duplicateSelected], ['삭제 (Del)', removeSelected, 'danger']]);
  } else if (sel.kind === 'zone') {
    title(`거점 ${o.id}`);
    buildForm(panel, ZONE, o, h);
    btns([['삭제 (Del)', removeSelected, 'danger']]);
  } else {
    title(`${TEAM_NAME[sel.team]} #${sel.i}`);
    const holder = { p: o };
    buildForm(panel, { fields: { p: { kind: 'point', label: '위치 [x, z]' } } }, holder, { ...h, onInput: () => { spawnList(sel.team)[sel.i] = holder.p; rebuild(); } });
    btns([['삭제 (Del)', removeSelected, 'danger']]);
  }
}

let lastErrors = [];
function validate() {
  lastErrors = checkMap(map);
  const box = $('errors');
  box.replaceChildren(...lastErrors.slice(0, 8).map(t => Object.assign(document.createElement('div'), { textContent: t })));
  if (lastErrors.length > 8) box.appendChild(Object.assign(document.createElement('div'), { textContent: `… 외 ${lastErrors.length - 8}건` }));
  box.hidden = !lastErrors.length;
  $('save').disabled = !!lastErrors.length;
}
function updateTitle() {
  const d = isDirty();
  $('status').textContent = d ? '저장 안 됨' : '저장됨';
  $('status').className = d ? 'dirty' : '';
  document.title = `${d ? '• ' : ''}${map.name} — FRONTIER 맵 에디터`;
}

// ───────── 불러오기 / 저장 / 시험 플레이 ─────────
async function loadMapList() {
  mapIds = await (await fetch('/content/maps/index.json', { cache: 'no-store' })).json();
  const s = $('mapSel'); s.replaceChildren(...mapIds.map(id => new Option(id, id)));
}
async function openMap(id) {
  if (map && isDirty() && !confirm('저장하지 않은 내용이 있습니다. 버리고 다른 맵을 열까요?')) { $('mapSel').value = map.id; return; }
  const text = await (await fetch(`/content/maps/${id}.json`, { cache: 'no-store' })).text();
  map = JSON.parse(text); map.zones = map.zones || [];
  saved = snap = JSON.stringify(map); undoStack.length = redoStack.length = 0;
  sel = null; $('mapSel').value = id;
  const p = new URLSearchParams(location.search); p.set('map', id); history.replaceState(null, '', `?${p}`);
  rebuildNow(); drawHelpers(); renderPanel();
  controls.target.set(0, 0, 0); camera.position.set(0, map.half * 1.3, map.half * 1.15);
}

async function save() {
  if (lastErrors.length) { flash('검사 오류가 있어 저장할 수 없습니다'); return false; }
  const res = await fetch(`/api/maps/${map.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(map) });
  const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
  if (!out.ok) { flash('저장 실패: ' + (out.errors || []).join(' / ')); return false; }
  saved = JSON.stringify(map); updateTitle();
  if (out.isNew) { await loadMapList(); $('mapSel').value = map.id; }
  flash(out.isNew ? '새 맵을 저장했습니다' : '저장했습니다');
  return true;
}

async function play() {
  if (isDirty() && !(await save())) return;
  const mode = $('playMode').value, bots = $('playBots').checked ? 1 : 0;
  window.open(`/?auto=${encodeURIComponent('맵시험')}&mode=${mode}&map=${map.id}&bots=${bots}`, '_blank');
}

function newMap() {
  const id = (prompt('새 맵 id (영문 소문자·숫자·_, 파일 이름이 됩니다)') || '').trim();
  if (!id) return;
  if (!/^[a-z0-9_]+$/.test(id)) { alert('영문 소문자, 숫자, _ 만 쓸 수 있습니다.'); return; }
  if (mapIds.includes(id)) { alert('이미 있는 id 입니다.'); return; }
  if (map && isDirty() && !confirm('저장하지 않은 내용이 있습니다. 버리고 새 맵을 만들까요?')) return;
  const name = (prompt('맵 이름', id) || id).trim();
  const h = 40, wall = (x, z, w, d) => ({ type: 'box', x, y: 0, z, w, h: 4.5, d, mat: 'concrete' });
  map = {
    id, name, half: h,
    spawns: { ffa: [[-30, -30], [30, 30], [-30, 30], [30, -30]], team: [[[-4, 34], [0, 35], [4, 34]], [[-4, -34], [0, -35], [4, -34]]] },
    zones: [{ id: 'A', name: '거점 A', x: 0, z: 0, r: 6 }],
    objects: [wall(0, -h - 0.5, 2 * h + 2, 1), wall(0, h + 0.5, 2 * h + 2, 1), wall(-h - 0.5, 0, 1, 2 * h), wall(h + 0.5, 0, 1, 2 * h)],
  };
  saved = ''; snap = JSON.stringify(map); undoStack.length = redoStack.length = 0; sel = null;
  if (![...$('mapSel').options].some(o => o.value === id)) $('mapSel').appendChild(new Option(`${id} (새 맵)`, id));
  $('mapSel').value = id;
  rebuildNow(); drawHelpers(); renderPanel();
  controls.target.set(0, 0, 0); camera.position.set(0, h * 1.3, h * 1.15);
}

let flashT = 0;
function flash(text) { const f = $('flash'); f.textContent = text; f.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { f.hidden = true; }, 2600); }

// ───────── 시작 ─────────
$('mapSel').addEventListener('change', () => openMap($('mapSel').value));
$('newMap').addEventListener('click', newMap);
$('save').addEventListener('click', save);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('top').addEventListener('click', topView);
$('play').addEventListener('click', play);
for (const m of Object.values(MODES)) $('playMode').appendChild(new Option(m.name, m.id));
addEventListener('beforeunload', e => { if (map && isDirty()) e.preventDefault(); });

buildPalette();
resize();
await loadMapList();
await openMap(new URLSearchParams(location.search).get('map') || mapIds[0]);

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// 자동 테스트용
window.__ed = { get map() { return map; }, get sel() { return sel; }, get errors() { return lastErrors; }, isDirty, save, undo, redo, setTool, place, select: s => { sel = s; drawSelection(); renderPanel(); }, moveTo: (dx, dz) => { moveTo(JSON.parse(JSON.stringify(selected())), dx, dz); rebuildNow(); commit(); renderPanel(); }, removeSelected, rotateSelected, duplicateSelected, rebuildNow, openMap };
