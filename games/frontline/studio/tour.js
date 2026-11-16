// 처음 켠 사람을 위한 짧은 튜토리얼: 화면의 각 부분을 차례로 밝히며 역할과 버튼 위치를 알려 준다.
// 한 번 끝내거나 건너뛰면 다시 나오지 않는다 (도움말 → "튜토리얼 다시 보기").
const KEY = 'fs_tour_done_v1';

// before: 그 단계를 보여 주기 전에 화면을 맞춘다 (홈으로 가기, 맵 열기 등)
export function tourSteps(api) {
  return [
    { title: 'FRONTIER Studio 에 오신 것을 환영합니다', text: '게임의 맵·모델·수치를 만드는 도구입니다. 1분 정도로 화면 구성을 안내할게요. 언제든 "건너뛰기" 를 누르면 됩니다.' },
    { target: '.tab.home', before: () => api.goHome(), title: '홈', text: '모든 데이터를 모아 보는 곳입니다. 길을 잃으면 언제든 이 탭으로 돌아오세요.' },
    { target: '#homeNav', title: '데이터 종류', text: '맵 · 모델 · 무기 · 파츠 · 모드를 고릅니다. 아래에는 편집기 목록이 있고, "효과" 처럼 준비 중인 것도 미리 보입니다.' },
    { target: '#homeCards', title: '목록', text: '카드를 한 번 누르면 오른쪽에 자세한 정보가, 두 번 누르면 맞는 편집기가 열립니다. "+ 새 맵" 같은 만들기 버튼은 위쪽에 있습니다.' },
    { target: '#homeDetail', before: () => api.selectFirst(), title: '자세히', text: '고른 것의 정보와 연결된 데이터(예: 이 맵을 쓰는 모드)를 보여 줍니다. 파란 버튼으로 편집기를 엽니다.' },
    { target: '.tab.active', before: () => api.openFirstMap(), title: '편집기 탭', text: '편집기는 위쪽에 탭으로 열립니다. 탭의 ● 는 저장하지 않은 것이 있다는 뜻이고, × 로 닫습니다.' },
    { target: '#edHead', title: '편집기 버튼', text: '지금 편집기의 이름과 버튼입니다. 되돌리기 · 보기 · 저장 · ▶ 플레이(맵)가 여기 모여 있습니다.' },
    { target: '#toolbox', title: '도구 상자', text: '편집기마다 다릅니다. 맵 에디터에서는 놓을 물체·스폰·거점을 고릅니다. 묶음 제목을 누르면 접힙니다.' },
    { target: '#stage', title: '화면', text: '클릭으로 고르고 끌어서 옮깁니다. 카메라는 WASD 로 움직이고 Q/E 로 돌립니다.' },
    { target: '#inspector', title: '속성', text: '고른 것의 수치를 여기서 고칩니다. 아무것도 고르지 않으면 맵 전체 설정이 나옵니다.' },
    { target: '#status', title: '상태 막대', text: '저장·오류 같은 마지막 기록이 나옵니다. "콘솔" 을 누르면 전체 기록을 봅니다.' },
    { target: '#helpBtn', title: '도움말', text: '단축키와 사용법은 모두 여기 있습니다 (F1). 튜토리얼도 여기서 다시 볼 수 있어요. 이제 시작해 보세요!' },
  ];
}

export function createTour(api) {
  const root = document.getElementById('tour'), hole = document.getElementById('tourHole'), tip = document.getElementById('tourTip');
  let steps = [], i = 0;
  const done = () => { try { localStorage.setItem(KEY, '1'); } catch { /* 저장이 막혀도 괜찮다 */ } };
  const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

  async function show(n) {
    i = n;
    const s = steps[i];
    if (s.before) await s.before();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t = s.target && document.querySelector(s.target);
    const r = t ? t.getBoundingClientRect() : null;
    if (r) Object.assign(hole.style, { display: 'block', left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    else Object.assign(hole.style, { display: 'block', left: '50%', top: '40%', width: '0px', height: '0px' });
    tip.innerHTML = `<h3></h3><p></p><footer><span class="n">${i + 1} / ${steps.length}</span>
      <button type="button" data-a="skip">건너뛰기</button>${i ? '<button type="button" data-a="prev">이전</button>' : ''}
      <button type="button" class="primary" data-a="next">${i === steps.length - 1 ? '시작하기' : '다음'}</button></footer>`;
    tip.querySelector('h3').textContent = s.title; tip.querySelector('p').textContent = s.text;
    tip.querySelector('[data-a="skip"]').addEventListener('click', end);
    tip.querySelector('[data-a="next"]').addEventListener('click', () => (i === steps.length - 1 ? end() : show(i + 1)));
    const prev = tip.querySelector('[data-a="prev"]'); if (prev) prev.addEventListener('click', () => show(i - 1));
    // 말풍선 위치: 밝힌 곳 옆 (오른쪽 → 왼쪽 → 아래 → 위 순서로 들어가는 곳)
    const W = 330, H = tip.offsetHeight || 170, M = 14, vw = innerWidth, vh = innerHeight;
    let x, y;
    if (!r) { x = (vw - W) / 2; y = vh * 0.35; }
    else if (r.right + M + W < vw) { x = r.right + M; y = r.top; }
    else if (r.left - M - W > 0) { x = r.left - M - W; y = r.top; }
    else if (r.bottom + M + H < vh) { x = r.left; y = r.bottom + M; }
    else { x = r.left; y = r.top - M - H; }
    tip.style.left = `${Math.max(M, Math.min(vw - W - M, x))}px`; tip.style.top = `${Math.max(M, Math.min(vh - H - M, y))}px`;
    tip.querySelector('[data-a="next"]').focus();
  }
  function start() { steps = tourSteps(api); root.hidden = false; show(0); }
  function end() { root.hidden = true; done(); api.goHome(); }
  addEventListener('resize', () => { if (!root.hidden) show(i); });
  return { start, end, startIfNew() { if (!seen()) start(); }, get running() { return !root.hidden; } };
}
