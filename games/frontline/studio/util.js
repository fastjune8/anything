// 스튜디오 공용 도구: DOM 만들기, 데이터 파일 읽기·저장
// 저장은 서버의 PUT /api/content/<이름> (검사는 shared/content/registry.js — 서버와 스튜디오가 같은 검사)

// 태그 하나 만들기. text 는 글자 그대로 (HTML 이 아니다)
export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
// 태그 하나 만들기. inner 는 HTML (우리가 쓴 마크업만 넣는다 — 사용자 글자는 el 로)
export function html(tag, cls, inner) { const e = document.createElement(tag); if (cls) e.className = cls; if (inner) e.innerHTML = inner; return e; }
export const clone = v => JSON.parse(JSON.stringify(v));

// JSON 읽기 (캐시 없이). 실패하면 fallback
export const getJson = (url, fallback = null) => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : fallback)).catch(() => fallback);

// content/<name>.json 저장. 반환: { ok, errors }
export async function saveContent(name, data) {
  try {
    const res = await fetch(`/api/content/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return await res.json();
  } catch { return { ok: false, errors: ['서버 응답 오류'] }; }
}

// 도구 상자를 탭으로 나눈다 (모델 에디터 공통). 상자 안의 "제목(.tbx-h) + 다음 칸" 묶음을 제목 글자로 찾아 탭 칸에 옮긴다.
//   groups: [[탭 이름, [제목, …]], …]. 어느 탭에도 없는 것(맨 아래 안내 글 등)은 탭 밖 맨 아래에 남는다.
//   반환: { show(이름) } — 탭 바는 상자 맨 위에 생긴다
export function tabifyTools(tools, groups) {
  const heads = [...tools.querySelectorAll(':scope > .tbx-h')];
  const bar = el('div', 'mtabs'), panes = new Map(), btns = new Map();
  for (const [name, titles] of groups) {
    const pane = el('div', 'mpane'); pane.dataset.pane = name; pane.hidden = true;
    for (const t of titles) { const h = heads.find(x => x.textContent === t); if (h) { pane.append(h, h.nextElementSibling); } }
    const b = el('button', '', name); b.type = 'button'; b.dataset.tab = name;
    bar.appendChild(b); panes.set(name, pane); btns.set(name, b);
  }
  tools.prepend(bar);
  bar.after(...panes.values());
  function show(name) { for (const [n, p] of panes) { p.hidden = n !== name; btns.get(n).classList.toggle('on', n === name); } }
  bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); });
  show(groups[0][0]);
  return { show, panes, bar };
}
