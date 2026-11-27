// 킬피드와 알림 줄 (오른쪽 위)
import { WEAPONS } from '/shared/weapons.js';
import { $, esc } from '../util.js';
import { nameOf, sideOf } from './common.js';

const HOW_ICON = { head: '◎', normal: '✕', fall: '⤓', melee: '⚔', blast: '✸', bleed: '♦', env: '☢' };
const HOW_NAME = { head: '헤드샷', normal: '처치', fall: '낙사', melee: '근접', blast: '폭발', bleed: '출혈', env: '환경' };
const feedEl = $('feed');
export function killFeed(k, v, wi, how) {
  const row = document.createElement('div'); row.className = 'kf';
  const w = WEAPONS[wi];
  const killer = k >= 0 ? `<span class="${sideOf(k)}">${esc(nameOf(k))}</span>` : '';
  row.innerHTML = `${killer}<span class="wi" title="${w ? esc(w.name) : ''}">${w && k >= 0 ? esc(w.cls) : ''}</span><b class="how ${how}" title="${HOW_NAME[how] || ''}">${HOW_ICON[how] || '✕'}</b><span class="${sideOf(v)}">${esc(nameOf(v))}</span>`;
  feedEl.prepend(row);
  while (feedEl.children.length > 5) feedEl.lastChild.remove();
  setTimeout(() => { row.classList.add('out'); setTimeout(() => row.remove(), 400); }, 6000);
}
export function feedNote(html) {
  const row = document.createElement('div'); row.className = 'kf note'; row.innerHTML = html;
  feedEl.prepend(row); setTimeout(() => row.remove(), 4000);
}

