// 전투 화면 (기획 9장·6장·10장)
//   위: 팀 점수 · 시간 · 거점별 소유 (점령전)       가운데: 조준선 · 맞힘 표시 · 점령/경합 알림
//   아래: 체력 · 무기 · 탄약 · 스킬                  상황: 점령 진행도 · 경합 · 연장전 · 부활 보호
//   킬피드(최근 처치가 위, 아이콘으로 헤드샷·일반·낙사 … 구분, 팀 색), 사망 화면, 승리 연출 → 결과 화면(재매치/로비), 점수판(Tab)
import { WEAPONS } from '/shared/weapons.js';
import { HEALTH } from '/shared/sim/config.js';
import { spreadOf } from '/shared/sim/player.js';
import { SKILL_KEYS } from '/shared/skills.js';
import { CHARGED } from '/shared/sim/abilities.js';
import { KS, isKunai, kunaiSlot, wireOn, wireTime, anchored, activeNodes, planThread, pinCount, areaValid, THREAD, KIND_NAME } from '/shared/sim/kunai.js';
import { colliders } from './scene.js';
import { camera } from './scene.js';
import { sfx } from './sfx.js';
import { me, wp, game, roster, net, isAlly } from './state.js';
import { $, DEG, MODE_CFG, clamp, esc } from './util.js';
import { setText, setDisplay, setClass } from './dom.js';

const hudEl = $('hud'), crossEl = $('cross'), hitEl = $('hitm'), vigEl = $('vig'), dirEl = $('dmgdir');
const crossParts = { l: crossEl.querySelector('.l'), r: crossEl.querySelector('.r'), t: crossEl.querySelector('.t'), b: crossEl.querySelector('.b') };
export const setHudOn = on => hudEl.classList.toggle('on', on);

// ───── 이름 / 편 ─────
export const nameOf = id => (id === me.id ? me.name : (roster.get(id) || {}).name || '?');
export const sideOf = id => (id === me.id ? 'me' : MODE_CFG.teams && isAlly((roster.get(id) || {}).team) ? 'a' : 'e');
export const rosterSet = p => roster.set(p.id, { id: p.id, name: p.name, bot: !!p.bot, team: p.team ?? -1, k: p.k | 0, d: p.d | 0, a: p.a | 0, lvl: p.lvl | 0, lo: p.lo || null });
export function applyKD(kd) { for (const [id, k, d, a] of kd || []) { const p = roster.get(id); if (p) { p.k = k; p.d = d; p.a = a; } } }

// ───── 맞힘 / 맞음 ─────
let hitT = 0, vigT = 0, dirT = 0, dirFrom = null, killT = 0;
export function showHit(head, kill = false) { hitT = 0.22; setClass(hitEl, 'head', head); setClass(hitEl, 'kill', kill); if (kill) killT = 0.4; sfx.hitmarker(head); }
export function hurt(dmg, from) { vigT = Math.min(1, 0.4 + dmg / 90); dirT = 1.4; dirFrom = from; }
const dmgNums = $('dmgnums');
export function damageNumber(d, head) {
  const el = document.createElement('div'); el.className = 'dn' + (head ? ' h' : ''); el.textContent = d;
  el.style.left = `calc(50% + ${(Math.random() - 0.5) * 40}px)`;
  dmgNums.append(el); setTimeout(() => el.remove(), 700);
}

// ───── 킬피드 (기획 6.3: 처치자 · 사망자 · 처치 유형 아이콘, 최신이 위, 일정 시간 뒤 사라짐, 팀 색) ─────
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

// ───── 가운데 알림 (점령·경합·연장전) ─────
const bannerEl = $('banner');
let bannerT = 0;
export function banner(text, cls = '') { bannerEl.textContent = text; bannerEl.className = cls; bannerT = 2.2; }
let skillFlash = '', skillFlashT = 0;
export function flashSkill(text) { skillFlash = text; skillFlashT = 1.2; }

// ───── 위: 점수 · 시간 · 거점 ─────
const topEl = $('top'), zoneEls = [];
const teamCss = t => (t < 0 ? 'n' : t === me.team ? 'a' : 'e');
function renderZones() {
  const box = $('zones'); box.replaceChildren(); zoneEls.length = 0;
  for (const z of game.zones) {
    const d = document.createElement('div'); d.className = 'zp n';
    d.innerHTML = `<b>${esc(z.id)}</b><i></i>`; box.append(d); zoneEls.push(d);
  }
}
export function setZones(zones) { game.zones = zones; renderZones(); }
function fmt(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ───── 아래: 체력 · 무기 · 탄약 · 스킬 ─────
const skillEls = [0, 1].map(n => {
  const d = document.createElement('div'); d.className = 'sk';
  d.innerHTML = `<span class="k">${SKILL_KEYS[n]}</span><div class="n"></div><div class="s"></div><i class="cd"></i>`;
  $('skills').appendChild(d); return d;
});
const slotEls = [0, 1].map(n => { const d = document.createElement('div'); $('slots').appendChild(d); d.dataset.n = n; return d; });
function updateSkills() {
  const ps = me.ps;
  skillEls.forEach((el, n) => {
    const l = me.lo[n], sk = l && l.skill, s = ps.sk[n];
    setText(el.children[1], sk ? (sk.effect === 'kunai' ? (ps.kmode ? '와이어 설치' : '앵커 기동') : sk.name) : '스킬 없음');
    let text = '', fill = 0, wait = false, on = false, hot = false;
    if (sk && sk.type === 'active') {
      if (CHARGED.has(sk.effect)) { text = `${s.ch}/${sk.charges}`; fill = s.ch >= sk.charges ? 1 : s.rech / sk.cd; wait = s.ch <= 0; }
      else { wait = s.cd > 0; text = wait ? `${Math.ceil(s.cd)}초` : '준비'; fill = wait ? 1 - s.cd / sk.cd : 1; }
      const st = ps.st;
      if (sk.effect === 'adrenaline' && st.adren > 0) { on = true; text = `사용 중 ${st.adren.toFixed(1)}`; }
      if (sk.effect === 'stealth' && st.stealth > 0) { on = true; text = `투명 ${st.stealth.toFixed(1)}`; }
      if (sk.effect === 'shove' && st.shove > 0) { on = true; text = '다음 사격에 넉백'; }
      if (sk.effect === 'backstep' && st.bs > 0) { on = true; text = '다음 사격 2배'; }
      if (sk.effect === 'kunai') {
        const a = anchored(ps).length, nodes = activeNodes(ps).length, plan = ps.kmode ? threadPlan() : null;
        on = (ps.mo && ps.mo.k === 'kpull') || (ps.kmode === 1 && wireOn(ps));
        text = ps.kmode ? (plan.fail ? (nodes < 2 ? `노드 ${nodes}/2+` : '설치 불가') : `노드 ${nodes} → ${KIND_NAME[plan.kind]}`) : (ps.mo && ps.mo.k === 'kpull' ? '기동 중' : a ? `앵커 ${a}개` : '앵커 없음');
        wait = wait || (ps.kmode ? !!plan.fail : !a);
      }
      if (ps.qsk === n) { on = true; text = '꺼내는 중'; }
    } else if (sk) {
      const ws = ps.w[n], held = ps.cur === n;
      on = held;
      if (sk.effect === 'overheat') { hot = ws.over; text = ws.over ? '과열 — 식는 중' : held ? `열 ${Math.round(ws.heat * 100)}%` : '들면 켜짐'; fill = ws.heat; }
      else if (sk.effect === 'charge' || sk.effect === 'quickdraw') { const ready = ws.idle >= sk.wait; text = ready ? '충전됨' : `${Math.ceil(sk.wait - ws.idle)}초`; fill = ready ? 1 : ws.idle / sk.wait; wait = !ready; }
      else { text = held ? '적용 중' : '들면 켜짐'; fill = held ? 1 : 0; }
    }
    if (skillFlashT > 0 && n === ps.cur) text = skillFlash;
    setText(el.children[2], text); el.children[3].style.width = `${clamp(fill, 0, 1) * 100}%`;
    setClass(el, 'none', !sk); setClass(el, 'wait', wait); setClass(el, 'on', on); setClass(el, 'hot', hot);
  });
  slotEls.forEach((el, n) => { setText(el, `${n + 1}  ${me.lo[n].w.name}`); setClass(el, 'cur', ps.cur === n); });
}

// 듀얼 쿠나이 상태 (그 무기를 가지고 있을 때만): 모드 · 손마다 준비/비행/고정(남은 시간)/회수 · 와이어 남은 시간
const kBox = $('kunaiBox'), kRows = kBox ? [...kBox.querySelectorAll('.kr')] : [];
// 설치 모드 미리보기 (지금 노드로 무엇이 만들어지나 / 왜 안 되나): 노드가 바뀔 때만 다시 계산
let planKey = '', planCache = null;
function threadPlan() {
  const ps = me.ps, key = activeNodes(ps).map(n => `${n.i}:${n.g}`).join(',');
  if (key !== planKey || !planCache) { planKey = key; planCache = planThread(ps, colliders); }
  return planCache;
}
function updateKunaiBox() {
  const ps = me.ps, slot = kunaiSlot(me.lo);
  const show = !!kBox && slot >= 0 && me.alive && !!ps.ku;
  setClass(kBox, 'on', show);
  if (!show) return;
  const key = SKILL_KEYS[slot];
  setText(kBox.children[0], ps.kmode ? `설치 모드 · ${key} 와이어` : `기동 모드 · ${key} 끌려가기`);
  kRows.forEach((el, h) => {
    const k = ps.ku[h], name = h ? '오른손 (우클릭)' : '왼손 (좌클릭)';
    const st = k.s === KS.ANCHOR ? `고정 ${Math.ceil(k.t)}초` : k.s === KS.FLY ? '비행' : k.s === KS.READY ? '준비' : '회수 중';
    el.innerHTML = `<span><b>${h ? 'R' : 'L'}</b>${name}</span><span>${st}</span>`;
    setClass(el, 'anc', k.s === KS.ANCHOR);
  });
  const pins = pinCount(ps), kp = kBox.children[3];
  setText(kp, `핀 노드 (F) 박힘 ${pins} · 남은 ${ps.pinCh}/${THREAD.pin.charges}${ps.pinCh < THREAD.pin.charges ? ` · 충전 ${Math.ceil(THREAD.pin.recharge - ps.pinRe)}초` : ''}`);
  const w = wireOn(ps), kw = kBox.children[4], area = ps.area && areaValid(ps);
  if (w) setText(kw, `${area ? `영역 (${ps.area.n.length}각형)` : `와이어 ${ps.wires.length}줄`} · ${wireTime(ps).toFixed(1)}초`);
  else { const plan = threadPlan(); setText(kw, plan.fail ? plan.fail : `설치 가능: ${KIND_NAME[plan.kind]} (노드 ${activeNodes(ps).length})`); }
  setClass(kw, 'on', w);
}

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

// ───── 매 프레임 ─────
export function updateHud(dt, showBoard) {
  const ps = me.ps, slot = ps.cur, w = me.lo[slot].w, ws = ps.w[slot];
  // 체력
  const hp = Math.max(0, Math.ceil(me.hp));
  setText($('hpV'), String(hp)); $('hpB').style.width = `${hp / HEALTH.max * 100}%`;
  setClass($('hp'), 'low', hp < HEALTH.max * 0.35);
  // 탄약 (쿠나이는 손에 있는 개수)
  const ku = isKunai(w), inHand = ku && ps.ku ? ps.ku.filter(k => k.s === KS.READY).length : 0;
  setText($('amC'), w.kind === 'melee' ? '∞' : ku ? String(inHand) : String(ws.ammo)); setText($('amR'), w.kind === 'melee' ? '' : ku ? '/ 2' : `/ ${w.mag}`);
  setText($('wN'), w.name); setText($('wC'), ku ? `${ps.kmode ? '설치 모드' : '기동 모드'} · X 전환` : `${w.cls}${ws.rl > 0 ? ' · 재장전' : ws.over ? ' · 과열' : ''}`);
  setClass($('ammo'), 'low', w.kind !== 'melee' && !ku && ws.ammo <= Math.ceil(w.mag * 0.25));
  updateKunaiBox();
  $('rbar').style.display = ws.rl > 0 ? 'block' : 'none';
  if (ws.rl > 0) $('rbar').firstChild.style.width = `${(1 - ws.rl / ws.rlT) * 100}%`;
  updateSkills();
  skillFlashT -= dt;
  // 조준선: 실제 탄퍼짐 크기
  const spread = spreadOf(ps, me.lo), px = Math.tan(spread * DEG) / Math.tan(camera.fov * DEG / 2) * (innerHeight / 2);
  const gap = clamp(px, 3, 120) + 2;
  crossParts.l.style.left = `${-gap - 9}px`; crossParts.r.style.left = `${gap}px`; crossParts.t.style.top = `${-gap - 9}px`; crossParts.b.style.top = `${gap}px`;
  crossEl.style.opacity = me.alive && wp.adsT < 0.85 && wp.sprintT < 0.6 ? '1' : w.scope ? '0' : '0.35';
  hitT -= dt; hitEl.style.opacity = hitT > 0 ? String(Math.min(1, hitT / 0.12)) : '0';
  killT -= dt; setClass(hitEl, 'kill', killT > 0);
  vigT = Math.max(0, vigT - dt * 1.2); vigEl.style.opacity = String(Math.max(vigT, hp < HEALTH.max * 0.3 && me.alive ? 0.35 : 0));
  dirT = Math.max(0, dirT - dt);
  if (dirFrom && dirT > 0) {
    const a = Math.atan2(dirFrom.x - me.pos.x, dirFrom.z - me.pos.z) - me.yaw + Math.PI;
    dirEl.style.transform = `rotate(${-a}rad)`; dirEl.style.opacity = String(Math.min(1, dirT));
  } else dirEl.style.opacity = '0';
  // 위: 점수·시간·거점
  const left = (game.endsAt - performance.now()) / 1000;
  setText($('timer'), game.overtime ? '연장전' : fmt(left));
  setClass($('timer'), 'ot', game.overtime);
  if (MODE_CFG.teams) { setText($('scA'), String(game.teamScores[me.team] ?? 0)); setText($('scE'), String(game.teamScores[1 - me.team] ?? 0)); }
  else { const top = [...roster.values()].sort((a, b) => b.k - a.k)[0]; setText($('scA'), String((roster.get(me.id) || { k: 0 }).k)); setText($('scE'), String(top ? top.k : 0)); }
  setText($('goal'), MODE_CFG.rules === 'domination' ? `${game.goal}점` : `${game.goal}킬`);
  setClass(topEl, 'ffa', !MODE_CFG.teams);
  const zbox = $('zonebox');
  if (game.dom && zoneEls.length) {
    let inside = -1;
    game.zones.forEach((z, i) => {
      const [o, t, p, c] = game.dom.pts[i];
      const el = zoneEls[i];
      el.className = `zp ${teamCss(o)}${c ? ' c' : ''}${t >= 0 ? ' cap' : ''}`;
      el.children[1].style.width = `${p * 100}%`; el.children[1].className = teamCss(t);
      if (Math.hypot(me.pos.x - z.x, me.pos.z - z.z) <= z.r && me.alive) inside = i;
    });
    if (inside >= 0) {
      const [o, t, p, c] = game.dom.pts[inside], z = game.zones[inside];
      setDisplay(zbox, true);
      setText($('zoneName'), z.name || z.id);
      setText($('zoneState'), c ? '경합 중' : t >= 0 ? (t === me.team ? '점령 중' : '적이 점령 중') : o === me.team ? '우리 거점' : o >= 0 ? '적 거점' : '중립');
      setClass(zbox, 'c', !!c);
      const bar = zbox.querySelector('.zbar i'); bar.style.width = `${(t >= 0 ? p : o >= 0 ? 1 : 0) * 100}%`; bar.className = teamCss(t >= 0 ? t : o);
    } else setDisplay(zbox, false);
  } else setDisplay(zbox, false);
  // 상황 표시
  const prot = ps.st.protect > 0 && me.alive;
  setDisplay($('prot'), prot); if (prot) setText($('prot'), `부활 보호 ${ps.st.protect.toFixed(1)}초 · 공격하거나 스킬을 쓰면 풀립니다`);
  setClass(hudEl, 'stealth', ps.st.stealth > 0);
  bannerT -= dt; bannerEl.style.opacity = bannerT > 0 ? String(Math.min(1, bannerT * 2)) : '0';
  updateDeath(); updateBoard(showBoard && game.matchState === 'playing'); updateEnd();
}
