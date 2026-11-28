// 로비 화면 (기획 12장·13장·3.3·11.3): 내 정보(레벨·경험치·전적) · 모드 선택과 빠른 매칭 · 커스텀 방 ·
// 출전 무기 2자루와 자리별 스킬 · 외형 · 파티 · 친구 · 로비/파티 채팅
import { WEAPONS } from '/shared/weapons.js';
import { MODES } from '/shared/modes.js';
import { MAP_IDS, getMap } from '/shared/maps/index.js';
import { poolOf } from '/shared/maps/rotation.js';
import { ITEMS, PALETTES, SKINS } from '/shared/cosmetics.js';
import { lobby, net, game } from './state.js';
import { loadout, equip, setSkill, skillChoices, outfit, equipOutfit, setOutfitChoice, onLoadoutChange, gunSkin, setGunSkin } from './loadout.js';
import { weaponArt, skinColors, SKIN_NAMES } from './lobbyart.js';
import { createGunView } from './lobbyview.js';
import { $, esc, MODE_CFG, setMode } from './util.js';
import { setDisplay } from './dom.js';

// 로비 모드 카드의 맵 표시: 맵 풀이 둘 이상이면 "맵 랜덤 N종", 하나면 그 맵 이름
const mapLabel = m => { const pool = poolOf(m, MAP_IDS); return pool.length > 1 ? `맵 랜덤 ${pool.length}종` : getMap(pool[0]).name; };

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
let chatTab = 'lobby';
let activeSlot = 0;          // 무장 화면에서 보고 있는 자리 (0 주무기 · 1 보조무기)
let kitTab = 'loadout';      // 가운데 화면: loadout | outfit

export function showLobby(message = '') { setDisplay($('menu'), true, 'flex'); lobbyNote(message); renderAll(); }
export function lobbyNote(text) { $('msg').textContent = text || ''; }

// ───── 내 정보 ─────
function renderMe() {
  const m = lobby.me;
  if (!m) return;
  $('meName').textContent = m.name; $('meTag').textContent = `#${m.tag}`;
  $('meLv').textContent = String(m.level);
  $('meRing').style.setProperty('--xp', `${Math.min(100, m.xp / m.next * 100)}%`);
  $('meXpT').textContent = `Lv.${m.level} · ${m.xp} / ${m.next} XP`;
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
const modeLabel = m => m.name.replace(/\s*\d+\s*대\s*\d+$/, ''); // "점령전 5 대 5" → "점령전"
const modeMeta = m => { const t = /(\d+)\s*대\s*(\d+)/.exec(m.name); return `${t ? `${t[1]} 대 ${t[2]} · ` : ''}${m.minutes}분 · ${mapLabel(m)}`; };
function renderModes() {
  const box = $('modes'); box.replaceChildren();
  for (const m of Object.values(MODES)) {
    const on = m.id === MODE_CFG.id; // 고른 모드만 규칙 한 줄이 더 보인다
    const b = el('button', `mode${on ? ' on' : ''}`, `<b>${esc(modeLabel(m))}</b><small>${esc(modeMeta(m))}</small>${on ? `<span class="md">${esc(m.desc)}</span>` : ''}`);
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

// ───── 출전 무기 · 스킬 · 총기 스킨 (매치 시작 전에 고른다) ─────
const skinOf = id => (SKIN_NAMES.includes(gunSkin.choice[id]) ? gunSkin.choice[id] : SKIN_NAMES[0]);
const statRows = w => {
  const clamp = v => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  return [
    ['피해', clamp(w.dmg * (w.pellets || 1) / 120), `${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''}`],
    ['연사', clamp(w.rpm / 900), String(w.rpm)],
    ['탄창', clamp(w.mag / 100), w.kind === 'melee' ? '-' : String(w.mag)],
    ['사거리', clamp(w.range / 400), String(w.range)],
    ['이동', clamp((w.move - 0.8) / 0.4), `${Math.round(w.move * 100)}%`],
  ].map(([k, p, v]) => `<div class="stat"><div class="top"><span class="k">${k}</span><span class="v">${esc(v)}</span></div><div class="bar"><i style="width:${p}"></i></div></div>`).join('');
};
// 3D 미리보기 (총 모델 .glb). WebGL 이 안 되거나 모델 생성에 실패하면 단순한 그림으로 대신한다
let gunView = null, view3d = true;
try { gunView = createGunView($('wCanvas'), $('stage')); } catch (e) { console.warn('로비 3D 미리보기를 쓸 수 없어 그림으로 대신합니다', e); view3d = false; }
function renderStage() {
  const w = WEAPONS.find(x => x.id === loadout.wire[activeSlot].id);
  if (!w) return;
  const skin = skinOf(w.id), c = skinColors(skin);
  $('wName').textContent = w.name; $('wCls').textContent = w.cls;
  $('wStats').innerHTML = statRows(w);
  $('stage').style.setProperty('--glow', `${c.core}38`);
  let ok = false;
  if (view3d && gunView) { try { gunView.show(w.id, skin); ok = true; } catch (e) { console.warn('3D 미리보기 실패', e); view3d = false; } }
  $('stage').classList.toggle('fallback', !ok);
  $('wArt').innerHTML = ok ? '' : weaponArt(w.id, c);
  const row = $('skinRow'); row.replaceChildren();
  for (const name of SKIN_NAMES) {
    const k = skinColors(name);
    const b = el('button', `sw${name === skin ? ' on' : ''}`, `<i style="background:conic-gradient(${k.body} 0 34%, ${k.accent} 34% 67%, ${k.dark} 67% 100%)"></i>${esc(name)}`);
    b.type = 'button'; b.setAttribute('aria-pressed', String(name === skin));
    b.onclick = () => setGunSkin(w.id, name);
    row.append(b);
  }
}
function renderLoadout() {
  for (const b of document.querySelectorAll('.kt')) b.classList.toggle('on', b.dataset.lt === 'outfit' ? kitTab === 'outfit' : kitTab === 'loadout' && Number(b.dataset.slot) === activeSlot);
  for (const slot of [0, 1]) { const n = (WEAPONS.find(x => x.id === loadout.wire[slot].id) || {}).name || ''; $(`kt${slot}`).textContent = n; $(`kt${slot}`).title = n; }
  $('ltLoadout').hidden = kitTab !== 'loadout'; $('ltOutfit').hidden = kitTab !== 'outfit';
  if (kitTab !== 'loadout') return;
  renderStage(); renderWeaponList(); renderSkills();
}
// 무기 목록 (세로, 마우스 휠로 넘긴다). 다른 자리에서 쓰는 무기를 누르면 두 자리가 서로 바뀐다
function renderWeaponList() {
  const list = $('wList'), top = list.scrollTop; list.replaceChildren();
  const cur = loadout.wire[activeSlot], other = loadout.wire[1 - activeSlot];
  let onBtn = null;
  for (const w of WEAPONS) {
    const k = skinColors(skinOf(w.id)), mine = w.id === cur.id, theirs = w.id === other.id;
    const b = el('button', `w${mine ? ' on' : ''}${theirs ? ' other' : ''}`, `<i class="chip" style="background:linear-gradient(135deg, ${k.body} 0 50%, ${k.accent} 50% 100%)"></i><span class="wt"><b>${esc(w.name)}</b><small>${esc(w.cls)} · 이동 ${Math.round(w.move * 100)}%</small></span>${theirs ? `<em>${activeSlot ? '주무기' : '보조'}</em>` : ''}`);
    b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(mine));
    b.title = `${w.name} — ${w.cls}: 피해 ${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''}, 분당 ${w.rpm}발, 탄창 ${w.kind === 'melee' ? '-' : w.mag}, 달리며 사격 ${w.sprintFire ? 'O' : 'X'}, 슬라이딩 중 사격 ${w.slideFire ? 'O' : 'X'}${theirs ? ' (누르면 주무기·보조무기를 맞바꿈)' : ''}`;
    b.onclick = () => equip(activeSlot, w.id);
    if (mine) onBtn = b;
    list.append(b);
  }
  list.scrollTop = top;
  if (onBtn && (onBtn.offsetTop < top || onBtn.offsetTop + onBtn.offsetHeight > top + list.clientHeight)) onBtn.scrollIntoView({ block: 'nearest' }); // 고른 무기가 안 보이면 보이게
}
// 스킬: 칸에는 이름만 두고, 설명 전체는 아래 설명줄에 보여 준다 (칸에 올리거나 키로 이동하면 그 스킬 설명, 벗어나면 고른 스킬 설명)
function renderSkills() {
  const box = $('skillBox'); box.replaceChildren();
  const slot = activeSlot, cur = loadout.wire[slot], sks = skillChoices(slot);
  const kindOf = s => (s.type === 'active' ? `액티브${s.cd ? ` ${s.secondary && slot === 1 && s.secondary.cd ? s.secondary.cd : s.cd}초` : ''}` : '패시브');
  const row = el('div', 'srow', '<span>스킬</span>'), list = el('div', 'sklist'), detail = el('p', 'skd');
  const describe = s => { detail.innerHTML = s ? `<b>${esc(s.name)}</b><em>${kindOf(s)}</em>${esc(s.desc)}` : '이 무기는 아직 전용 스킬이 없습니다'; };
  const picked = sks.find(s => s.id === cur.skill);
  if (!sks.length) list.append(el('span', 'none', '전용 스킬 없음'));
  for (const s of sks) {
    const b = el('button', `skc${s.id === cur.skill ? ' on' : ''}`, `<b>${esc(s.name)}</b><small>${kindOf(s)}</small>`);
    b.type = 'button'; b.setAttribute('aria-pressed', String(s.id === cur.skill));
    b.onclick = () => setSkill(slot, s.id);
    for (const ev of ['mouseenter', 'focus']) b.addEventListener(ev, () => describe(s));
    for (const ev of ['mouseleave', 'blur']) b.addEventListener(ev, () => describe(picked));
    list.append(b);
  }
  describe(picked);
  row.append(list); box.append(row, detail);
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
  const p = lobby.party;
  if (p) {
    for (const m of p.members) box.append(el('div', 'pm', `<i class="st ${statusClass(m.status)}"></i><div class="tx"><b>${esc(m.name)}</b><small>#${m.tag} · Lv.${m.level}${m.id === p.leader ? ' · 파티장' : ''}</small></div>`));
    const leave = el('button', 'btn sm', '파티 나가기'); leave.type = 'button'; leave.onclick = () => net.send({ t: 'pleave' }); box.append(leave);
  } else {
    if (lobby.me) box.append(el('div', 'pm', `<i class="st on"></i><div class="tx"><b>${esc(lobby.me.name)}</b><small>#${lobby.me.tag} · Lv.${lobby.me.level}</small></div>`));
    box.append(el('p', 'dim small', '친구 목록에서 초대하면 파티가 만들어집니다'));
  }
  for (const inv of lobby.invites) {
    const row = el('div', 'inv', `<b>${esc(inv.name)}</b> 님의 파티 초대`);
    const ok = el('button', 'btn sm pri', '참가'); ok.type = 'button'; ok.onclick = () => { net.send({ t: 'pjoin', party: inv.party }); lobby.invites = lobby.invites.filter(i => i !== inv); renderParty(); };
    const no = el('button', 'btn sm', '거절'); no.type = 'button'; no.onclick = () => { lobby.invites = lobby.invites.filter(i => i !== inv); renderParty(); };
    row.append(ok, no); box.append(row);
  }
  renderModes();
}
const statusClass = s => (s === 'offline' ? 'off' : s === 'lobby' ? 'on' : 'busy');
const statusText = s => (s === 'offline' ? '오프라인' : s === 'lobby' ? '로비' : s === 'queue' ? '매칭 중' : s && s.startsWith('match:') ? `경기 중 (${(MODES[s.slice(6)] || {}).name || ''})` : '');
function renderFriends() {
  const box = $('friendList'); box.replaceChildren();
  for (const f of lobby.inc) {
    const row = el('div', 'fr req', `<div class="tx"><b>${esc(f.name)}</b><small>#${f.tag} · 친구 요청</small></div>`);
    const ok = el('button', 'btn sm pri', '수락'); ok.type = 'button'; ok.onclick = () => net.send({ t: 'fra', id: f.id, ok: true });
    const no = el('button', 'btn sm', '거절'); no.type = 'button'; no.onclick = () => net.send({ t: 'fra', id: f.id, ok: false });
    row.append(ok, no); box.append(row);
  }
  const list = [...lobby.friends].sort((a, b) => (a.status === 'offline') - (b.status === 'offline') || a.name.localeCompare(b.name));
  for (const f of list) {
    const row = el('div', 'fr', `<i class="st ${statusClass(f.status)}"></i><div class="tx"><b>${esc(f.name)}</b><small>#${f.tag} · Lv.${f.level} · ${esc(statusText(f.status))}</small></div>`);
    if (f.status !== 'offline') { const inv = el('button', 'btn sm pri', '초대'); inv.type = 'button'; inv.onclick = () => net.send({ t: 'pinv', id: f.id }); row.append(inv); }
    const del = el('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = () => { if (confirm(`${f.name} 을(를) 친구에서 삭제할까요?`)) net.send({ t: 'fr-', id: f.id }); };
    row.append(del); box.append(row);
  }
  if (!list.length && !lobby.inc.length) box.append(el('p', 'dim small', '친구 코드(이름#숫자)로 친구를 추가하세요'));
}
function renderChat() {
  for (const b of $('chatTabs').children) b.classList.toggle('on', b.dataset.ch === chatTab);
  const log = $('lobbyLog'); log.replaceChildren();
  for (const m of lobby.chat[chatTab] || []) { const d = el('div'); const b = el('b'); b.textContent = m.name; d.append(b, document.createTextNode(` ${m.text}`)); log.append(d); }
  log.scrollTop = log.scrollHeight;
}
function renderAll() { renderMe(); renderModes(); renderLoadout(); renderOutfit(); renderParty(); renderFriends(); renderChat(); renderRooms(); }
export function lobbyUpdate(what) {
  if (what === 'me') { renderMe(); renderParty(); if (!$('stats').hidden) renderStats(); }
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
  for (const m of Object.values(MODES)) { const o = el('option'); o.value = m.id; o.textContent = modeLabel(m); modeSel.append(o); }
  { const o = el('option'); o.value = ''; o.textContent = '랜덤'; o.title = '경기마다 맵 풀에서 무작위'; mapSel.append(o); } // 기본값: 맵 풀에서 경기마다 무작위 (shared/maps/rotation.js)
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
for (const id of ['codeIn', 'passIn', 'cName', 'cPass']) $(id).addEventListener('keydown', e => e.stopPropagation());
$('meEdit').onclick = () => {
  const n = prompt('새 이름 (최대 14자)', lobby.me ? lobby.me.name : '');
  if (n && n.trim()) { localStorage.setItem('fd_name', n.trim()); net.send({ t: 'name', name: n.trim() }); }
};
$('meCopy').onclick = () => { if (lobby.me) navigator.clipboard?.writeText(`${lobby.me.name}#${lobby.me.tag}`).catch(() => {}); lobbyNote('친구 코드를 복사했습니다'); };
$('meStats').onclick = () => { net.send({ t: 'stats' }); renderStats(); $('stats').hidden = false; };
$('statsClose').onclick = () => { $('stats').hidden = true; };
for (const b of document.querySelectorAll('.kt')) b.onclick = () => { kitTab = b.dataset.lt; if (b.dataset.slot !== undefined) activeSlot = Number(b.dataset.slot); renderLoadout(); };
renderAll();
