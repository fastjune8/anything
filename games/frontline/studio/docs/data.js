// 게임 데이터 문서: content/weapons.json · parts.json · modes.json 을 표와 입력 칸으로 고친다.
// 가운데 = 목록과 비교 표 (고치는 대로 바로 다시 계산), 오른쪽 = 고른 항목의 입력 칸 (스키마로 자동 생성).
// 저장하면 개발 서버가 다시 시작되어 게임에 반영된다.
import { WEAPON_SCHEMA, PART_SCHEMA, MODE_SCHEMA, RULES, checkWeapons, checkParts, checkModes } from '/shared/content/schema.js';
import { calcDamage } from '/shared/weapons.js';
import { describePart } from '/shared/parts.js';
import { buildForm } from '../form.js';

export const DATA_DOCS = [
  { id: 'weapons', title: '무기', file: 'weapons.json' },
  { id: 'parts', title: '파츠', file: 'parts.json' },
  { id: 'modes', title: '모드', file: 'modes.json' },
];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
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

  const overlay = el('div', 'page'); const page = el('div', 'datapage'); overlay.appendChild(page);
  const tools = el('div');
  tools.innerHTML = `<p class="note">${info.file} 의 항목을 고릅니다. 오른쪽에서 수치를 고치면 가운데 표가 바로 다시 계산됩니다.</p>
    <p class="note">저장(⌘S)하면 개발 서버가 다시 시작되어 게임에 반영됩니다.</p>`;
  const toolbar = el('div');
  toolbar.innerHTML = `<button type="button" data-r="undo" title="되돌리기 (⌘Z)">↶</button><button type="button" data-r="redo" title="다시 하기 (⌘⇧Z)">↷</button>
    <span class="sep"></span><button type="button" class="primary" data-r="save" title="저장 (⌘S)">저장</button><span class="status" data-r="status"></span>`;
  const inspector = el('div');
  const r = n => toolbar.querySelector(`[data-r="${n}"]`);

  // 지금 고르고 있는 항목과 그 스키마
  const list = () => (id === 'parts' ? data.parts[slot] : data);
  const schema = () => (id === 'weapons' ? WEAPON_SCHEMA : id === 'parts' ? PART_SCHEMA : MODE_SCHEMA);
  const item = () => list()[cur];
  const check = () => (id === 'weapons' ? checkWeapons(data) : id === 'parts' ? checkParts(data, ctx.weaponIds()) : checkModes(data, ctx.assets().maps).concat(data.filter(m => !RULES.includes(m.rules)).map(m => `모드 ${m.id}: 없는 규칙`)));

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
    if (id !== 'weapons') { // 무기는 모델이 있어야 해서 여기서 새로 만들지 않는다
      const add = el('button', '', '+ 추가'); add.type = 'button'; add.dataset.act = 'add';
      add.addEventListener('click', addItem); box.appendChild(add);
    }
    return box;
  }
  function addItem() {
    const base = JSON.parse(JSON.stringify(item() || {}));
    const taken = new Set(list().map(x => x.id));
    let n = 2; while (taken.has(`${base.id || 'new'}_${n}`)) n++;
    base.id = `${base.id || 'new'}_${n}`; base.name = `${base.name || '새 항목'} ${n}`;
    list().push(base); cur = list().length - 1;
    commit(); renderInspector();
  }
  function removeItem() {
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
      page.append(table(['무기', '분류', '피해', '분당', 'DPS (10m)', 'TTK 10m', 'TTK 30m', 'TTK 60m', '머리 TTK 10m', '탄창', '재장전', '이동'],
        data.map((w, i) => ({
          on: i === cur,
          cells: [w.name, w.cls, `${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''}`, w.rpm, (() => { const d = el('span'); d.append(fmt(dps[i]), bar(dps[i], maxDps)); return d; })(),
            `${fmt(ttk(w, 10))}ms`, `${fmt(ttk(w, 30))}ms`, `${fmt(ttk(w, 60))}ms`, `${fmt(ttk(w, 10, 'head'))}ms`, w.mag, `${w.reload}s`, `${Math.round(w.move * 100)}%`],
        })), i => { cur = i; render(); renderInspector(); }));
      page.append(el('p', 'dnote', '무기 추가는 총 모델이 게임에 연결된 뒤에 지원한다 (지금은 코드로 만든 총 7종).'));
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
    } else {
      page.append(el('p', 'lead', '로비에 보이는 순서대로. 모드의 점수·승리 규칙 자체는 server/modes/ 코드에 있고, 여기서는 수치를 고친다.'), itemButtons());
      page.append(table(['모드', '규칙', '맵', '인원', '봇 채움', '팀', '목표', '점령 시간'], data.map((m, i) => ({
        on: i === cur, cells: [m.name, m.rules, m.map, m.max, m.fill, m.teams || '개인전', m.goal, m.zone ? `${m.zone.capture}s` : '—'],
      })), i => { cur = i; render(); renderInspector(); }));
    }
    if (errors.length) {
      const box = el('div', 'errors'); box.style.position = 'static'; box.style.marginTop = '12px'; box.style.maxWidth = 'none';
      for (const e of errors.slice(0, 10)) box.appendChild(el('div', '', e));
      page.appendChild(box);
    }
    r('save').disabled = !!errors.length;
    const d = isDirty(); r('status').textContent = d ? '저장 안 됨' : '저장됨'; r('status').className = `status${d ? ' dirty' : ''}`;
  }

  // ───────── 오른쪽: 고른 항목의 입력 칸 ─────────
  function renderInspector() {
    inspector.replaceChildren();
    const x = item();
    if (!x) return;
    inspector.appendChild(el('h2', '', `${x.name || x.id}`));
    buildForm(inspector, schema(), x, { onInput: () => render(), onCommit: () => { commit(); renderInspector(); } });
    if (id !== 'weapons') {
      const btns = el('div', 'btns'), del = el('button', 'danger', '삭제'); del.type = 'button';
      del.addEventListener('click', removeItem); btns.appendChild(del); inspector.appendChild(btns);
    }
  }

  async function save() {
    errors = check();
    if (errors.length) { ctx.flash('검사 오류가 있어 저장할 수 없습니다'); ctx.log(`저장 실패 (${info.file}): ${errors[0]}`, 'error'); return false; }
    const res2 = await fetch(`/api/content/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res2.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
    if (!out.ok) { ctx.flash('저장 실패'); ctx.log(`저장 실패 (${info.file}): ${(out.errors || []).join(' / ')}`, 'error'); return false; }
    saved = JSON.stringify(data); render(); ctx.changed();
    ctx.log(`저장: content/${info.file} — 개발 서버가 다시 시작되어 게임에 반영됩니다`, 'ok'); ctx.flash('저장했습니다');
    if (id === 'weapons') ctx.setWeapons(data);
    return true;
  }
  r('undo').addEventListener('click', undo);
  r('redo').addEventListener('click', redo);
  r('save').addEventListener('click', () => save());
  if (id === 'weapons') ctx.setWeapons(data, true);

  render(); renderInspector();
  return {
    kind: 'data', id, title: info.title, icon: '≡', is3D: false, overlay, tools, toolbar, inspector,
    activate() {}, deactivate() {}, resize() {}, frame() {},
    isDirty, save,
    onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
    },
    dispose() {},
    api: { get data() { return data; }, get cur() { return cur; }, select: i => { cur = i; render(); renderInspector(); }, setSlot: s => { slot = s; cur = 0; render(); renderInspector(); }, get errors() { return errors; }, isDirty, save, undo, redo, render },
  };
}
