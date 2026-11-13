// 시작 메뉴(이름 입력/입장)와 설정(감도/음량)
import { connect } from './net.js';
import { sfx } from './sfx.js';
import { me, inp } from './state.js';
import { MODES } from '/shared/modes.js';
import { getMap } from '/shared/maps/index.js';
import { $, MODE, MODE_CFG, esc } from './util.js';

export const nameEl = $('name');
nameEl.value = localStorage.getItem('fd_name') || '';

export function join() {
  const name = nameEl.value.trim().slice(0, 14) || `병사${Math.floor(Math.random() * 900 + 100)}`;
  me.name = name; localStorage.setItem('fd_name', name);
  $('msg').textContent = ''; $('join').disabled = true;
  sfx.init();
  connect(name);
}
$('join').addEventListener('click', join);
$('join').textContent = `${MODE_CFG.name} 입장`;

// ───── 로비: 모드 선택 ─────
// 맵이 모드마다 달라서, 다른 모드를 고르면 그 모드로 페이지를 다시 연다 (이름은 저장해 둔다).
const modesEl = $('modes');
const modeCountEls = {};
for (const m of Object.values(MODES)) {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.mode = m.id; b.className = m.id === MODE ? 'on' : '';
  b.innerHTML = `<span class="mn">${esc(m.name)}</span><span class="md">${esc(m.desc)} · 맵: ${esc(getMap(m.map).name)}</span><span class="mc"></span>`;
  b.addEventListener('click', () => {
    if (m.id === MODE) return;
    localStorage.setItem('fd_mode', m.id);
    localStorage.setItem('fd_name', nameEl.value.trim().slice(0, 14));
    const q = new URLSearchParams(location.search); q.set('mode', m.id); q.delete('auto');
    location.search = q.toString();
  });
  modeCountEls[m.id] = b.querySelector('.mc');
  modesEl.appendChild(b);
}
localStorage.setItem('fd_mode', MODE);

// 모드별 접속 인원 표시 (메뉴가 보이는 동안 5초마다 갱신)
function refreshCounts() {
  if ($('menu').style.display === 'none') return;
  fetch('/status').then(r => r.json()).then(st => {
    for (const [id, el] of Object.entries(modeCountEls)) {
      const n = st.modes && st.modes[id] ? st.modes[id].humans : 0;
      el.textContent = n > 0 ? `지금 ${n}명 플레이 중` : '지금 입장하면 봇과 바로 시작';
    }
  }).catch(() => {});
}
refreshCounts(); setInterval(refreshCounts, 5000);
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

// 설정은 브라우저에 저장해 다음 접속에도 유지한다
const sensEl = $('sens'), volEl = $('vol');
sensEl.value = inp.sens; $('sensV').textContent = inp.sens.toFixed(2);
sensEl.addEventListener('input', () => { inp.sens = Number(sensEl.value); $('sensV').textContent = inp.sens.toFixed(2); localStorage.setItem('fd_sens', inp.sens); });
const savedVol = localStorage.getItem('fd_vol');
if (savedVol !== null) { volEl.value = savedVol; sfx.volume = Number(savedVol); }
$('volV').textContent = Number(volEl.value).toFixed(2);
volEl.addEventListener('input', () => { const v = Number(volEl.value); sfx.setVolume(v); $('volV').textContent = v.toFixed(2); localStorage.setItem('fd_vol', v); });
