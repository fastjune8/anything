// 로비: 이름 입력, 빠른 시작(모드 선택), 친선전(방 목록/코드 입장/방 만들기), 설정(감도/음량)
// 모드를 고르거나 방에 들어가도 페이지는 다시 열리지 않는다. 맵만 그 자리에서 바뀐다.
import { MODES } from '/shared/modes.js';
import { getMap } from '/shared/maps/index.js';
import { connect, leaveToLobby } from './net.js';
import { loadMap } from './scene.js';
import { sfx } from './sfx.js';
import { me, inp } from './state.js';
import { $, MODE_CFG, setMode, params } from './util.js';

export const nameEl = $('name');
nameEl.value = localStorage.getItem('fd_name') || '';
const menuOpen = () => $('menu').style.display !== 'none';

// 입장 직전 공통 처리: 이름 정리/저장, 버튼 잠금, 소리 시작. 반환: 이름
function beforeJoin() {
  const name = nameEl.value.trim().slice(0, 14) || `병사${Math.floor(Math.random() * 900 + 100)}`;
  me.name = name; localStorage.setItem('fd_name', name);
  $('msg').textContent = ''; $('join').disabled = true;
  sfx.init();
  return name;
}
// 빠른 시작. 주소에 map 이 있으면 (에디터의 시험 플레이) 그 맵으로 혼자 쓰는 비공개 방을 만든다
export function join() {
  const map = params.get('map');
  if (map) connect(beforeJoin(), { mode: MODE_CFG.id, create: { name: `맵 시험 · ${map}`, private: true, bots: params.get('bots') !== '0', minutes: 10, map } });
  else connect(beforeJoin(), { mode: MODE_CFG.id });
}
$('join').addEventListener('click', join);
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

// ───── 탭 ─────
let tab = 'quick';
function showTab(t) {
  tab = t;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === t);
  $('paneQuick').hidden = t !== 'quick';
  $('paneCustom').hidden = t !== 'custom';
  document.querySelector('#menu .card').classList.toggle('custom', t === 'custom');
  if (t === 'custom') refreshRooms();
  $('msg').textContent = '';
}
for (const b of $('tabs').children) b.addEventListener('click', () => showTab(b.dataset.tab));

// ───── 빠른 시작: 모드 카드 ─────
const modeCountEls = {};
function selectMode(id) {
  setMode(id);
  loadMap(MODES[id].map); // 배경에 그 모드의 맵이 바로 보인다
  for (const b of $('modes').children) b.classList.toggle('on', b.dataset.mode === id);
  $('join').textContent = `${MODES[id].name} 입장`;
}
for (const m of Object.values(MODES)) {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.mode = m.id;
  for (const [cls, text] of [['mn', m.name], ['md', `${m.desc} · 맵: ${getMap(m.map).name}`], ['mc', '']]) {
    const s = document.createElement('span'); s.className = cls; s.textContent = text; b.appendChild(s);
  }
  b.addEventListener('click', () => selectMode(m.id));
  modeCountEls[m.id] = b.querySelector('.mc');
  $('modes').appendChild(b);
}
selectMode(MODE_CFG.id);

// ───── 친선전: 방 목록 / 코드 입장 / 방 만들기 ─────
function renderRooms(rooms) {
  const list = $('roomList');
  list.replaceChildren();
  $('roomEmpty').hidden = rooms.length > 0;
  for (const r of rooms) {
    const row = document.createElement('div'); row.className = 'roomrow';
    const name = document.createElement('span'); name.className = 'rn'; name.textContent = r.name; // textContent: 방 이름에 HTML 이 있어도 글자 그대로 표시
    const info = document.createElement('span'); info.className = 'rm';
    info.textContent = `${MODES[r.mode] ? MODES[r.mode].name : r.mode} · ${r.humans}/${r.max}명 · ${r.minutes}분${r.bots ? ' · 봇' : ''} · ${r.code}`;
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = r.humans >= r.max ? '가득 참' : '입장'; btn.disabled = r.humans >= r.max;
    btn.addEventListener('click', () => connect(beforeJoin(), { code: r.code }));
    row.append(name, info, btn);
    list.appendChild(row);
  }
}
function refreshRooms() {
  fetch('/rooms').then(r => r.json()).then(d => { if (tab === 'custom') renderRooms(d.rooms); }).catch(() => {});
}
$('codeJoin').addEventListener('click', () => {
  const code = $('codeIn').value.trim().toUpperCase();
  if (code.length !== 4) { $('msg').textContent = '입장 코드는 4글자입니다.'; return; }
  connect(beforeJoin(), { code });
});
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('codeJoin').click(); });

let createMode = MODE_CFG.id;
for (const m of Object.values(MODES)) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = m.id; b.textContent = m.name;
  b.addEventListener('click', () => { createMode = m.id; for (const x of $('createMode').children) x.classList.toggle('on', x.dataset.mode === m.id); });
  $('createMode').appendChild(b);
}
for (const x of $('createMode').children) x.classList.toggle('on', x.dataset.mode === createMode);
$('createForm').addEventListener('submit', e => {
  e.preventDefault();
  setMode(createMode);
  connect(beforeJoin(), {
    mode: createMode,
    create: { name: $('roomName').value, private: $('optPrivate').checked, bots: $('optBots').checked, minutes: Number($('optMinutes').value) },
  });
});

// ───── 접속 인원 / 방 목록 갱신 (로비가 보이는 동안만) ─────
function refreshCounts() {
  fetch('/status').then(r => r.json()).then(st => {
    for (const [id, el] of Object.entries(modeCountEls)) {
      const n = st.modes && st.modes[id] ? st.modes[id].humans : 0;
      el.textContent = n > 0 ? `지금 ${n}명 플레이 중` : '지금 입장하면 봇과 바로 시작';
    }
  }).catch(() => {});
}
refreshCounts();
setInterval(() => { if (menuOpen()) { refreshCounts(); if (tab === 'custom') refreshRooms(); } }, 3000);

// ───── 일시정지 → 로비로 나가기 ─────
$('leave').addEventListener('click', () => { leaveToLobby(); showTab(tab); selectMode(MODE_CFG.id); });

// ───── 설정은 브라우저에 저장해 다음 접속에도 유지한다 ─────
const sensEl = $('sens'), volEl = $('vol');
sensEl.value = inp.sens; $('sensV').textContent = inp.sens.toFixed(2);
sensEl.addEventListener('input', () => { inp.sens = Number(sensEl.value); $('sensV').textContent = inp.sens.toFixed(2); localStorage.setItem('fd_sens', inp.sens); });
const savedVol = localStorage.getItem('fd_vol');
if (savedVol !== null) { volEl.value = savedVol; sfx.volume = Number(savedVol); }
$('volV').textContent = Number(volEl.value).toFixed(2);
volEl.addEventListener('input', () => { const v = Number(volEl.value); sfx.setVolume(v); $('volV').textContent = v.toFixed(2); localStorage.setItem('fd_vol', v); });
