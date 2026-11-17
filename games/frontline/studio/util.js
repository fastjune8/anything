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
