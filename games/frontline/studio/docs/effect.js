// 효과 문서: content/effects.json 을 고친다 (스킬·폭발 등의 시각 효과).
//   가운데 = 미리 보기 (게임과 같은 실행기 client/js/effects.js). 사람 모형·격자로 크기를 가늠한다. 고치는 대로 다시 재생
//   왼쪽 = 효과 목록 + 고른 효과의 층 목록 (층 하나만 보기·끄기), 오른쪽 = 효과 / 층의 입력 칸 (스키마로 자동 생성)
//   게임은 "쓰는 곳"(EFFECT_HOOKS) 의 id 와 같은 효과를 그 순간에 재생한다
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createEffects } from '/js/effects.js';
import { buildSoldier } from '/js/guns.js';
import { EFFECT_SCHEMA, EFFECT_HOOKS, EMITTER_SCHEMAS, emitterSpec, checkEffects } from '/shared/content/schema.js';
import { buildForm } from '../form.js';
import { formDialog } from '../dialog.js';
import { el, html, clone, getJson, saveContent } from '../util.js';

// 새 층의 기본값 (종류별)
const NEW_EMITTER = {
  particles: { kind: 'particles', name: '입자', count: 20, lifeMin: 0.4, lifeMax: 0.8, speedMin: 2, speedMax: 5, dir: 'sphere', sizeStart: 0.2, sizeEnd: 0.05, colorStart: '#ffd27a', colorEnd: '#ff5a1e', alphaStart: 1, alphaEnd: 0, texture: 'soft', blend: 'add' },
  ring: { kind: 'ring', name: '고리', life: 0.4, radiusStart: 0.2, radiusEnd: 3, width: 0.3, color: '#ffc070', alphaStart: 0.8, alphaEnd: 0, facing: 'ground', blend: 'add' },
  light: { kind: 'light', name: '빛', life: 0.3, color: '#ffa040', intensity: 100, range: 8 },
};
const ICON = { particles: '✦', ring: '◯', light: '☼' };
const BG = { 어두운: [0x15181b, 0.25, 0.35], 게임: [0x8fa9c0, 0.8, 1.0], 밝은: [0xd8dde2, 1, 1.4] };

export async function createEffectDoc(ctx) {
  const { canvas, renderer } = ctx;
  let data = await getJson('/content/effects.json', null);
  if (!data) throw new Error('content/effects.json 을 읽을 수 없음');
  let saved = JSON.stringify(data), snap = saved;
  const undoStack = [], redoStack = [];
  let cur = 0, em = -1, errors = []; // em = 고른 층 번호 (-1 = 효과 전체)
  let solo = false, loop = true, speed = 1, height = 1, nextPlay = 0;

  // ───────── 화면 조각 ─────────
  const overlay = html('div', '', '<div class="hint" data-r="hint"></div><div class="errors" data-r="errors" hidden></div><div class="coords" data-r="stats"></div>');
  const tools = el('div');
  const toolbar = html('div', '', `<span class="grp"><button type="button" data-r="undo" title="되돌리기 (⌘Z)">↶</button><button type="button" data-r="redo" title="다시 하기 (⌘⇧Z)">↷</button></span>
    <span class="grp"><button type="button" class="primary" data-r="play" title="한 번 재생 (Space)">▶ 재생</button><label class="chk"><input type="checkbox" data-r="loop" checked> 반복</label>
      <span class="gl">빠르기</span><select data-r="speed"><option value="1">×1</option><option value="0.5">×0.5</option><option value="0.2">×0.2</option><option value="2">×2</option></select>
      <span class="gl">높이</span><select data-r="height" title="효과가 나는 높이"><option value="0">바닥</option><option value="1" selected>가슴 (1m)</option><option value="1.6">머리</option></select>
      <span class="gl">배경</span><select data-r="bg">${Object.keys(BG).map(k => `<option>${k}</option>`).join('')}</select></span>
    <span class="grow"></span><span class="grp"><span class="status" data-r="status"></span><button type="button" class="primary" data-r="save" title="저장 (⌘S)">저장</button></span>`);
  const inspector = el('div');
  const r = n => toolbar.querySelector(`[data-r="${n}"]`) || overlay.querySelector(`[data-r="${n}"]`);
  const fx = () => data[cur];

  // ───────── 3D: 미리 보기 ─────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG.어두운[0]);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3;
  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x2a2e33, 0.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dd, 0.8); sun.position.set(-3, 6, 4); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const grid = new THREE.GridHelper(40, 40, 0x000000, 0x000000); grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.01; scene.add(grid);
  const dummy = buildSoldier({ uniform: 0x4a5560, vest: 0x5a6a78 }).root; dummy.position.set(1.4, 0, 0.6); dummy.rotation.y = -0.6; scene.add(dummy); // 크기 가늠용 사람 (키 1.8m)
  const fwd = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), 0.8, 0x5aa9ff, 0.15, 0.08); fwd.visible = false; scene.add(fwd); // cone·forward 방향
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
  const controls = new OrbitControls(camera, canvas); controls.disconnect(); controls.enableDamping = true;
  const home = () => { controls.target.set(0, 1, 0); camera.position.set(3.4, 2.4, 5.2); controls.update(); };
  home();
  const runner = createEffects(scene, { max: 3000 });

  // ───────── 재생 ─────────
  const effectLength = d => Math.max(0.3, ...d.emitters.map(e => (e.delay || 0) + (e.kind === 'particles' ? (e.rate > 0 ? e.duration || 0 : 0) + (e.lifeMax ?? 0.5) : e.life ?? 0.4)));
  function play() {
    const d = fx(); if (!d) return;
    const origin = new THREE.Vector3(0, height, 0);
    runner.setView(solo && em >= 0 ? d.emitters[em] : null, d.emitters.filter(e => e._off));
    runner.play(d, origin, { dir: new THREE.Vector3(0, 0, -1) }); // 층의 _off(미리 보기에서 끈 층)는 setView 가 본다 — 저장할 때는 뺀다
    nextPlay = effectLength(d) + 0.35; // 끝나고 잠깐 쉬었다 다시
    fwd.position.copy(origin); fwd.visible = d.emitters.some(e => e.dir === 'cone');
  }
  const replay = () => { runner.clear(); play(); };

  // ───────── 되돌리기 · 검사 ─────────
  const clean = () => JSON.stringify(data, (k, v) => (k === '_off' ? undefined : v));
  const isDirty = () => clean() !== saved;
  function commit() {
    const now = clean();
    if (now === snap) return;
    undoStack.push(snap); redoStack.length = 0; snap = now;
    status(); ctx.changed();
  }
  function restore(text) { data = JSON.parse(text); snap = text; cur = Math.min(cur, data.length - 1); em = -1; renderAll(); replay(); ctx.changed(); }
  const undo = () => { if (undoStack.length) { redoStack.push(snap); restore(undoStack.pop()); } };
  const redo = () => { if (redoStack.length) { undoStack.push(snap); restore(redoStack.pop()); } };
  function status() {
    errors = checkEffects(JSON.parse(clean()));
    const box = r('errors'); box.hidden = !errors.length; box.replaceChildren(...errors.slice(0, 6).map(t => el('div', '', t)));
    r('save').disabled = !!errors.length;
    const d = isDirty(); r('status').textContent = d ? '● 저장 안 됨' : '✓ 저장됨'; r('status').className = `status${d ? ' dirty' : ''}`;
    const f = fx(), hook = f && EFFECT_HOOKS[f.id];
    r('hint').textContent = hook ? `게임에서 쓰는 곳: ${hook}` : '게임에서 아직 쓰지 않는 효과 (id 가 "쓰는 곳" 목록에 있어야 게임이 재생한다)';
  }

  // ───────── 왼쪽: 효과 목록 + 층 목록 ─────────
  function renderTools() {
    tools.replaceChildren();
    tools.appendChild(el('div', 'tbx-h', '효과'));
    const list = el('div', 'tiles');
    data.forEach((d, i) => {
      const b = el('button', `tile${i === cur ? ' on' : ''}`); b.type = 'button'; b.dataset.fx = d.id; b.title = `${d.name} (${d.id})${EFFECT_HOOKS[d.id] ? ' — ' + EFFECT_HOOKS[d.id] : ''}`;
      b.append(el('span', 'ic', EFFECT_HOOKS[d.id] ? '✺' : '✧'), document.createTextNode(d.name));
      b.addEventListener('click', () => { cur = i; em = -1; renderAll(); replay(); });
      list.appendChild(b);
    });
    const add = el('button', 'tile'); add.type = 'button'; add.dataset.r = 'newFx'; add.append(el('span', 'ic', '+'), document.createTextNode('새 효과'));
    add.addEventListener('click', () => createEffect()); list.appendChild(add);
    tools.appendChild(list);
    const d = fx(); if (!d) return;
    tools.appendChild(el('div', 'tbx-h', `층 — ${d.name}`));
    const layers = el('div', 'layers');
    d.emitters.forEach((e, i) => {
      const row = el('div', `layer${i === em ? ' on' : ''}${e._off ? ' off' : ''}`); row.dataset.em = i;
      const eye = el('button', 'mini', e._off ? '○' : '●'); eye.type = 'button'; eye.title = '이 층 끄기 / 켜기 (미리 보기만)';
      eye.addEventListener('click', ev => { ev.stopPropagation(); e._off = !e._off; renderTools(); replay(); });
      row.append(el('span', 'ic', ICON[e.kind] || '?'), el('span', 'nm', e.name || EMITTER_SCHEMAS[e.kind].label), el('small', '', EMITTER_SCHEMAS[e.kind].label), eye);
      row.addEventListener('click', () => { em = i === em ? -1 : i; renderAll(); if (solo) replay(); });
      layers.appendChild(row);
    });
    tools.appendChild(layers);
    const addRow = el('div', 'btns');
    for (const k of Object.keys(EMITTER_SCHEMAS)) {
      const b = el('button', 'mini', `+ ${EMITTER_SCHEMAS[k].label}`); b.type = 'button'; b.dataset.add = k;
      b.addEventListener('click', () => { d.emitters.push(clone(NEW_EMITTER[k])); em = d.emitters.length - 1; commit(); renderAll(); replay(); });
      addRow.appendChild(b);
    }
    tools.appendChild(addRow);
    const soloL = html('label', 'tog', `<input type="checkbox" data-r="solo"${solo ? ' checked' : ''}> 고른 층만 보기`);
    soloL.querySelector('input').addEventListener('change', ev => { solo = ev.target.checked; replay(); });
    tools.appendChild(soloL);
    tools.appendChild(el('div', 'tbx-h', '게임에서 쓰는 곳 (id)'));
    const hooks = el('div', 'hooks');
    for (const [id, what] of Object.entries(EFFECT_HOOKS)) { const has = data.some(x => x.id === id); const p = el('p', `note${has ? '' : ' miss'}`); p.append(el('b', '', id), document.createTextNode(` — ${what}${has ? '' : ' (없음: 예전 코드 효과)'}`)); hooks.appendChild(p); }
    tools.appendChild(hooks);
  }

  // ───────── 오른쪽: 입력 칸 ─────────
  // 입력이 끝나면 왼쪽 목록은 글자만 고친다 (다시 만들면, 입력 칸을 벗어나며 누른 왼쪽 버튼의 클릭이 사라진다)
  function refreshToolLabels() {
    const d = fx();
    tools.querySelectorAll('[data-fx]').forEach((b, i) => { if (data[i]) b.lastChild.textContent = data[i].name; });
    if (d) tools.querySelectorAll('[data-em]').forEach(row => { const e = d.emitters[Number(row.dataset.em)]; if (e) row.querySelector('.nm').textContent = e.name || EMITTER_SCHEMAS[e.kind].label; });
  }
  const h = { onInput: () => { status(); replay(); }, onCommit: () => { commit(); refreshToolLabels(); } };
  function renderInspector() {
    inspector.replaceChildren();
    const d = fx(); if (!d) return;
    if (em >= 0 && d.emitters[em]) {
      const e = d.emitters[em];
      const back = el('button', 'mini', '← 효과 전체'); back.type = 'button'; back.addEventListener('click', () => { em = -1; renderAll(); });
      inspector.append(back, el('h2', '', `${EMITTER_SCHEMAS[e.kind].label} · ${e.name || ''}`));
      buildForm(inspector, emitterSpec(e.kind), e, { ...h, skip: ['kind'] });
      const btns = el('div', 'btns');
      const dup = el('button', '', '복제'); dup.type = 'button'; dup.addEventListener('click', () => { const c = clone(e); delete c._off; d.emitters.splice(em + 1, 0, c); em++; commit(); renderAll(); replay(); });
      const up = el('button', '', '위로'); up.type = 'button'; up.disabled = em === 0; up.addEventListener('click', () => { [d.emitters[em - 1], d.emitters[em]] = [d.emitters[em], d.emitters[em - 1]]; em--; commit(); renderAll(); });
      const del = el('button', 'danger', '삭제'); del.type = 'button'; del.disabled = d.emitters.length <= 1;
      del.addEventListener('click', () => { d.emitters.splice(em, 1); em = -1; commit(); renderAll(); replay(); });
      btns.append(dup, up, del); inspector.appendChild(btns);
      return;
    }
    inspector.append(el('h2', '', d.name), el('p', 'note', `id: ${d.id}${EFFECT_HOOKS[d.id] ? ` — 게임: ${EFFECT_HOOKS[d.id]}` : ''}`));
    buildForm(inspector, EFFECT_SCHEMA, d, { ...h, skip: ['id', 'emitters'] });
    inspector.appendChild(el('p', 'note', '층을 고르면 그 층의 수치를 고친다. 왼쪽 ● 로 층을 끄고 켜며 비교 (저장에는 영향 없음).'));
    const btns = el('div', 'btns'), del = el('button', 'danger', '이 효과 삭제'); del.type = 'button';
    del.addEventListener('click', () => { if (data.length <= 1 || !confirm(`"${d.name}" 을 지울까요?`)) return; data.splice(cur, 1); cur = 0; em = -1; commit(); renderAll(); replay(); });
    btns.appendChild(del); inspector.appendChild(btns);
  }
  function renderAll() { renderTools(); renderInspector(); status(); }

  async function createEffect() {
    const free = Object.keys(EFFECT_HOOKS).filter(id => !data.some(x => x.id === id));
    const v = await formDialog({
      title: '새 효과', ok: '만들기',
      lead: `게임에서 쓰려면 id 를 "쓰는 곳" 중 하나로 정한다${free.length ? ` (아직 없는 것: ${free.join(', ')})` : ''}. 고른 효과를 복사해서 시작할 수도 있다.`,
      fields: [{ key: 'id', label: 'id', required: true, pattern: '^[a-z][a-z0-9_]*$', hint: '영문 소문자로 시작, 소문자·숫자·_', placeholder: free[0] || '예: skill_new' },
        { key: 'name', label: '이름', required: true, placeholder: '예: 새 스킬 효과' },
        { key: 'base', label: '시작', type: 'select', required: true, options: [['_empty', '빈 효과 (입자 하나)'], ...data.map(x => [x.id, `${x.name} 복사`])], value: '_empty' }],
      validate: x => (data.some(e => e.id === x.id) ? `id "${x.id}" 는 이미 있습니다` : null),
    });
    if (!v) return null;
    const base = v.base !== '_empty' ? clone(data.find(x => x.id === v.base)) : { emitters: [clone(NEW_EMITTER.particles)] };
    for (const e of base.emitters) delete e._off;
    data.push({ id: v.id, name: v.name, ...(base.desc ? { desc: base.desc } : {}), emitters: base.emitters });
    cur = data.length - 1; em = -1;
    commit(); renderAll(); replay();
    ctx.log(`새 효과: ${v.name} (${v.id}) — 저장하면 content/effects.json 에 들어갑니다`, 'ok');
    return v.id;
  }

  async function save() {
    const out = JSON.parse(clean());
    errors = checkEffects(out);
    if (errors.length) { ctx.flash('검사 오류가 있어 저장할 수 없습니다'); ctx.log(`저장 실패 (effects.json): ${errors[0]}`, 'error'); return false; }
    const res = await saveContent('effects', out);
    if (!res.ok) { ctx.flash('저장 실패'); ctx.log(`저장 실패 (effects.json): ${(res.errors || []).join(' / ')}`, 'error'); return false; }
    saved = clean(); status(); ctx.changed();
    if (ctx.refreshAssets) ctx.refreshAssets();
    ctx.log('저장: content/effects.json — 게임은 다시 들어가면 새 효과로 재생합니다', 'ok'); ctx.flash('저장했습니다');
    return true;
  }

  r('undo').addEventListener('click', undo);
  r('redo').addEventListener('click', redo);
  r('save').addEventListener('click', () => save());
  r('play').addEventListener('click', replay);
  r('loop').addEventListener('change', () => { loop = r('loop').checked; });
  r('speed').addEventListener('change', () => { speed = Number(r('speed').value); });
  r('height').addEventListener('change', () => { height = Number(r('height').value); replay(); });
  r('bg').addEventListener('change', () => { const [bg, hi, si] = BG[r('bg').value]; scene.background.setHex(bg); hemi.intensity = hi; sun.intensity = si; });
  renderAll(); play();

  const doc = {
    kind: 'effect', key: 'effect:edit', title: '효과', icon: '✺', is3D: true, overlay, tools, toolbar, inspector,
    activate() { controls.connect(); renderer.toneMappingExposure = 1; canvas.style.cursor = 'default'; },
    deactivate() { controls.disconnect(); },
    resize(w, hh) { camera.aspect = w / hh; camera.updateProjectionMatrix(); },
    frame(dt = 1 / 60) {
      const t = dt * speed;
      runner.update(t, camera);
      if (loop) { nextPlay -= t; if (nextPlay <= 0) play(); }
      const s = runner.stats(); r('stats').textContent = `입자 ${s.particles}개 · 고리 ${s.rings}개`;
      controls.update(); renderer.render(scene, camera);
    },
    isDirty, save,
    focus({ select, create }) {
      if (create) { createEffect(); return; }
      const i = data.findIndex(x => x.id === select);
      if (i >= 0) { cur = i; em = -1; renderAll(); replay(); }
    },
    onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
      else if (!mod && e.code === 'Space') { e.preventDefault(); replay(); }
      else if (e.code === 'Escape') { em = -1; renderAll(); }
      else if (e.code === 'Home') home();
    },
    dispose() { controls.dispose(); runner.clear(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    api: { get data() { return data; }, get cur() { return cur; }, get em() { return em; }, select: id => doc.focus({ select: id }), pickEmitter: i => { em = i; renderAll(); }, replay, createEffect, save, undo, redo, isDirty, stats: () => runner.stats(), get errors() { return errors; }, runner },
  };
  return doc;
}
