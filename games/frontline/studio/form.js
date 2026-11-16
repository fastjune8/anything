// 스키마(shared/content/schema.js) → 입력 칸 자동 생성.
// buildForm(부모, 정의(obj), 값 객체, { onInput, onCommit, skip })
//  - 입력하는 동안 값 객체를 바로 고치고 onInput() (화면 미리보기), 입력이 끝나면 onCommit() (되돌리기 기록)
//  - 목록(문·창문 등)은 항목 추가/삭제 후 폼을 다시 그린다 (onCommit 이 다시 그리기를 맡는다)

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const round = v => Math.round(v * 1000) / 1000;

// 기본값: 목록에 새 항목을 더할 때
function blank(spec) {
  switch (spec.kind) {
    case 'num': case 'int': return spec.min !== undefined && spec.min > 0 ? spec.min : 0;
    case 'str': return '';
    case 'bool': return false;
    case 'enum': return spec.options[0];
    case 'color': return '#888888';
    case 'point': return [0, 0];
    case 'list': return [];
    case 'obj': { const o = {}; for (const [k, f] of Object.entries(spec.fields)) if (!f.optional) o[k] = blank(f); return o; }
    default: return null;
  }
}

// 값 하나를 고치는 입력 칸. get/set: 값 읽기/쓰기 (set(undefined) = 칸 지우기)
function input(spec, get, set, h) {
  const wrap = el('span', 'in');
  const v = get();
  if (spec.kind === 'num' || spec.kind === 'int') {
    const i = el('input'); i.type = 'number'; i.step = spec.kind === 'int' ? 1 : spec.step ?? 0.1;
    if (spec.min !== undefined) i.min = spec.min;
    if (spec.max !== undefined) i.max = spec.max;
    i.value = v ?? ''; if (spec.optional) i.placeholder = '(기본값)';
    i.addEventListener('input', () => { if (i.value === '') { if (spec.optional) set(undefined); } else { const n = Number(i.value); if (Number.isFinite(n)) set(spec.kind === 'int' ? Math.round(n) : round(n)); } h.onInput(); });
    i.addEventListener('change', () => h.onCommit());
    wrap.appendChild(i);
  } else if (spec.kind === 'str') {
    const i = el('input'); i.type = 'text'; i.value = v ?? '';
    i.addEventListener('input', () => { set(i.value || (spec.optional ? undefined : '')); h.onInput(); });
    i.addEventListener('change', () => h.onCommit());
    wrap.appendChild(i);
  } else if (spec.kind === 'bool') {
    const i = el('input'); i.type = 'checkbox'; i.checked = !!v;
    i.addEventListener('change', () => { set(i.checked ? true : spec.optional ? undefined : false); h.onInput(); h.onCommit(); });
    wrap.appendChild(i);
  } else if (spec.kind === 'enum') {
    const s = el('select');
    if (spec.optional) s.appendChild(new Option('(기본값)', ''));
    for (const o of spec.options) s.appendChild(new Option(String(o), String(o)));
    s.value = v === undefined ? '' : String(v);
    s.addEventListener('change', () => {
      const raw = s.value, opt = spec.options.find(o => String(o) === raw);
      set(raw === '' ? undefined : opt); h.onInput(); h.onCommit();
    });
    wrap.appendChild(s);
  } else if (spec.kind === 'color') {
    const i = el('input'); i.type = 'color'; i.value = v || '#888888';
    i.addEventListener('input', () => { set(i.value); h.onInput(); });
    i.addEventListener('change', () => h.onCommit());
    wrap.appendChild(i);
    if (spec.optional) {
      const x = el('button', 'mini', v ? '지우기' : '기본색'); x.type = 'button'; x.disabled = !v;
      x.addEventListener('click', () => { set(undefined); h.onInput(); h.onCommit(); });
      wrap.appendChild(x);
    }
  } else if (spec.kind === 'point') {
    for (const k of [0, 1]) {
      const i = el('input'); i.type = 'number'; i.step = 0.5; i.value = (v || [0, 0])[k];
      i.addEventListener('input', () => { const p = [...(get() || [0, 0])]; p[k] = round(Number(i.value) || 0); set(p); h.onInput(); });
      i.addEventListener('change', () => h.onCommit());
      wrap.appendChild(i);
    }
  }
  return wrap;
}

function row(label, hint, control, optional) {
  const r = el('label', 'row');
  const l = el('span', 'lbl', label); if (optional) l.classList.add('opt');
  if (hint) l.title = hint;
  r.append(l, control);
  return r;
}

// 목록 칸 (예: 문·창문). 항목이 객체면 한 줄에 칸을 나란히
function listField(parent, spec, get, set, h) {
  const box = el('div', 'list');
  const head = el('div', 'lhead'); head.append(el('span', 'lbl', spec.label));
  const add = el('button', 'mini', '+ 추가'); add.type = 'button';
  add.addEventListener('click', () => { const arr = [...(get() || [])]; arr.push(blank(spec.of)); set(arr); h.onInput(); h.onCommit(); });
  head.appendChild(add); box.appendChild(head);
  (get() || []).forEach((item, idx) => {
    const line = el('div', 'litem');
    if (spec.of.kind === 'obj') {
      for (const [k, f] of Object.entries(spec.of.fields)) {
        const cell = el('span', 'cell'); cell.append(el('small', '', f.label.split(' (')[0]));
        cell.appendChild(input(f, () => get()[idx][k], v => { if (v === undefined) delete get()[idx][k]; else get()[idx][k] = v; }, h));
        line.appendChild(cell);
      }
    } else line.appendChild(input(spec.of, () => get()[idx], v => { const arr = get(); arr[idx] = v; }, h));
    const del = el('button', 'mini del', '×'); del.type = 'button'; del.title = '삭제';
    del.addEventListener('click', () => { const arr = [...get()]; arr.splice(idx, 1); set(arr.length || !spec.optional ? arr : undefined); h.onInput(); h.onCommit(); });
    line.appendChild(del);
    box.appendChild(line);
  });
  parent.appendChild(box);
}

// 키 → 값 묶음 (예: 파츠의 성능 배율 { recoilV: 0.8, adsTime: 1.1 }). 정해진 키 중에서 골라 추가한다
function dictField(parent, spec, get, set, h) {
  const box = el('div', 'list');
  const head = el('div', 'lhead'); head.append(el('span', 'lbl', spec.label));
  const cur = get() || {};
  const free = (spec.keys || []).filter(k => !(k in cur));
  if (free.length) {
    const pickKey = el('select'); pickKey.appendChild(new Option('+ 추가', ''));
    for (const k of free) pickKey.appendChild(new Option((spec.keyLabels && spec.keyLabels[k]) || k, k));
    pickKey.addEventListener('change', () => { if (!pickKey.value) return; set({ ...(get() || {}), [pickKey.value]: 1 }); h.onInput(); h.onCommit(); });
    head.appendChild(pickKey);
  }
  box.appendChild(head);
  for (const k of Object.keys(cur)) {
    const line = el('div', 'litem');
    line.append(el('span', 'lbl', (spec.keyLabels && spec.keyLabels[k]) || k));
    line.appendChild(input(spec.of, () => get()[k], v => { const o = { ...get() }; if (v === undefined) delete o[k]; else o[k] = v; set(o); }, h));
    const del = el('button', 'mini del', '×'); del.type = 'button'; del.title = '삭제';
    del.addEventListener('click', () => { const o = { ...get() }; delete o[k]; set(o); h.onInput(); h.onCommit(); });
    line.appendChild(del);
    box.appendChild(line);
  }
  parent.appendChild(box);
}

export function buildForm(parent, spec, value, h) {
  const skip = h.skip || [];
  for (const [k, f] of Object.entries(spec.fields)) {
    if (skip.includes(k)) continue;
    const get = () => value[k], set = v => { if (v === undefined) delete value[k]; else value[k] = v; };
    if (f.kind === 'list') { listField(parent, f, get, set, h); continue; }
    if (f.kind === 'map') { dictField(parent, f, get, set, h); continue; }
    if (f.kind === 'obj') { // 묶음 (예: 건물의 네 벽 문·창문)
      const fs = el('fieldset'); fs.append(el('legend', '', f.label));
      if (value[k] === undefined && f.optional) { // 없는 선택 묶음은 보여 주기만 하면 데이터가 바뀌지 않게, 버튼으로 추가한다
        const add = el('button', 'mini', '+ 추가'); add.type = 'button';
        add.addEventListener('click', () => { value[k] = blank(f); h.onInput(); h.onCommit(); });
        fs.appendChild(add); parent.appendChild(fs); continue;
      }
      if (value[k] === undefined) value[k] = blank(f);
      buildForm(fs, f, value[k], h);
      parent.appendChild(fs);
      continue;
    }
    parent.appendChild(row(f.label, f.hint, input(f, get, set, h), f.optional));
  }
}
