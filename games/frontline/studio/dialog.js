// 입력 양식 창: 정해진 칸을 모두 올바르게 채워야 "만들기" 가 눌린다. 반환: 입력값 객체 또는 null(취소)
//   fields: [{ key, label, type: 'text' | 'select', options: [[값, 표시]], value, required, pattern, hint }]
//   validate(values) → 오류 문장 (없으면 null). 칸마다 형식 검사 뒤에 한 번 더 부른다 (예: id 중복)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function formDialog({ title, lead, fields, validate, ok = '만들기' }) {
  return new Promise(resolve => {
    const m = el('div', 'modal'), card = el('div', 'card'); card.style.width = 'min(480px, 92vw)';
    const head = el('header'); head.append(el('b', '', title));
    const body = el('div', 'form'); body.style.cssText = 'padding:14px 18px;display:grid;gap:10px';
    if (lead) body.appendChild(Object.assign(el('p', 'note'), { textContent: lead, style: 'margin:0' }));
    const inputs = {};
    for (const f of fields) {
      const row = el('label', 'kv'); row.style.gridTemplateColumns = '110px 1fr';
      row.append(el('span', '', `${f.label}${f.required ? ' *' : ''}`));
      let input;
      if (f.type === 'select') { input = el('select'); for (const [v, t] of f.options) input.appendChild(new Option(t, v)); }
      else { input = el('input'); input.type = 'text'; if (f.placeholder) input.placeholder = f.placeholder; }
      input.dataset.f = f.key;
      if (f.value !== undefined) input.value = f.value;
      row.appendChild(input); body.appendChild(row);
      if (f.hint) body.appendChild(Object.assign(el('p', 'note'), { textContent: f.hint, style: 'margin:-6px 0 0 120px' }));
      inputs[f.key] = input;
    }
    const err = el('p', 'note'); err.style.cssText = 'color:var(--danger);margin:0;min-height:18px'; body.appendChild(err);
    const foot = el('footer'), cancel = el('button', '', '취소'), go = el('button', 'primary', ok);
    cancel.type = go.type = 'button'; go.dataset.f = 'go';
    foot.append(el('span', 'grow'), cancel, go);
    card.append(head, body, foot); m.appendChild(card); document.body.appendChild(m);

    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
    function problem() { // 형식이 틀린 칸 → 중복 같은 내용 문제 → 빈 칸 순서로 알려 준다 (입력한 것에 대한 안내가 먼저)
      const v = values();
      for (const f of fields) if (v[f.key] && f.pattern && !new RegExp(f.pattern).test(v[f.key])) return `"${f.label}" 형식이 맞지 않습니다 — ${f.hint || f.pattern}`;
      const bad = validate ? validate(v) : null;
      if (bad) return bad;
      for (const f of fields) if (f.required && !v[f.key]) return `"${f.label}" 을(를) 입력하세요`;
      return null;
    }
    const refresh = () => { const p = problem(); err.textContent = p || ''; go.disabled = !!p; };
    for (const i of Object.values(inputs)) i.addEventListener('input', refresh);
    const done = v => { m.remove(); removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } else if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); e.stopPropagation(); done(values()); } };
    addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done(null));
    go.addEventListener('click', () => { if (!problem()) done(values()); });
    m.addEventListener('click', e => { if (e.target === m) done(null); });
    refresh();
    Object.values(inputs)[0].focus();
  });
}
