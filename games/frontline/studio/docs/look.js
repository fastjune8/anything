// 분위기 문서: content/looks.json 을 고친다 (빛·하늘·안개 + 맵 물체 재질 10종).
// 가운데 = 견본 장면 (모든 재질 + 벽·건물·컨테이너·경사로·발판·나무·병사). 고치는 대로 바로 다시 그린다.
// 왼쪽 = 분위기 목록 + 재질 목록, 오른쪽 = 고른 분위기(또는 재질)의 입력 칸. 장면의 물체를 클릭하면 그 재질로 간다.
// 저장하면 열린 맵 에디터도 바로 새 분위기로 바뀌고, 게임은 다시 들어가면 바뀐다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from '/js/world.js';
import { buildSoldier } from '/js/guns.js';
import { buildLayout, expandObject } from '/shared/maps/build.js';
import { LOOK_SCHEMA, LOOK_MATERIALS, checkLooks } from '/shared/content/schema.js';
import { buildForm } from '../form.js';
import { formDialog } from '../dialog.js';
import { el, clone, saveContent } from '../util.js';

export const MAT_NAMES = { ground: '땅', concrete: '콘크리트', concreteDark: '어두운 콘크리트', brick: '벽돌', container: '컨테이너', crate: '상자', wood: '나무판', sandbag: '모래주머니', metal: '금속', barrel: '드럼통' };
const MAT_SPEC = LOOK_SCHEMA.fields.materials.of;

// 견본 장면: 재질 견본 줄 + 실제 맵에 나오는 물체들
const SWATCHES = LOOK_MATERIALS.filter(m => m !== 'ground');
export const SAMPLE = {
  objects: [
    ...SWATCHES.map((mat, i) => ({ type: 'box', x: -16 + i * 4, y: 0, z: -6, w: 3, h: 3, d: 3, mat })),
    { type: 'wall', axis: 'x', at: -12, from: -16, to: 16, h: 4, t: 0.4, mat: 'concrete', ops: [{ at: -4, w: 1.6, type: 'door' }, { at: 6, w: 2, type: 'window' }] },
    { type: 'building', x: -11, z: 5, w: 7, d: 6, h: 3.2, mat: 'brick', roof: true, ops: { n: [], s: [{ at: -11, w: 1.6, type: 'door' }], e: [], w: [] } },
    { type: 'container', x: 9, z: 3, axis: 'x', tint: '#2f5d8a' }, { type: 'container', x: 9, z: 3, axis: 'x', tint: '#c9562e', y: 2.59 },
    { type: 'crate', x: 2, z: 5, s: 1.2 }, { type: 'crate', x: 3.3, z: 5.2, s: 1.2 }, { type: 'crate', x: 2.6, z: 5.1, s: 1.1, y: 1.2 },
    { type: 'sandbags', x: -2, z: 1, len: 4, axis: 'x' }, { type: 'barrier', x: 5, z: 0, axis: 'x' },
    { type: 'barrel', x: 14, z: -2, tint: '#35506b' }, { type: 'barrel', x: 15, z: -1, tint: '#7a2a1e' },
    { type: 'ramp', x: -1, z: 12, dir: 'e', len: 6, w: 3, h: 3, mat: 'concrete' },
    { type: 'platform', x: 4, z: 12, y: 3, w: 4, d: 5, mat: 'metal', pillars: true },
    { type: 'stairs', x: 8, z: 12, dir: 'w', len: 4, w: 2, h: 3, mat: 'concreteDark' },
    { type: 'tree', x: -16, z: 12, s: 1.1 }, { type: 'tree', x: 16, z: 9, s: 0.9 },
  ],
};

export async function createLookDoc(ctx) {
  const { canvas, renderer } = ctx;
  const res = await fetch('/content/looks.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('content/looks.json 을 읽을 수 없음');
  let data = await res.json(), saved = JSON.stringify(data), snap = saved;
  const undoStack = [], redoStack = [];
  let cur = 0, mat = null, errors = []; // mat = 고르고 있는 재질 (null = 분위기 전체)

  // ───────── 화면 조각 ─────────
  const overlay = el('div'); overlay.innerHTML = '<div class="hint" data-r="hint"></div><div class="errors" data-r="errors" hidden></div>';
  const tools = el('div');
  const toolbar = el('div');
  toolbar.innerHTML = `<span class="grp"><button type="button" data-r="undo" title="되돌리기 (⌘Z)">↶</button><button type="button" data-r="redo" title="다시 하기 (⌘⇧Z)">↷</button></span>
    <span class="grp"><span class="gl">보기</span><button type="button" data-r="view" title="견본 장면 처음 위치 (Home)">처음 위치</button><button type="button" data-r="eye" title="사람 눈높이로 (게임에서 보이는 느낌)">눈높이</button></span>
    <span class="grow"></span><span class="grp"><span class="status" data-r="status"></span><button type="button" class="primary" data-r="save" title="저장 (⌘S)">저장</button></span>`;
  const inspector = el('div');
  const r = n => toolbar.querySelector(`[data-r="${n}"]`) || overlay.querySelector(`[data-r="${n}"]`);
  const look = () => data[cur];

  // ───────── 3D: 견본 장면 ─────────
  const scene = new THREE.Scene();
  const world = buildWorld(scene, renderer, clone(look()));
  world.setMap(buildLayout(SAMPLE));
  for (const [x, z, colors, yaw] of [[-4, 6, { uniform: 0x2f4f7a, vest: 0x3a6ea8 }, 0.4], [-6, 7, { uniform: 0x7a3a2f, vest: 0xa8503a }, -0.3]]) {
    const s = buildSoldier(colors).root; s.position.set(x, 0, z); s.rotation.y = yaw; s.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(s);
  }
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  const controls = new OrbitControls(camera, canvas); controls.disconnect();
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;
  const home = () => { controls.target.set(0, 1.5, 2); camera.position.set(6, 9, 26); controls.update(); };
  const eye = () => { controls.target.set(0, 1.6, -6); camera.position.set(-2, 1.7, 20); controls.update(); };
  home();
  // 클릭으로 재질 고르기: 물체마다 보이지 않는 상자
  const pickGroup = new THREE.Group(); scene.add(pickGroup);
  const unitBox = new THREE.BoxGeometry(1, 1, 1), pickMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const o of SAMPLE.objects) for (const b of expandObject(o).boxes) {
    const m = new THREE.Mesh(unitBox, pickMat); m.scale.set(b.w, b.h, b.d); m.position.set(b.x, b.y + b.h / 2, b.z); m.userData.mat = b.mat; pickGroup.add(m);
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmp = new THREE.Vector3();
  let down = null;
  const listeners = [
    ['pointerdown', e => { down = [e.clientX, e.clientY]; }],
    ['pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; } // 끌기(회전)는 고르기가 아니다
      down = null;
      const b = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects(pickGroup.children, false)[0];
      if (h && h.object.userData.mat) pickMat_(h.object.userData.mat);
      else if (ray.ray.intersectPlane(groundPlane, tmp)) pickMat_('ground');
    }],
    ['dblclick', () => pickMat_(null)],
  ];

  // ───────── 고친 것만 다시 그리기 ─────────
  let applied = clone(look()), queued = false;
  function apply(full) {
    if (queued && !full) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const lk = clone(look());
      if (!lk.materials || LOOK_MATERIALS.some(k => !lk.materials[k])) return; // 고치는 중 잠깐 모자란 상태
      let only;
      if (!full && applied && applied.id === lk.id) only = LOOK_MATERIALS.filter(k => JSON.stringify(applied.materials[k]) !== JSON.stringify(lk.materials[k]));
      try { world.setLook(lk, only); } catch (err) { ctx.log(`다시 그리기 실패: ${err.message}`, 'error'); return; }
      applied = lk;
    });
  }

  const isDirty = () => JSON.stringify(data) !== saved;
  const check = () => checkLooks(data);
  function commit() {
    const now = JSON.stringify(data);
    if (now === snap) return;
    undoStack.push(snap); redoStack.length = 0; snap = now;
    status(); ctx.changed();
  }
  function restore(text) { data = JSON.parse(text); snap = text; cur = Math.min(cur, data.length - 1); apply(true); renderAll(); ctx.changed(); }
  const undo = () => { if (undoStack.length) { redoStack.push(snap); restore(undoStack.pop()); } };
  const redo = () => { if (redoStack.length) { undoStack.push(snap); restore(redoStack.pop()); } };

  function status() {
    errors = check();
    const box = r('errors'); box.hidden = !errors.length; box.replaceChildren(...errors.slice(0, 6).map(t => el('div', '', t)));
    r('save').disabled = !!errors.length;
    const d = isDirty(); r('status').textContent = d ? '● 저장 안 됨' : '✓ 저장됨'; r('status').className = `status${d ? ' dirty' : ''}`;
    r('hint').textContent = mat ? `재질: ${MAT_NAMES[mat]} (${mat}) — 오른쪽에서 고친다 · 더블클릭 = 분위기 전체로` : '장면의 물체를 클릭하면 그 재질을 고친다 · 왼쪽 끌기 = 돌기, 오른쪽 끌기 = 이동, 휠 = 확대';
  }

  // ───────── 왼쪽: 분위기 목록 + 재질 목록 ─────────
  function renderTools() {
    tools.replaceChildren();
    tools.appendChild(el('div', 'tbx-h', '분위기'));
    const list = el('div', 'tiles');
    data.forEach((l, i) => {
      const b = el('button', `tile${i === cur ? ' on' : ''}`); b.type = 'button'; b.dataset.look = l.id; b.title = `${l.name} (${l.id})`;
      const ic = el('span', 'ic', '☀'); ic.style.color = l.sun.color; b.append(ic, document.createTextNode(l.name.split(' (')[0]));
      b.addEventListener('click', () => { cur = i; apply(true); renderAll(); });
      list.appendChild(b);
    });
    const add = el('button', 'tile'); add.type = 'button'; add.dataset.r = 'newLook'; add.title = '지금 분위기를 복사해서 새로 만들기';
    add.append(el('span', 'ic', '+'), document.createTextNode('새 분위기'));
    add.addEventListener('click', () => createLook());
    list.appendChild(add);
    tools.appendChild(list);
    tools.appendChild(el('div', 'tbx-h', '재질'));
    const mats = el('div', 'tiles');
    for (const k of LOOK_MATERIALS) {
      const m = look().materials[k] || {};
      const b = el('button', `tile${k === mat ? ' on' : ''}`); b.type = 'button'; b.dataset.mat = k; b.title = `${MAT_NAMES[k]} (${k}) — ${m.style || ''}`;
      const ic = el('span', 'ic', '■'); ic.style.color = m.base || '#999'; b.append(ic, document.createTextNode(MAT_NAMES[k]));
      b.addEventListener('click', () => pickMat_(k === mat ? null : k));
      mats.appendChild(b);
    }
    tools.appendChild(mats);
    tools.appendChild(el('p', 'note', '맵은 맵 설정의 "분위기" 로 하나를 고릅니다 (비우면 첫 번째). 재질 이름은 맵 물체의 재질과 같습니다. 파일: content/looks.json'));
  }

  // ───────── 오른쪽: 입력 칸 ─────────
  const h = { onInput: () => { apply(); status(); }, onCommit: () => { commit(); renderTools(); } };
  function renderInspector() {
    inspector.replaceChildren();
    const lk = look();
    if (mat) {
      const back = el('button', 'mini', '← 분위기 전체'); back.type = 'button'; back.addEventListener('click', () => pickMat_(null));
      inspector.append(back, el('h2', '', `재질 · ${MAT_NAMES[mat]}`), el('p', 'note', `${mat} — "${lk.name}" 분위기 안의 재질. 바탕 색·선 색·무늬를 바꾸면 이 재질을 쓰는 모든 물체가 바뀝니다. 물체 하나만 바꾸려면 맵 에디터에서 그 물체의 재질·색을 고칩니다.`));
      buildForm(inspector, MAT_SPEC, lk.materials[mat], h);
      return;
    }
    inspector.append(el('h2', '', lk.name), el('p', 'note', `id: ${lk.id} — 맵이 이 id 로 부른다`));
    buildForm(inspector, LOOK_SCHEMA, lk, { ...h, skip: ['id', 'materials'] });
    const btns = el('div', 'btns'), del = el('button', 'danger', '이 분위기 삭제'); del.type = 'button';
    del.addEventListener('click', removeLook); btns.appendChild(del); inspector.appendChild(btns);
  }
  function renderAll() { renderTools(); renderInspector(); status(); }
  function pickMat_(k) { mat = k; renderAll(); }

  async function createLook() {
    const v = await formDialog({
      title: '새 분위기', ok: '만들기',
      lead: '고른 분위기를 복사해서 시작합니다. 만든 뒤 오른쪽에서 고치고 저장(⌘S)하세요.',
      fields: [{ key: 'id', label: 'id', required: true, pattern: '^[a-z0-9_]+$', hint: '영문 소문자·숫자·_ (맵이 이 id 로 부른다)', placeholder: '예: dusk' },
        { key: 'name', label: '이름', required: true, placeholder: '예: 해질녘' },
        { key: 'base', label: '기준', type: 'select', required: true, options: data.map(l => [l.id, `${l.name} 에서 시작`]), value: look().id }],
      validate: x => (data.some(l => l.id === x.id) ? `id "${x.id}" 는 이미 있습니다` : null),
    });
    if (!v) return null;
    data.push({ ...clone(data.find(l => l.id === v.base)), id: v.id, name: v.name });
    cur = data.length - 1; mat = null;
    commit(); apply(true); renderAll();
    ctx.log(`새 분위기: ${v.name} (${v.id}) — 저장하면 content/looks.json 에 들어갑니다`, 'ok');
    return v.id;
  }
  function removeLook() {
    if (data.length <= 1) { ctx.flash('마지막 분위기는 지울 수 없습니다'); return; }
    const used = (ctx.mapLooks ? ctx.mapLooks() : []).filter(([, id]) => id === look().id).map(([m]) => m);
    if (!confirm(`"${look().name}" 을 지울까요?${used.length ? `\n이 분위기를 쓰는 맵(${used.join(', ')})은 첫 번째 분위기로 보입니다.` : ''}`)) return;
    data.splice(cur, 1); cur = Math.max(0, cur - 1); mat = null;
    commit(); apply(true); renderAll();
  }

  async function save() {
    errors = check();
    if (errors.length) { ctx.flash('검사 오류가 있어 저장할 수 없습니다'); ctx.log(`저장 실패 (looks.json): ${errors[0]}`, 'error'); return false; }
    const out = await saveContent('looks', data);
    if (!out.ok) { ctx.flash('저장 실패'); ctx.log(`저장 실패 (looks.json): ${(out.errors || []).join(' / ')}`, 'error'); return false; }
    saved = JSON.stringify(data); status(); ctx.changed();
    for (const d of ctx.docs().values()) if (d !== doc && d.setLooks) d.setLooks(clone(data)); // 열린 맵 에디터에 바로 반영
    if (ctx.refreshAssets) ctx.refreshAssets();
    ctx.log('저장: content/looks.json — 열린 맵 에디터에 바로 반영, 게임은 다시 들어가면 바뀝니다', 'ok'); ctx.flash('저장했습니다');
    return true;
  }

  r('undo').addEventListener('click', undo);
  r('redo').addEventListener('click', redo);
  r('save').addEventListener('click', () => save());
  r('view').addEventListener('click', home);
  r('eye').addEventListener('click', eye);
  renderAll();

  const doc = {
    kind: 'look', key: 'look:edit', title: '분위기', icon: '☀', is3D: true, overlay, tools, toolbar, inspector,
    activate() { controls.connect(); for (const [t, fn] of listeners) canvas.addEventListener(t, fn); renderer.toneMappingExposure = look().exposure; canvas.style.cursor = 'default'; },
    deactivate() { controls.disconnect(); for (const [t, fn] of listeners) canvas.removeEventListener(t, fn); },
    resize(w, hh) { camera.aspect = w / hh; camera.updateProjectionMatrix(); },
    frame() { controls.update(); renderer.toneMappingExposure = look().exposure; renderer.render(scene, camera); },
    isDirty, save,
    focus({ select, create, mat: m }) {
      if (create) { createLook(); return; }
      const i = data.findIndex(l => l.id === select);
      if (i >= 0 && i !== cur) { cur = i; apply(true); }
      if (m !== undefined) mat = m;
      renderAll();
    },
    onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
      else if (e.code === 'Escape') pickMat_(null);
      else if (e.code === 'Home') home();
    },
    dispose() { controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    api: { get data() { return data; }, get cur() { return cur; }, get mat() { return mat; }, select: id => doc.focus({ select: id }), pickMat: pickMat_, createLook, save, undo, redo, isDirty, get errors() { return errors; }, get applied() { return applied; }, world },
  };
  return doc;
}
