// 로비 화면 (기획 12장·13장·3.3·11.3): 내 정보(레벨·경험치·전적) · 모드 선택과 빠른 매칭 · 커스텀 방 ·
// 출전 무기 2자루와 자리별 스킬 · 외형 · 파티 · 친구 · 로비/파티 채팅
import { WEAPONS } from '/shared/weapons.js';
import { MODES } from '/shared/modes.js';
import { MAP_IDS, getMap } from '/shared/maps/index.js';
import { poolOf } from '/shared/maps/rotation.js';
import { ITEMS, PALETTES, SKINS } from '/shared/cosmetics.js';
import { lobby, net, game } from './state.js';
import { loadout, equip, setSkill, skillChoices, outfit, equipOutfit, setOutfitChoice, onLoadoutChange } from './loadout.js';
import { $, esc, MODE_CFG, setMode } from './util.js';
import { setDisplay } from './dom.js';

// 로비 모드 카드의 맵 표시: 맵 풀이 둘 이상이면 "맵 랜덤 N종", 하나면 그 맵 이름
const mapLabel = m => { const pool = poolOf(m, MAP_IDS); return pool.length > 1 ? `맵 랜덤 ${pool.length}종` : getMap(pool[0]).name; };

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
let chatTab = 'lobby';

export function showLobby(message = '') { setDisplay($('menu'), true, 'flex'); lobbyNote(message); renderAll(); }
export function lobbyNote(text) { $('msg').textContent = text || ''; }

// ───── 내 정보 ─────
function renderMe() {
  const m = lobby.me;
  if (!m) return;
  $('meName').textContent = m.name; $('meTag').textContent = `#${m.tag}`;
  $('meLv').textContent = `Lv.${m.level}`;
  $('meXp').style.width = `${Math.min(100, m.xp / m.next * 100)}%`;
  $('meXpT').textContent = `${m.xp} / ${m.next} XP`;
  const s = m.stats;
  $('meSum').textContent = `${s.wins}승 ${s.losses}패 · K/D ${(s.kills / Math.max(1, s.deaths)).toFixed(2)}`;
}
function renderStats() {
  const m = lobby.me; if (!m) return;
  const s = m.stats, h = Math.floor(s.playSec / 3600), mi = Math.floor(s.playSec / 60) % 60;
  const rows = Object.entries(s.weapons).sort((a, b) => b[1].uses - a[1].uses).map(([id, w]) => {
    const name = (WEAPONS.find(x => x.id === id) || {}).name || id;
    return `<tr><td>${esc(name)}</td><td>${w.uses}</td><td>${w.kills}</td><td>${w.deaths}</td><td>${w.shots ? Math.round(w.hits / w.shots * 100) : 0}%</td><td>${w.hits ? Math.round(w.heads / w.hits * 100) : 0}%</td><td>${Math.round(w.dmg)}</td></tr>`;
  }).join('');
  $('statsBody').innerHTML = `<div class="sgrid">
    <div><b>${h}시간 ${mi}분</b><span>플레이 시간</span></div><div><b>${s.matches}</b><span>경기</span></div>
    <div><b>${s.wins}</b><span>승리</span></div><div><b>${s.losses}</b><span>패배</span></div>
    <div><b>${s.kills}</b><span>킬</span></div><div><b>${s.deaths}</b><span>데스</span></div>
    <div><b>${s.assists}</b><span>어시스트</span></div><div><b>${s.caps}</b><span>거점 점령</span></div></div>
    <h4>무기별 기록</h4><table><thead><tr><th>무기</th><th>사용</th><th>킬</th><th>데스</th><th>명중률</th><th>헤드샷</th><th>피해</th></tr></thead><tbody>${rows || '<tr><td colspan="7">아직 기록이 없습니다</td></tr>'}</tbody></table>`;
}

// ───── 모드 · 매칭 ─────
function renderModes() {
  const box = $('modes'); box.replaceChildren();
  for (const m of Object.values(MODES)) {
    const b = el('button', `mode${m.id === MODE_CFG.id ? ' on' : ''}`, `<b>${esc(m.name)}</b><span>${esc(m.desc)}</span><small>${esc(mapLabel(m))} · ${m.minutes}분${m.rules === 'domination' ? ' · 대표 모드' : ''}</small>`);
    b.type = 'button'; b.onclick = () => { setMode(m.id); renderModes(); };
    box.append(b);
  }
  const p = lobby.party, leader = !p || p.leader === (lobby.me && lobby.me.id);
  $('join').disabled = !net.open || !leader;
  $('join').textContent = !leader ? '파티장이 매칭을 시작합니다' : p && p.members.length > 1 ? `파티 ${p.members.length}명으로 빠른 매칭` : '빠른 매칭';
}
function renderRooms() {
  const box = $('roomList'); box.replaceChildren();
  $('roomEmpty').hidden = lobby.rooms.length > 0;
  for (const r of lobby.rooms) {
    const row = el('div', 'room', `<b>${esc(r.name)}${r.locked ? ' 🔒' : ''}</b><span>${esc(MODES[r.mode] ? MODES[r.mode].name : r.mode)} · ${esc(getMap(r.map).name)} · ${r.humans}/${r.max}명 · ${r.minutes}분</span><code>${r.code}</code>`);
    row.onclick = () => { $('codeIn').value = r.code; if (r.locked) $('passIn').focus(); else net.send({ t: 'rjoin', code: r.code }); };
    box.append(row);
  }
}
function setPlayTab(t) {
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === t);
  $('paneQuick').hidden = t !== 'quick'; $('paneCustom').hidden = t !== 'custom';
  if (t === 'custom') net.send({ t: 'rooms' });
}

// ───── 출전 무기 · 스킬 (매치 시작 전에 고른다) ─────
function renderLoadout() {
  for (const slot of [0, 1]) {
    const box = $(`slot${slot}`); box.replaceChildren();
    const cur = loadout.wire[slot];
    box.append(el('h4', '', `${slot ? '보조무기 · E' : '주무기 · Q'}`));
    const grid = el('div', 'wgrid');
    for (const w of WEAPONS) {
      const b = el('button', `w${w.id === cur.id ? ' on' : ''}${w.id === loadout.wire[1 - slot].id ? ' other' : ''}`, `<b>${esc(w.name)}</b><span>${esc(w.cls)} · 이동 ${Math.round(w.move * 100)}%</span>`);
      b.type = 'button'; b.title = `${w.cls}: 피해 ${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''}, 분당 ${w.rpm}발, 탄창 ${w.kind === 'melee' ? '-' : w.mag}, 달리며 사격 ${w.sprintFire ? 'O' : 'X'}, 슬라이딩 중 사격 ${w.slideFire ? 'O' : 'X'}`;
      b.onclick = () => equip(slot, w.id);
      grid.append(b);
    }
    box.append(grid);
    const sks = skillChoices(slot);
    const skBox = el('div', 'sklist');
    if (!sks.length) skBox.append(el('p', 'dim', '이 무기는 아직 전용 스킬이 없습니다'));
    for (const s of sks) {
      const b = el('button', `skc${s.id === cur.skill ? ' on' : ''}`, `<b>${esc(s.name)} <small>${s.type === 'active' ? `액티브${s.cd ? ` · ${s.secondary && slot === 1 && s.secondary.cd ? s.secondary.cd : s.cd}초` : ''}` : '패시브'}</small></b><span>${esc(s.desc)}</span>`);
      b.type = 'button'; b.onclick = () => setSkill(slot, s.id);
      skBox.append(b);
    }
    box.append(skBox);
  }
}
function renderOutfit() {
  const box = $('outfitBox'); box.replaceChildren();
  const c = outfit.choice;
  const sel = (label, options, value, on) => {
    const wrap = el('label', 'osel', `<span>${label}</span>`), s = el('select');
    for (const [v, t] of options) { const o = el('option'); o.value = v; o.textContent = t; if (v === value) o.selected = true; s.append(o); }
    s.onchange = () => on(s.value); wrap.append(s); box.append(wrap);
  };
  sel('의상 색', Object.keys(PALETTES).map(k => [k, k]), c.palette, v => setOutfitChoice({ ...c, palette: v }));
  sel('피부', SKINS.map((s, i) => [String(i), `피부 ${i + 1}`]), String(c.skin), v => setOutfitChoice({ ...c, skin: Number(v) }));
  const SLOT_NAMES = { hair: '헤어스타일', upper: '상의', lower: '하의', head: '모자', acc1: '액세서리 1', acc2: '액세서리 2', back: '등', feet: '신발', hands: '장갑', waist: '허리' };
  let any = false;
  for (const [slot, name] of Object.entries(SLOT_NAMES)) {
    const items = [...ITEMS.values()].filter(it => it.slot === slot);
    if (!items.length) continue;
    any = true;
    sel(name, [['', '기본'], ['-', '없음'], ...items.map(it => [it.id, it.name || it.id])], c.items[slot] === null ? '-' : c.items[slot] || '', v => equipOutfit(slot, v === '' ? undefined : v === '-' ? null : v));
  }
  if (!any) box.append(el('p', 'dim', '헤어·의상·액세서리 아이템은 스튜디오 옷장에서 등록하면 여기에 나옵니다.'));
}

// ───── 파티 · 친구 · 채팅 ─────
function renderParty() {
  const box = $('partyBox'); box.replaceChildren();
  const p = lobby.party, myId = lobby.me && lobby.me.id;
  if (p) {
    for (const m of p.members) box.append(el('div', 'pm', `<i class="st ${statusClass(m.status)}"></i><b>${esc(m.name)}</b><small>#${m.tag} · Lv.${m.level}${m.id === p.leader ? ' · 파티장' : ''}</small><span>${statusText(m.status)}</span>`));
    const leave = el('button', 'small', '파티 나가기'); leave.type = 'button'; leave.onclick = () => net.send({ t: 'pleave' }); box.append(leave);
  } else box.append(el('p', 'dim', '친구 목록에서 초대하면 파티가 만들어집니다'));
  for (const inv of lobby.invites) {
    const row = el('div', 'inv', `<b>${esc(inv.name)}</b> 님의 파티 초대`);
    const ok = el('button', 'small', '참가'); ok.type = 'button'; ok.onclick = () => { net.send({ t: 'pjoin', party: inv.party }); lobby.invites = lobby.invites.filter(i => i !== inv); renderParty(); };
    const no = el('button', 'small ghost', '거절'); no.type = 'button'; no.onclick = () => { lobby.invites = lobby.invites.filter(i => i !== inv); renderParty(); };
    row.append(ok, no); box.append(row);
  }
  renderModes(); void myId;
}
const statusClass = s => (s === 'offline' ? 'off' : s === 'lobby' ? 'on' : 'busy');
const statusText = s => (s === 'offline' ? '오프라인' : s === 'lobby' ? '로비' : s === 'queue' ? '매칭 중' : s && s.startsWith('match:') ? `경기 중 (${(MODES[s.slice(6)] || {}).name || ''})` : '');
function renderFriends() {
  const box = $('friendList'); box.replaceChildren();
  for (const f of lobby.inc) {
    const row = el('div', 'fr req', `<b>${esc(f.name)}</b><small>#${f.tag}</small><span>친구 요청</span>`);
    const ok = el('button', 'small', '수락'); ok.type = 'button'; ok.onclick = () => net.send({ t: 'fra', id: f.id, ok: true });
    const no = el('button', 'small ghost', '거절'); no.type = 'button'; no.onclick = () => net.send({ t: 'fra', id: f.id, ok: false });
    row.append(ok, no); box.append(row);
  }
  const list = [...lobby.friends].sort((a, b) => (a.status === 'offline') - (b.status === 'offline') || a.name.localeCompare(b.name));
  for (const f of list) {
    const row = el('div', 'fr', `<i class="st ${statusClass(f.status)}"></i><b>${esc(f.name)}</b><small>#${f.tag} · Lv.${f.level}</small><span>${statusText(f.status)}</span>`);
    if (f.status !== 'offline') { const inv = el('button', 'small', '초대'); inv.type = 'button'; inv.onclick = () => net.send({ t: 'pinv', id: f.id }); row.append(inv); }
    const del = el('button', 'small ghost', '삭제'); del.type = 'button'; del.onclick = () => { if (confirm(`${f.name} 을(를) 친구에서 삭제할까요?`)) net.send({ t: 'fr-', id: f.id }); };
    row.append(del); box.append(row);
  }
  if (!list.length && !lobby.inc.length) box.append(el('p', 'dim', '친구 코드(이름#숫자)로 친구를 추가하세요'));
}
function renderChat() {
  for (const b of $('chatTabs').children) b.classList.toggle('on', b.dataset.ch === chatTab);
  const log = $('lobbyLog'); log.replaceChildren();
  for (const m of lobby.chat[chatTab] || []) { const d = el('div'); const b = el('b'); b.textContent = m.name; d.append(b, document.createTextNode(` ${m.text}`)); log.append(d); }
  log.scrollTop = log.scrollHeight;
}
function renderAll() { renderMe(); renderModes(); renderLoadout(); renderOutfit(); renderParty(); renderFriends(); renderChat(); renderRooms(); }
export function lobbyUpdate(what) {
  if (what === 'me') { renderMe(); renderModes(); if (!$('stats').hidden) renderStats(); }
  else if (what === 'friends') renderFriends();
  else if (what === 'party') renderParty();
  else if (what === 'chat') renderChat();
  else if (what === 'rooms') renderRooms();
}
onLoadoutChange(() => { renderLoadout(); });

// ───── 버튼 ─────
$('join').onclick = () => { if (!game.joined) net.send({ t: 'qm', mode: MODE_CFG.id }); };
for (const b of $('tabs').children) b.onclick = () => setPlayTab(b.dataset.tab);
$('codeJoin').onclick = () => net.send({ t: 'rjoin', code: $('codeIn').value.trim().toUpperCase(), pass: $('passIn').value });
$('roomRefresh').onclick = () => net.send({ t: 'rooms' });
{
  const modeSel = $('cMode'), mapSel = $('cMap');
  for (const m of Object.values(MODES)) { const o = el('option'); o.value = m.id; o.textContent = m.name; modeSel.append(o); }
  { const o = el('option'); o.value = ''; o.textContent = '랜덤 (경기마다 바뀜)'; mapSel.append(o); } // 기본값: 맵 풀에서 경기마다 무작위 (shared/maps/rotation.js)
  for (const id of MAP_IDS) { const o = el('option'); o.value = id; o.textContent = getMap(id).name; mapSel.append(o); }
  mapSel.value = '';
}
$('createForm').onsubmit = e => {
  e.preventDefault();
  net.send({ t: 'rcreate', name: $('cName').value, mode: $('cMode').value, map: $('cMap').value, minutes: Number($('cMin').value), max: Number($('cMax').value), pass: $('cPass').value, bots: $('cBots').checked });
};
$('frAdd').onsubmit = e => { e.preventDefault(); const v = $('frTag').value.trim(); if (v) net.send({ t: 'fr+', tag: v }); $('frTag').value = ''; };
for (const b of $('chatTabs').children) b.onclick = () => { chatTab = b.dataset.ch; renderChat(); };
$('lobbyChat').onsubmit = e => { e.preventDefault(); const v = $('lobbyChatIn').value.trim(); if (v) net.send({ t: 'chat', ch: chatTab, text: v }); $('lobbyChatIn').value = ''; };
$('lobbyChatIn').addEventListener('keydown', e => e.stopPropagation());
$('frTag').addEventListener('keydown', e => e.stopPropagation());
$('meEdit').onclick = () => {
  const n = prompt('새 이름 (최대 14자)', lobby.me ? lobby.me.name : '');
  if (n && n.trim()) { localStorage.setItem('fd_name', n.trim()); net.send({ t: 'name', name: n.trim() }); }
};
$('meCopy').onclick = () => { if (lobby.me) navigator.clipboard?.writeText(`${lobby.me.name}#${lobby.me.tag}`).catch(() => {}); lobbyNote('친구 코드를 복사했습니다'); };
$('meStats').onclick = () => { net.send({ t: 'stats' }); renderStats(); $('stats').hidden = false; };
$('statsClose').onclick = () => { $('stats').hidden = true; };
for (const t of document.querySelectorAll('[data-lt]')) t.onclick = () => { for (const x of document.querySelectorAll('[data-lt]')) x.classList.toggle('on', x === t); $('ltLoadout').hidden = t.dataset.lt !== 'loadout'; $('ltOutfit').hidden = t.dataset.lt !== 'outfit'; };
renderAll();
