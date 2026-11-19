// 게임 데이터 문서: content/weapons.json · parts.json · modes.json · skills.json 을 표와 입력 칸으로 고친다.
// 가운데 = 목록과 비교 표 (고치는 대로 바로 다시 계산), 오른쪽 = 고른 항목의 입력 칸 (스키마로 자동 생성).
// 저장하면 개발 서버가 다시 시작되어 게임에 반영된다.
import { WEAPON_SCHEMA, PART_SCHEMA, MODE_SCHEMA, SKILL_SCHEMA, SKILL_EFFECTS, BUILTIN_GUNS } from '/shared/content/schema.js';
import { CONTENT } from '/shared/content/registry.js';
import { calcDamage } from '/shared/weapons.js';
import { describePart } from '/shared/parts.js';
import { buildForm } from '../form.js';
import { formDialog } from '../dialog.js';
import { el, saveContent } from '../util.js';

export const DATA_DOCS = [
  { id: 'weapons', title: '무기', file: 'weapons.json' },
  { id: 'parts', title: '파츠', file: 'parts.json' },
  { id: 'modes', title: '모드', file: 'modes.json' },
  { id: 'skills', title: '스킬', file: 'skills.json' },
];
const ICONS = { weapons: '✦', parts: '⚙', modes: '⚑', skills: '⚡' };
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');

// 몸통만 맞혀 100 체력을 깎는 데 걸리는 시간 (ms). 산탄총은 모든 산탄이 맞았다고 본다
function ttk(w, dist, part = 'body') {
  const per = calcDamage(w, part, dist) * w.pellets;
  if (per <= 0) return Infinity;
  return (Math.ceil(100 / per) - 1) * 60000 / w.rpm;
}

export async function createDataDoc(ctx, id) {
  const info = DATA_DOCS.find(d => d.id === id);
  if (!info) throw new Error(`없는 데이터: ${id}`);
  const res = await fetch(`/content/${info.file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`content/${info.file} 을 읽을 수 없음`);
  let data = await res.json(), saved = JSON.stringify(data), snap = saved;
  const undoStack = [], redoStack = [];
  let cur = 0, slot = 'optic', errors = [];
  // 스킬 목록 (무기의 "고를 수 있는 스킬" 칸과 검사에 쓴다). 스킬 문서는 자기 데이터를 쓴다
  let skillList = id === 'skills' ? data : await fetch('/content/skills.json', { cache: 'no-store' }).then(x => (x.ok ? x.json() : [])).catch(() => []);
  const skillIds = () => (id === 'skills' ? data : skillList).map(s => s.id);

  const overlay = el('div', 'page'); const page = el('div', 'datapage'); overlay.appendChild(page);
  // 도구 상자: 다른 데이터로 바로 가기 + 안내
  const tools = el('div');
  tools.appendChild(Object.assign(el('div', 'tbx-h'), { textContent: '데이터' }));
  const jump = el('div', 'tiles');
  for (const d of DATA_DOCS) {
    const b = el('button', `tile${d.id === id ? ' on' : ''}`); b.type = 'button';
    b.append(Object.assign(el('span', 'ic'), { textContent: ICONS[d.id] }), document.createTextNode(d.title));
    b.addEventListener('click', () => ctx.openAsset(`data:${d.id}`));
    jump.appendChild(b);
  }
  tools.append(jump, Object.assign(el('p', 'note'), { textContent: `가운데에서 항목을 고르고 오른쪽 속성에서 고칩니다. 저장(⌘S)하면 개발 서버가 다시 시작되어 게임에 반영됩니다. 파일: content/${info.file}` }));
  // 무기 데이터: 데이터로 등록된 모델 목록 (어느 무기에 연결됐는지, 누르면 모델 에디터)
  const regBox = el('div');
  if (id === 'weapons') tools.append(Object.assign(el('div', 'tbx-h'), { textContent: '등록된 모델' }), regBox);
  function renderRegistry() {
    if (id !== 'weapons') return;
    regBox.replaceChildren();
    const reg = ctx.registry();
    if (!reg.length) { regBox.appendChild(Object.assign(el('p', 'note'), { textContent: '아직 없습니다. 모델 에디터에서 "데이터로 등록" 하면 여기 나오고, 무기의 "모델" 에서 고를 수 있습니다.' })); return; }
    for (const m of reg) {
      const users = data.filter(w => w.model === m.id).map(w => w.name);
      const b = el('button', 'tile'); b.type = 'button'; b.style.cssText = 'width:100%;flex-direction:row;justify-content:flex-start;gap:8px;padding:7px 9px;margin-bottom:5px;text-align:left';
      b.title = `${m.id} — 눌러서 모델 에디터로`;
      const t = el('span'); t.append(Object.assign(el('b'), { textContent: m.name }), el('br'), Object.assign(el('span', 'note'), { textContent: users.length ? `→ ${users.join(', ')}` : '연결된 무기 없음' }));
      b.append(Object.assign(el('span', 'ic'), { textContent: '⌐' }), t);
      b.addEventListener('click', () => ctx.openAsset(`gun:${m.id}`));
      regBox.appendChild(b);
    }
  }
  const toolbar = el('div');
  toolbar.innerHTML = `<span class="grp"><button type="button" data-r="undo" title="되돌리기 (⌘Z)">↶</button><button type="button" data-r="redo" title="다시 하기 (⌘⇧Z)">↷</button></span>
    <span class="grow"></span><span class="grp"><span class="status" data-r="status"></span><button type="button" class="primary" data-r="save" title="저장 (⌘S)">저장</button></span>`;
  const inspector = el('div');
  const r = n => toolbar.querySelector(`[data-r="${n}"]`);

  // 지금 고르고 있는 항목과 그 스키마
  const list = () => (id === 'parts' ? data.parts[slot] : data);
  const schema = () => (id === 'weapons' ? WEAPON_SCHEMA : id === 'parts' ? PART_SCHEMA : id === 'skills' ? SKILL_SCHEMA : MODE_SCHEMA);
  const item = () => list()[cur];
  // 검사: 서버 저장과 같은 검사 (shared/content/registry.js). 참고 = 다른 데이터의 지금 값 (열려 있는 문서가 고치는 중인 값 포함)
  const check = () => CONTENT[id].check(data, { models: ctx.registry().map(m => m.id), skills: skillIds(), weapons: id === 'weapons' ? data : ctx.weapons(), maps: ctx.assets().maps });

  const isDirty = () => JSON.stringify(data) !== saved;
  function commit() {
    const now = JSON.stringify(data);
    if (now === snap) return;
    undoStack.push(snap); redoStack.length = 0; snap = now;
    render(); ctx.changed();
  }
  function restore(text) { data = JSON.parse(text); snap = text; cur = Math.min(cur, list().length - 1); render(); renderInspector(); ctx.changed(); }
  const undo = () => { if (undoStack.length) { redoStack.push(snap); restore(undoStack.pop()); } };
  const redo = () => { if (redoStack.length) { undoStack.push(snap); restore(redoStack.pop()); } };

  // ───────── 가운데: 목록 + 비교 ─────────
  function itemButtons() {
    const box = el('div', 'dlist');
    list().forEach((x, i) => {
      const b = el('button', i === cur ? 'on' : '', x.name || x.id); b.type = 'button'; b.dataset.i = i;
      b.addEventListener('click', () => { cur = i; render(); renderInspector(); });
      box.appendChild(b);
    });
    const add = el('button', 'primary', `+ 새 ${NOUN[id]}`); add.type = 'button'; add.dataset.act = 'add';
    add.addEventListener('click', () => createItem()); box.appendChild(add);
    return box;
  }

  // ───────── 새로 만들기: 양식을 다 채워야 만들어진다 ─────────
  // 기준 항목의 수치를 그대로 복사해서 시작하고, 만든 뒤 오른쪽 속성에서 고친다 (저장 때 형식 검사)
  const NOUN = { weapons: '무기', parts: '파츠', modes: '모드', skills: '스킬' };
  async function createItem() {
    const taken = new Set(id === 'parts' ? Object.values(data.parts).flat().map(p => p.id) : list().map(x => x.id));
    const fields = [
      { key: 'id', label: 'id', required: true, pattern: '^[a-z][a-z0-9_]*$', hint: '영문 소문자로 시작, 소문자·숫자·_ (예: vk12)', placeholder: '예: vk12' },
      { key: 'name', label: '이름', required: true, placeholder: id === 'weapons' ? '예: VK-12' : '' },
      { key: 'base', label: '기준', type: 'select', required: true, options: list().map(x => [x.id, `${x.name} 의 수치에서 시작`]), value: item() ? item().id : undefined },
    ];
    if (id === 'weapons') {
      const reg = ctx.registry();
      fields.splice(2, 0, { key: 'cls', label: '분류', required: true, placeholder: '예: 돌격소총' });
      fields.push({ key: 'model', label: '모델', type: 'select', required: true, options: [['', reg.length ? '(고르세요)' : '(등록된 모델이 없습니다)'], ...reg.map(m => [m.id, `${m.name} (${m.id})`])],
        hint: '새 무기는 데이터로 등록된 모델이 있어야 합니다 (모델 에디터 → 데이터로 등록)' });
    }
    if (id === 'modes') fields.push({ key: 'map', label: '기본 맵', type: 'select', required: true, options: ctx.assets().maps.map(m => [m, m]), value: item() ? item().map : undefined });
    const v = await formDialog({
      title: `새 ${NOUN[id]}${id === 'parts' ? ` — ${data.slots.find(s => s.id === slot).name} 자리` : ''}`,
      lead: '* 칸을 모두 채워야 만들 수 있습니다. 만든 뒤 오른쪽 속성에서 수치를 고치고 저장(⌘S)하세요.',
      fields, validate: x => (taken.has(x.id) ? `id "${x.id}" 는 이미 있습니다` : null),
    });
    if (!v) return null;
    const made = { ...JSON.parse(JSON.stringify(list().find(x => x.id === v.base))), id: v.id, name: v.name };
    if (id === 'weapons') { made.cls = v.cls; made.model = v.model; }
    if (id === 'modes') made.map = v.map;
    list().push(made); cur = list().length - 1;
    commit(); renderInspector(); renderRegistry();
    ctx.log(`새 ${NOUN[id]}: ${v.name} (${v.id}) — 저장(⌘S)하면 ${info.file} 에 들어갑니다`, 'ok');
    return made;
  }
  function removeItem() {
    if (id === 'weapons' && BUILTIN_GUNS.includes(item().id)) { ctx.flash('기본 총 7종은 지울 수 없습니다'); return; }
    if (list().length <= 1) { ctx.flash('마지막 항목은 지울 수 없습니다'); return; }
    if (!confirm(`"${item().name || item().id}" 를 지울까요?`)) return;
    list().splice(cur, 1); cur = Math.max(0, cur - 1);
    commit(); renderInspector();
  }

  function table(head, rows, onPick) {
    const t = el('table', 'cmp'), th = el('thead'), tr = el('tr');
    for (const h of head) tr.appendChild(el('th', '', h));
    th.appendChild(tr); t.appendChild(th);
    const tb = el('tbody');
    rows.forEach(({ cells, on }, i) => {
      const row = el('tr', on ? 'on' : '');
      for (const c of cells) { const td = el('td'); if (c instanceof Node) td.appendChild(c); else td.textContent = c; row.appendChild(td); }
      if (onPick) row.addEventListener('click', () => onPick(i));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return t;
  }
  const bar = (v, max) => { const s = el('span', 'bar'); s.style.width = `${Math.max(2, (v / max) * 60)}px`; return s; };

  function render() {
    errors = check();
    page.replaceChildren();
    page.append(el('h1', '', `${info.title} — content/${info.file}`));
    if (id === 'weapons') {
      page.append(el('p', 'lead', '몸통 기준 TTK = 체력 100 을 깎는 데 걸리는 시간 (첫 발은 0ms). 수치를 고치면 바로 다시 계산된다.'), itemButtons());
      const dps = data.map(w => calcDamage(w, 'body', 10) * w.pellets * w.rpm / 60), maxDps = Math.max(...dps);
      const modelName = w => { const m = w.model && ctx.registry().find(x => x.id === w.model); return m ? m.name : w.model ? `${w.model} (등록 안 됨)` : '코드'; };
      page.append(table(['무기', '분류', '모델', '피해', '분당', 'DPS (10m)', 'TTK 10m', 'TTK 30m', 'TTK 60m', '머리 TTK 10m', '탄창', '재장전', '이동'],
        data.map((w, i) => ({
          on: i === cur,
          cells: [w.name, w.cls, modelName(w), `${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''}`, w.rpm, (() => { const d = el('span'); d.append(fmt(dps[i]), bar(dps[i], maxDps)); return d; })(),
            `${fmt(ttk(w, 10))}ms`, `${fmt(ttk(w, 30))}ms`, `${fmt(ttk(w, 60))}ms`, `${fmt(ttk(w, 10, 'head'))}ms`, w.mag, `${w.reload}s`, `${Math.round(w.move * 100)}%`],
        })), i => { cur = i; render(); renderInspector(); }));
      page.append(el('p', 'dnote', '모델 = 이 무기가 쓸 등록된 모델 (오른쪽 "모델" 에서 고른다). 저장하면 게임이 그 모델로 총을 그린다 (1인칭·다른 플레이어·무기고). 비우면 코드로 만든 총. 새 무기는 모델이 꼭 있어야 한다.'));
    } else if (id === 'parts') {
      const seg = el('div', 'seg'); seg.style.maxWidth = '520px'; seg.style.marginBottom = '10px';
      for (const s of data.slots) {
        const b = el('button', s.id === slot ? 'on' : '', s.name); b.type = 'button'; b.dataset.slot = s.id;
        b.addEventListener('click', () => { slot = s.id; cur = 0; render(); renderInspector(); }); seg.appendChild(b);
      }
      page.append(el('p', 'lead', '자리를 고르고 파츠를 고르면, 이 파츠를 달 수 있는 무기마다 좋아지는 점과 나빠지는 점이 보인다.'), seg, itemButtons());
      const p = item();
      if (p) {
        const weapons = ctx.weapons().filter(w => (!p.only || p.only.includes(w.id)) && !(p.not || []).includes(w.id));
        page.append(table(['무기', '좋아지는 점', '나빠지는 점'], weapons.map(w => {
          const d = describePart(w, p), pc = (arr, cls) => { const s = el('span', `pc ${cls}`, arr.join(' · ') || '—'); return s; };
          return { cells: [w.name, pc(d.pros, 'p'), pc(d.cons, 'c')] };
        })));
        if (!weapons.length) page.append(el('p', 'note', '이 파츠를 달 수 있는 무기가 없습니다 (only / not 확인).'));
      }
    } else if (id === 'skills') {
      page.append(el('p', 'lead', '무기마다 주무기(Q)·보조무기(E)로 들 때 고를 수 있는 스킬은 무기 데이터의 "스킬" 에서 정한다. 효과는 코드에 있는 5가지 중 하나이고, 같은 효과로 수치만 다른 스킬을 여러 개 만들 수 있다.'), itemButtons());
      const users = s => ctx.weapons().filter(w => ['primary', 'secondary'].some(k => ((w.skills && w.skills[k]) || []).includes(s.id))).map(w => w.name).join(', ') || '—';
      page.append(table(['스킬', 'id', '효과', '쿨타임', '지속', '설명', '쓰는 무기'], data.map((s, i) => ({
        on: i === cur, cells: [s.name, s.id, `${s.effect} (${SKILL_EFFECTS[s.effect] || '?'})`, s.cd ? `${s.cd}s` : '—', s.dur ? `${s.dur}s` : '—', s.desc, users(s)],
      })), i => { cur = i; render(); renderInspector(); }));
    } else {
      page.append(el('p', 'lead', '로비에 보이는 순서대로. 모드의 점수·승리 규칙 자체는 server/modes/ 코드에 있고, 여기서는 수치를 고친다.'), itemButtons());
      page.append(table(['모드', '규칙', '맵', '인원', '봇 채움', '팀', '목표', '점령 시간'], data.map((m, i) => ({
        on: i === cur, cells: [m.name, m.rules, m.map, m.max, m.fill, m.teams || '개인전', m.goal, m.dom ? `${m.dom.capture}s` : '—'],
      })), i => { cur = i; render(); renderInspector(); }));
    }
    if (errors.length) {
      const box = el('div', 'errors'); box.style.position = 'static'; box.style.marginTop = '12px'; box.style.maxWidth = 'none';
      for (const e of errors.slice(0, 10)) box.appendChild(el('div', '', e));
      page.appendChild(box);
    }
    r('save').disabled = !!errors.length;
    const d = isDirty(); r('status').textContent = d ? '● 저장 안 됨' : '✓ 저장됨'; r('status').className = `status${d ? ' dirty' : ''}`;
  }

  // ───────── 오른쪽: 고른 항목의 입력 칸 ─────────
  function renderInspector() {
    inspector.replaceChildren();
    const x = item();
    if (!x) return;
    inspector.appendChild(el('h2', '', `${x.name || x.id}`));
    // 무기의 "모델" 은 등록된 모델 중에서 고르는 목록으로 보여 준다
    let spec = schema();
    if (id === 'weapons') {
      const reg = ctx.registry().map(m => m.id);
      if (x.model && !reg.includes(x.model)) reg.push(x.model);
      const sk = skillIds(), lists = { kind: 'enum', label: '스킬', options: sk };
      spec = { ...spec, fields: { ...spec.fields, skills: { ...spec.fields.skills, fields: { primary: { ...spec.fields.skills.fields.primary, of: lists }, secondary: { ...spec.fields.skills.fields.secondary, of: lists } } }, model: { kind: 'enum', label: BUILTIN_GUNS.includes(x.id) ? '모델 (데이터로 등록된 모델 · 비우면 코드로 만든 총)' : '모델 (새 무기는 꼭 있어야 함)', options: reg, optional: BUILTIN_GUNS.includes(x.id) } } };
    }
    buildForm(inspector, spec, x, { onInput: () => { render(); renderRegistry(); }, onCommit: () => { commit(); renderInspector(); renderRegistry(); } });
    if (id !== 'weapons' || !BUILTIN_GUNS.includes(x.id)) { // 기본 총 7종은 지우지 않는다
      const btns = el('div', 'btns'), del = el('button', 'danger', '삭제'); del.type = 'button';
      del.addEventListener('click', removeItem); btns.appendChild(del); inspector.appendChild(btns);
    }
  }

  async function save() {
    errors = check();
    if (errors.length) { ctx.flash('검사 오류가 있어 저장할 수 없습니다'); ctx.log(`저장 실패 (${info.file}): ${errors[0]}`, 'error'); return false; }
    const out = await saveContent(id, data);
    if (!out.ok) { ctx.flash('저장 실패'); ctx.log(`저장 실패 (${info.file}): ${(out.errors || []).join(' / ')}`, 'error'); return false; }
    saved = JSON.stringify(data); render(); ctx.changed();
    ctx.log(`저장: content/${info.file} — 개발 서버가 다시 시작되어 게임에 반영됩니다`, 'ok'); ctx.flash('저장했습니다');
    if (id === 'weapons') ctx.setWeapons(data);
    for (const d of ctx.docs().values()) if (d !== doc && d.kind === 'data' && d.setSkills && id === 'skills') d.setSkills(JSON.parse(JSON.stringify(data))); // 열린 무기 문서의 스킬 목록도 새로
    return true;
  }
  // 파일이 다른 곳에서 바뀌었을 때 (예: 모델을 무기에 연결). 고친 게 있으면 덮어쓰지 않고 알린다
  async function reload() {
    const text = await fetch(`/content/${info.file}`, { cache: 'no-store' }).then(x => (x.ok ? x.text() : null)).catch(() => null);
    if (!text || JSON.stringify(JSON.parse(text)) === saved) return;
    if (isDirty()) { ctx.log(`${info.file} 이 다른 곳에서 바뀌었습니다. 지금 고친 것을 저장하면 그 변경을 덮어씁니다 — 저장 전에 확인하세요.`, 'warn'); return; }
    data = JSON.parse(text); saved = snap = JSON.stringify(data); undoStack.length = redoStack.length = 0;
    if (id === 'weapons') ctx.setWeapons(data);
    render(); renderInspector(); ctx.log(`다시 읽음: content/${info.file}`);
  }
  r('undo').addEventListener('click', undo);
  r('redo').addEventListener('click', redo);
  r('save').addEventListener('click', () => save());
  if (id === 'weapons') ctx.setWeapons(data, true);

  render(); renderInspector(); renderRegistry();
  const doc = {
    kind: 'data', id, title: info.title, icon: '≡', is3D: false, overlay, tools, toolbar, inspector,
    activate() { render(); renderInspector(); renderRegistry(); }, // 다른 곳(모델 등록 등)에서 바뀐 것을 반영
    deactivate() {}, resize() {}, frame() {},
    isDirty, save, reload,
    // 홈에서 고른 항목으로 바로 간다 ({ select: id, slot })
    focus({ select, slot: s, create }) {
      if (create) { createItem(); return; }
      if (id === 'parts' && s) slot = s;
      const i = list().findIndex(x => x.id === select);
      if (i >= 0) cur = i;
      render(); renderInspector();
    },
    onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
    },
    dispose() {},
    setSkills(list) { skillList = list; render(); renderInspector(); },
    api: { createItem, get data() { return data; }, get cur() { return cur; }, select: i => { cur = i; render(); renderInspector(); }, setSlot: s => { slot = s; cur = 0; render(); renderInspector(); }, get errors() { return errors; }, isDirty, save, undo, redo, render },
  };
  return doc;
}
