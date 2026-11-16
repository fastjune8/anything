// 창 크기 조절: 패널 사이의 경계선(.split / .hsplit)을 마우스로 끌어 너비·높이를 바꾼다.
//   data-var  = 바꿀 CSS 변수 (예: --ed-l), data-side = left | right | bottom (어느 쪽 패널의 크기인가)
// 바꾼 크기는 브라우저에 기억하고, 경계선을 더블클릭하면 원래 크기로 돌아간다.
const KEY = 'fs_layout_v1';
const root = document.documentElement;

function loadSaved() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function store(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 저장이 막혀도 이번 화면에서는 동작 */ } }

export function initSplitters() {
  const saved = loadSaved();
  for (const [v, px] of Object.entries(saved)) root.style.setProperty(v, `${px}px`);

  for (const bar of document.querySelectorAll('.split, .hsplit')) {
    const v = bar.dataset.var, side = bar.dataset.side;
    bar.title = '끌어서 크기 조절 · 더블클릭 = 원래 크기';
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing', side === 'bottom' ? 'resizing-v' : 'resizing-h'); // 끄는 동안 iframe·글자 선택이 끼어들지 않게
      bar.classList.add('on');
      const box = bar.parentElement.getBoundingClientRect();
      const target = side === 'bottom' ? document.getElementById(bar.dataset.target) : null;
      const move = ev => {
        let px;
        if (side === 'left') px = Math.min(box.width * 0.45, Math.max(150, ev.clientX - box.left));
        else if (side === 'right') px = Math.min(box.width * 0.5, Math.max(200, box.right - ev.clientX));
        else px = Math.min(innerHeight * 0.6, Math.max(60, target.getBoundingClientRect().bottom - ev.clientY));
        root.style.setProperty(v, `${Math.round(px)}px`);
      };
      const up = () => {
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing', 'resizing-v', 'resizing-h'); bar.classList.remove('on');
        const all = loadSaved(); all[v] = parseFloat(getComputedStyle(root).getPropertyValue(v)); store(all);
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', () => { root.style.removeProperty(v); const all = loadSaved(); delete all[v]; store(all); });
  }
}
