// 시작 메뉴(이름 입력/입장)와 설정(감도/음량)
import { connect } from './net.js';
import { sfx } from './sfx.js';
import { me, inp } from './state.js';
import { $ } from './util.js';

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
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

// 설정은 브라우저에 저장해 다음 접속에도 유지한다
const sensEl = $('sens'), volEl = $('vol');
sensEl.value = inp.sens; $('sensV').textContent = inp.sens.toFixed(2);
sensEl.addEventListener('input', () => { inp.sens = Number(sensEl.value); $('sensV').textContent = inp.sens.toFixed(2); localStorage.setItem('fd_sens', inp.sens); });
const savedVol = localStorage.getItem('fd_vol');
if (savedVol !== null) { volEl.value = savedVol; sfx.volume = Number(savedVol); }
$('volV').textContent = Number(volEl.value).toFixed(2);
volEl.addEventListener('input', () => { const v = Number(volEl.value); sfx.setVolume(v); $('volV').textContent = v.toFixed(2); localStorage.setItem('fd_vol', v); });
