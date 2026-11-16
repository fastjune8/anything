// 창 크기 조절: 패널 사이의 경계선(.split / .hsplit)을 마우스로 끌어 너비·높이를 바꾼다.
//   data-var  = 바꿀 CSS 변수 (예: --ed-l), data-side = left | right | bottom (어느 쪽 패널의 크기인가)
// 스튜디오는 항상 기본 크기로 열리고, 그 화면에서만 바뀐다 (다음에 열면 다시 기본 크기). 더블클릭 = 기본 크기.
// 주의: CSS 변수에 잘못된 값(예: NaNpx)이 들어가면 grid 전체가 무효가 되어 패널이 위아래로 쌓인다 → 실제로 끈 경우에만, 숫자일 때만 바꾼다.
const root = document.documentElement;

export function initSplitters() {
  try { localStorage.removeItem('fs_layout_v1'); } catch { /* 예전 버전이 남긴 크기(잘못된 값일 수 있음)를 지운다 */ }

  for (const bar of document.querySelectorAll('.split, .hsplit')) {
    const v = bar.dataset.var, side = bar.dataset.side;
    bar.title = '끌어서 크기 조절 · 더블클릭 = 기본 크기';
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const box = bar.parentElement.getBoundingClientRect();
      const target = side === 'bottom' ? document.getElementById(bar.dataset.target) : null;
      const x0 = e.clientX, y0 = e.clientY;
      let dragging = false;
      const move = ev => {
        if (!dragging) { // 몇 픽셀 이상 움직였을 때만 끌기로 본다 (클릭·더블클릭은 크기를 건드리지 않는다)
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
          dragging = true;
          document.body.classList.add('resizing', side === 'bottom' ? 'resizing-v' : 'resizing-h'); // 끄는 동안 iframe·글자 선택이 끼어들지 않게
          bar.classList.add('on');
        }
        let px;
        if (side === 'left') px = Math.min(box.width * 0.45, Math.max(150, ev.clientX - box.left));
        else if (side === 'right') px = Math.min(box.width * 0.5, Math.max(200, box.right - ev.clientX));
        else px = Math.min(innerHeight * 0.6, Math.max(60, target.getBoundingClientRect().bottom - ev.clientY));
        if (Number.isFinite(px)) root.style.setProperty(v, `${Math.round(px)}px`);
      };
      const up = () => {
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing', 'resizing-v', 'resizing-h'); bar.classList.remove('on');
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', () => root.style.removeProperty(v));
  }
}
