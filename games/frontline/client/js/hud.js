// 화면 표시(HUD): 체력/탄약/조준선/피격 표시, 킬 피드, 순위표, 종료 화면
import { WEAPONS } from '/shared/weapons.js';
import { onLoadoutChange } from './loadout.js';
import { camera, canvas } from './scene.js';
import { sfx } from './sfx.js';
import { me, inv, wp, game, roster, loadout, eff, currentSpread, isAlly } from './state.js';
import { $, DEG, NOLOCK, MODE_CFG, clamp, esc } from './util.js';
import { SKILL_KEYS } from '/shared/skills.js';
import { sk, slotSkill, heatOf, grenadeMode, glSkill, chargeReady } from './skills.js';
import { cache, setText, setDisplay, setClass } from './dom.js';

const hudEl = $('hud'), crossEl = $('cross'), hitEl = $('hitm'), vigEl = $('vig'), dirEl = $('dmgdir');
const crossParts = { l: crossEl.querySelector('.l'), r: crossEl.querySelector('.r'), t: crossEl.querySelector('.t'), b: crossEl.querySelector('.b') };

export const setHudOn = on => hudEl.classList.toggle('on', on);

// 무기 슬롯(1·2번): 무기고에서 고른 두 자루
const slotsEl = $('slots');
let slotEls = [];
function renderSlots() {
  slotsEl.replaceChildren();
  slotEls = loadout.slots.map((wi, n) => { const d = document.createElement('div'); d.innerHTML = `<span>${n + 1}</span>${WEAPONS[wi].name}`; slotsEl.appendChild(d); return d; });
}
renderSlots();
onLoadoutChange(wi => { if (wi < 0) renderSlots(); });

// 스킬 칸 (Q·E): 이름 + 상태(쿨타임 · 늘 켜짐 · 유탄 수 · 열) + 아래 막대
const skillsEl = $('skills');
const skillEls = [0, 1].map(n => {
  const d = document.createElement('div'); d.className = 'sk'; d.dataset.n = n;
  d.innerHTML = `<span class="k">${SKILL_KEYS[n]}</span><div class="n"></div><div class="s"></div><i class="cd"></i>`;
  skillsEl.appendChild(d); return d;
});
function updateSkillHud() {
  skillEls.forEach((el, n) => {
    const { wi, skill } = slotSkill(n);
    const nEl = el.children[1], sEl = el.children[2], bar = el.children[3];
    setText(nEl, skill ? skill.name : '스킬 없음');
    let text = '', fill = 0, wait = false, on = false, hot = false;
    if (skill) switch (skill.effect) {
      case 'adrenaline': wait = sk.cd[n] > 0; on = sk.adrenT > 0; text = on ? `사용 중 ${sk.adrenT.toFixed(1)}` : wait ? `${Math.ceil(sk.cd[n])}초` : '준비'; fill = on ? sk.adrenT / skill.dur : wait ? 1 - sk.cd[n] / skill.cd : 1; break;
      case 'dash': wait = me.dashCd > 0; text = wait ? `${Math.ceil(me.dashCd)}초` : '준비'; fill = wait ? 1 - me.dashCd / skill.cd : 1; break;
      case 'grenade': { on = grenadeMode(); text = `${on ? '유탄 모드 · ' : ''}${sk.gl.ammo}/${skill.ammo}발`; fill = sk.gl.ammo >= skill.ammo ? 1 : sk.gl.t / skill.recharge; wait = !sk.gl.ammo; break; }
      case 'shove': wait = sk.cd[n] > 0; on = sk.shoveArmed; text = on ? '다음 사격에 밀어냄' : wait ? `${Math.ceil(sk.cd[n])}초` : '준비'; fill = wait ? 1 - sk.cd[n] / skill.cd : 1; break;
      case 'charge': { const ready = chargeReady(wi, skill), left = skill.wait - (sk.clock - (sk.lastShot[wi] ?? -Infinity)); on = ready && wp.cur === wi; text = ready ? '충전됨' : `충전 ${Math.ceil(left)}초`; fill = ready ? 1 : 1 - left / skill.wait; wait = !ready; break; }
      case 'overheat': { const h = heatOf(wi); hot = h.over; on = wp.cur === wi; text = h.over ? '과열 — 식는 중' : on ? `열 ${Math.round(h.heat * 100)}%` : '늘 켜짐 (들면)'; fill = h.heat; break; }
      default: on = wp.cur === wi; text = on ? '적용 중' : '늘 켜짐 (들면)'; fill = on ? 1 : 0;
    }
    if (sk.flashT[n] > 0) text = sk.flash[n];
    setText(sEl, text); bar.style.width = `${clamp(fill, 0, 1) * 100}%`;
    setClass(el, 'none', !skill); setClass(el, 'wait', wait); setClass(el, 'on', on); setClass(el, 'hot', hot);
  });
}

// ───── 피격/명중 표시 ─────
let hitT = 0, vigT = 0, dirT = 0, dirFrom = null;
export function showHit(head) { hitT = 0.22; setClass(hitEl, 'head', head); sfx.hitmarker(head); } // 내가 맞혔을 때 X 표시
export function hurt(dmg, from) { vigT = Math.min(1, 0.45 + dmg / 80); dirT = 1.4; dirFrom = from; } // 내가 맞았을 때 화면 붉게 + 방향

// ───── 킬 피드 (html 문자열을 받으므로 이름은 호출하는 쪽에서 esc 해야 한다) ─────
export function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d);
  setTimeout(() => d.remove(), 5200);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
}

// ───── 명단 / 순위 ─────
export const rosterSet = p => roster.set(p.id, { id: p.id, name: p.name, bot: !!p.bot, k: p.k | 0, d: p.d | 0, team: p.team ?? -1 });
// 순위표/킬 피드에서 쓰는 색 구분: 나·아군 = 'a'(강조색), 그 외 = 'e'
export const sideOf = id => (id === me.id || isAlly((roster.get(id) || {}).team) ? 'a' : 'e');
export const nameOf = id => (roster.get(id) || {}).name || '?';
export function applyScores(sc) { for (const [id, k, d] of sc) { const p = roster.get(id); if (p) { p.k = k; p.d = d; } } }
const byRank = (a, b) => b.k - a.k || a.d - b.d;

function updateScoreboard() {
  const left = Math.max(0, game.matchEndsAt - performance.now());
  setText($('timer'), game.matchState === 'ended' ? '종료' : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`);
  // 가운데 위: 개인전은 목표 킬, 팀전은 팀 점수 (점령전은 거점 점수)
  const ts = game.teamScores, mt = me.team === 1 ? 1 : 0, unit = MODE_CFG.rules === 'zone' ? '점' : '킬';
  setText($('goal'), MODE_CFG.teams ? `아군 ${ts[mt]} : ${ts[1 - mt]} 적군 · ${game.goalKills}${unit} 선승` : `${game.goalKills}킬 선승`);
  const list = [...roster.values()].sort(byRank);
  const rows = list.slice(0, 5);
  const mine = roster.get(me.id);
  if (mine && !rows.includes(mine)) rows.push(mine);
  const html = rows.map(p => `<div class="${p.id === me.id ? 'me' : MODE_CFG.teams ? (isAlly(p.team) ? 'ally' : 'foe') : ''}"><span class="nm">${list.indexOf(p) + 1}. ${esc(p.name)}</span><span class="mono">${p.k}</span></div>`).join('');
  const lb = $('lb');
  if (cache.get(lb) !== html) { cache.set(lb, html); lb.innerHTML = html; }
}

// winnerId: 개인전 우승자, winTeam: 팀전에서 이긴 팀 (-1 = 무승부)
export function showEnd(winnerId, winTeam = -1) {
  const list = [...roster.values()].sort(byRank);
  const t = $('endT');
  const mine = roster.get(me.id) || { k: 0, d: 0 };
  if (MODE_CFG.teams) {
    const win = winTeam === me.team, draw = winTeam < 0, ts = game.teamScores, mt = me.team === 1 ? 1 : 0;
    t.textContent = draw ? '무승부' : win ? '승리' : '패배'; t.className = win ? 'win' : 'lose';
    $('endS').textContent = `아군 ${ts[mt]} : ${ts[1 - mt]} 적군  ·  내 기록 ${mine.k}킬 ${mine.d}데스`;
  } else {
    const win = winnerId === me.id;
    t.textContent = win ? '승리' : '경기 종료'; t.className = win ? 'win' : 'lose';
    $('endS').textContent = `우승 ${nameOf(winnerId)}  ·  내 순위 ${list.findIndex(p => p.id === me.id) + 1}위 (${mine.k}킬 ${mine.d}데스)`;
  }
  $('endBoard').innerHTML = list.slice(0, 6).map((p, i) =>
    `<div class="${p.id === me.id ? 'me' : MODE_CFG.teams ? (isAlly(p.team) ? 'ally' : 'foe') : ''}"><span>${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="mono">${p.k} / ${p.d}</span></div>`).join('');
}

// ───── 매 프레임 갱신 ─────
export function updateHud(dt) {
  const w = eff[wp.cur], st = inv[wp.cur];
  // 조준선: 탄퍼짐만큼 벌어진다
  const gap = Math.max(4, Math.tan(currentSpread() * DEG) / Math.tan(camera.fov * DEG / 2) * innerHeight / 2);
  crossParts.l.style.left = `${-gap - 9}px`; crossParts.r.style.left = `${gap}px`;
  crossParts.t.style.top = `${-gap - 9}px`; crossParts.b.style.top = `${gap}px`;
  crossEl.style.opacity = (!me.alive || wp.adsT > 0.35 || wp.sprintT > 0.6 || game.matchState === 'ended') ? 0 : 1;

  hitT -= dt; hitEl.style.opacity = clamp(hitT / 0.12, 0, 1);
  vigT = Math.max(0, vigT - dt * 1.2);
  vigEl.style.opacity = Math.max(vigT, me.alive ? clamp((45 - me.hp) / 60, 0, 0.6) : 0);
  dirT -= dt;
  if (dirT > 0 && dirFrom) {
    const dx = dirFrom.x - me.pos.x, dz = dirFrom.z - me.pos.z;
    const f = -Math.sin(me.yaw) * dx - Math.cos(me.yaw) * dz, r = Math.cos(me.yaw) * dx - Math.sin(me.yaw) * dz;
    dirEl.style.transform = `rotate(${Math.atan2(r, f)}rad)`;
    dirEl.style.opacity = clamp(dirT / 0.5, 0, 1);
  } else dirEl.style.opacity = 0;

  setText($('hpV'), String(Math.max(0, Math.ceil(me.hp))));
  const hb = $('hpB'); hb.style.width = `${clamp(me.hp, 0, 100)}%`;
  hb.style.background = me.hp <= 30 ? 'var(--danger)' : me.hp <= 60 ? 'var(--accent)' : 'var(--ui)';

  const gl = grenadeMode() ? glSkill() : null; // 유탄 모드: 탄약 칸에 유탄 수
  setText($('amC'), String(gl ? sk.gl.ammo : st.ammo)); setText($('amR'), gl ? `/ ${gl.skill.ammo}` : `/ ${st.reserve}`);
  setClass($('amC'), 'low', gl ? sk.gl.ammo === 0 : st.ammo <= Math.ceil(w.mag * 0.25));
  setText($('wN'), w.name);
  setText($('wC'), gl ? `유탄 모드 · [${SKILL_KEYS[loadout.slots.indexOf(gl.wi)]}] 총으로` : `${w.cls} · ${w.auto ? '연사' : w.bolt ? '볼트액션' : w.shell ? '펌프액션' : '단발'}`);
  updateSkillHud();
  slotEls.forEach((el, n) => { const i = loadout.slots[n]; setClass(el, 'on', i === wp.cur); setClass(el, 'empty', inv[i].ammo + inv[i].reserve === 0); });

  let hint = '';
  if (me.alive && !wp.reload) {
    if (st.ammo === 0 && st.reserve === 0) hint = '탄약 없음 — 다른 무기로 교체하세요';
    else if (st.ammo === 0) hint = '[R] 재장전';
    else if (st.ammo <= Math.ceil(w.mag * 0.25) && st.reserve > 0) hint = '탄약 부족 · [R] 재장전';
  }
  const hintEl = $('hint'); setText(hintEl, hint || cache.get(hintEl) || ''); hintEl.style.opacity = hint ? 1 : 0;

  const rb = $('rbar');
  setDisplay(rb, !!wp.reload && me.alive);
  if (wp.reload) rb.firstElementChild.style.width = `${clamp(wp.reload.t / wp.reload.total, 0, 1) * 100}%`;

  // 스폰 무적 남은 시간
  const invLeft = game.invUntil - performance.now();
  setDisplay($('inv'), me.alive && invLeft > 0);
  if (invLeft > 0) setText($('inv'), `무적 ${(invLeft / 1000).toFixed(1)}초 · 사격하면 해제`);

  // 마우스 잠금이 풀렸는데 설정 창이 떠 있지 않으면, 클릭하라는 안내만 작게 보여 준다
  const needClick = !NOLOCK && document.pointerLockElement !== canvas && $('pause').style.display !== 'flex' && game.matchState !== 'ended';
  setDisplay($('banner'), needClick);
  if (needClick) setText($('banner'), '화면을 클릭하면 계속합니다');

  updateScoreboard();
  setDisplay($('dead'), !me.alive && game.matchState === 'playing', 'flex');
  if (!me.alive) {
    const wait = (game.respawnAt - performance.now()) / 1000;
    setText($('deadT'), wait > 0 ? `${wait.toFixed(1)}초 후 재투입 가능` : '아무 키나 누르거나 클릭하면 재투입');
  }
  setDisplay($('endscr'), game.matchState === 'ended', 'flex');
  if (game.matchState === 'ended') setText($('endR'), `${Math.max(0, Math.ceil((game.endAt - performance.now()) / 1000))}초 후 다음 경기 시작`);
}
