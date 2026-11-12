// DOM 갱신 도우미: 값이 바뀔 때만 DOM 을 건드려서 매 프레임 호출해도 부담이 없다
export const cache = new Map();
export function setText(el, v) { if (cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } }
export function setDisplay(el, on, mode = 'block') { const v = on ? mode : 'none'; if (el.style.display !== v) el.style.display = v; }
export function setClass(el, name, on) { if (el.classList.contains(name) !== on) el.classList.toggle(name, on); }
