// 전체 화면 오버레이: 사망 화면, 점수판(Tab), 승리 연출과 결과 화면(재매치/로비)
import { WEAPONS } from '/shared/weapons.js';
import { sfx } from '../sfx.js';
import { me, game, roster, net, isAlly } from '../state.js';
import { $, MODE_CFG, esc } from '../util.js';
import { setText, setDisplay, setClass } from '../dom.js';
import { nameOf, sideOf, teamCss, fmt } from './common.js';

// ───── 사망 화면 (기획 6.4) ─────
const deadEl = $('dead');
export function showDeath(info) { game.death = info; }
function updateDeath() {
  const d = game.death, on = !me.alive && game.matchState === 'playing' && !!d;
  setDisplay(deadEl, on, 'flex');
  if (!on) return;
  const left = Math.max(0, (game.respawnAt - performance.now()) / 1000);
  const w = WEAPONS[d.w];
  const by = d.k >= 0 && d.k !== me.id ? `<b class="${sideOf(d.k)}">${esc(nameOf(d.k))}</b> 에게 처치됨` : d.how === 'fall' ? '떨어져서 사망' : '사망';
  const cause = [d.how === 'head' ? '헤드샷' : null, d.how === 'fall' ? '낙사' : null, d.how === 'blast' ? '폭발' : null, d.how === 'bleed' ? '출혈' : null, d.how === 'melee' ? '근접 공격' : null].filter(Boolean).join(' · ');
  const key = `${by}|${Math.ceil(left * 10)}|${game.teamScores}|${JSON.stringify(game.dom && game.dom.pts)}`;
  if (deadEl.dataset.k === key) return;
  deadEl.dataset.k = key;
  const pts = MODE_CFG.rules === 'domination' && game.dom ? `<div class="dpts">${game.zones.map((z, i) => `<span class="zp ${teamCss(game.dom.pts[i][0])}"><b>${esc(z.id)}</b></span>`).join('')}</div>` : '';
  const sc = MODE_CFG.teams ? `<div class="dsc"><span class="a">${game.teamScores[me.team] ?? 0}</span> : <span class="e">${game.teamScores[1 - me.team] ?? 0}</span></div>` : '';
  deadEl.innerHTML = `<h2>전사</h2><p class="by">${by}</p><p class="cause">${w && d.k >= 0 ? esc(w.name) : ''}${cause ? ` · <em>${cause}</em>` : ''}</p>${sc}${pts}<p class="rs">부활까지 <b class="mono">${left.toFixed(1)}</b>초</p>`;
}

// ───── 점수판 (Tab) ─────
const boardEl = $('board');
function updateBoard(show) {
  setDisplay(boardEl, show, 'block');
  if (!show) return;
  const list = [...roster.values()].sort((a, b) => (a.team - b.team) || b.k - a.k || a.d - b.d);
  const row = p => `<tr class="${p.id === me.id ? 'me' : ''} ${MODE_CFG.teams ? (isAlly(p.team) || p.id === me.id ? 'a' : 'e') : ''}"><td>${esc(p.name)}${p.bot ? ' <small>봇</small>' : ''}</td><td>${p.k}</td><td>${p.d}</td><td>${p.a}</td></tr>`;
  const html = `<table><thead><tr><th>이름</th><th>킬</th><th>데스</th><th>어시</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>`;
  if (boardEl.dataset.h !== html) { boardEl.dataset.h = html; boardEl.innerHTML = html; }
}

// ───── 결과 화면 (기획 10장) ─────
const endEl = $('endscr');
export function showEnd(m) {
  game.end = { ...m, at: performance.now() };
  game.rematch = null;
  const won = MODE_CFG.teams ? (m.wt < 0 ? 'draw' : m.wt === me.team ? 'win' : 'loss') : (m.top < 0 ? 'draw' : m.top === me.id ? 'win' : 'loss');
  const title = { win: '승리', loss: '패배', draw: '무승부' }[won];
  const mine = m.board.find(b => b.id === me.id) || { k: 0, d: 0, a: 0, w: [] };
  const team = t => m.board.filter(b => b.team === t).sort((a, b) => b.k - a.k);
  const rows = list => list.map(b => `<tr class="${b.id === me.id ? 'me' : ''}"><td>${esc(b.name)}${b.bot ? ' <small>봇</small>' : ''}</td><td>${b.k}</td><td>${b.d}</td><td>${b.a}</td>${MODE_CFG.rules === 'domination' ? `<td>${b.caps}</td>` : ''}<td class="wl">${b.w.map(id => esc((WEAPONS.find(w => w.id === id) || {}).name || id)).join(' · ')}</td></tr>`).join('');
  const head = `<tr><th>이름</th><th>킬</th><th>데스</th><th>어시</th>${MODE_CFG.rules === 'domination' ? '<th>점령</th>' : ''}<th>무기</th></tr>`;
  const tables = MODE_CFG.teams ? [me.team, 1 - me.team].map(t => `<div class="rt ${t === me.team ? 'a' : 'e'}"><h4>${t === me.team ? '우리 팀' : '상대 팀'} <b>${m.sc[t]}</b></h4><table>${head}${rows(team(t))}</table></div>`).join('')
    : `<div class="rt"><table>${head}${rows([...m.board].sort((a, b) => b.k - a.k))}</table></div>`;
  const xp = m.me && m.me.xp ? `<div class="xp">경험치 +${m.me.xp}${m.me.ups ? ` · <b>레벨 업!</b> Lv.${m.me.profile.level}` : ''}</div>` : '';
  endEl.innerHTML = `<div class="vic ${won}"><h1>${title}</h1>${MODE_CFG.teams ? `<div class="vs"><span class="a">${m.sc[me.team]}</span> : <span class="e">${m.sc[1 - me.team]}</span></div>` : ''}</div>
    <div class="res" hidden><h2>${title} <small>${fmt(m.dur)} 경기</small></h2>
    <div class="mine">내 기록 · 킬 <b>${mine.k}</b> · 데스 <b>${mine.d}</b> · 어시스트 <b>${mine.a}</b> · 사용 무기 ${mine.w.map(id => esc((WEAPONS.find(w => w.id === id) || {}).name || id)).join(', ')}</div>${xp}
    <div class="tables">${tables}</div>
    <div class="choose"><button type="button" id="btnRematch">재매치</button><button type="button" id="btnLobby">로비로</button><span id="resT"></span></div></div>`;
  $('btnRematch').onclick = () => { game.rematch = true; net.send({ t: 'rematch', v: true }); setClass($('btnRematch'), 'on', true); };
  $('btnLobby').onclick = () => { net.send({ t: 'leave' }); };
  if (won === 'win') sfx.kill();
}
function updateEnd() {
  const e = game.end, on = !!e && (game.matchState === 'victory' || game.matchState === 'results');
  setDisplay(endEl, on, 'flex');
  if (!on) return;
  const t = performance.now() - e.at;
  const res = t >= e.victory;
  endEl.querySelector('.vic').hidden = res; endEl.querySelector('.res').hidden = !res;
  if (res) { if (game.matchState === 'victory') game.matchState = 'results'; setText($('resT'), game.rematch ? `재매치 대기 · ${Math.ceil((e.victory + e.results - t) / 1000)}초` : `${Math.ceil((e.victory + e.results - t) / 1000)}초 뒤 로비로`); if (document.pointerLockElement) document.exitPointerLock(); }
}


// 매 프레임
export function updateScreens(showBoard) {
  updateDeath(); updateBoard(showBoard); updateEnd();
}
