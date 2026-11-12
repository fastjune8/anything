// 화면 표시(HUD): 체력/탄약/조준선/피격 표시, 킬 피드, 순위표, 종료 화면
import { WEAPONS } from '/shared/weapons.js';
import { camera, canvas } from './scene.js';
import { sfx } from './sfx.js';
import { me, inv, wp, game, roster, currentSpread } from './state.js';
import { $, DEG, NOLOCK, clamp, esc } from './util.js';
import { cache, setText, setDisplay, setClass } from './dom.js';

const hudEl = $('hud'), crossEl = $('cross'), hitEl = $('hitm'), vigEl = $('vig'), dirEl = $('dmgdir');
const crossParts = { l: crossEl.querySelector('.l'), r: crossEl.querySelector('.r'), t: crossEl.querySelector('.t'), b: crossEl.querySelector('.b') };

export const setHudOn = on => hudEl.classList.toggle('on', on);

// 무기 슬롯(1~7번)
const slotsEl = $('slots');
const slotEls = WEAPONS.map((w, i) => { const d = document.createElement('div'); d.innerHTML = `<span>${i + 1}</span>${w.name}`; slotsEl.appendChild(d); return d; });

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
export const rosterSet = p => roster.set(p.id, { id: p.id, name: p.name, bot: !!p.bot, k: p.k | 0, d: p.d | 0 });
export const nameOf = id => (roster.get(id) || {}).name || '?';
export function applyScores(sc) { for (const [id, k, d] of sc) { const p = roster.get(id); if (p) { p.k = k; p.d = d; } } }
const byRank = (a, b) => b.k - a.k || a.d - b.d;

function updateScoreboard() {
  const left = Math.max(0, game.matchEndsAt - performance.now());
  setText($('timer'), game.matchState === 'ended' ? '종료' : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`);
  const list = [...roster.values()].sort(byRank);
  const rows = list.slice(0, 5);
  const mine = roster.get(me.id);
  if (mine && !rows.includes(mine)) rows.push(mine);
  const html = rows.map(p => `<div class="${p.id === me.id ? 'me' : ''}"><span class="nm">${list.indexOf(p) + 1}. ${esc(p.name)}</span><span class="mono">${p.k}</span></div>`).join('');
  const lb = $('lb');
  if (cache.get(lb) !== html) { cache.set(lb, html); lb.innerHTML = html; }
}

export function showEnd(winnerId) {
  const list = [...roster.values()].sort(byRank);
  const win = winnerId === me.id, t = $('endT');
  t.textContent = win ? '승리' : '경기 종료'; t.className = win ? 'win' : 'lose';
  const mine = roster.get(me.id) || { k: 0, d: 0 };
  $('endS').textContent = `우승 ${nameOf(winnerId)}  ·  내 순위 ${list.findIndex(p => p.id === me.id) + 1}위 (${mine.k}킬 ${mine.d}데스)`;
  $('endBoard').innerHTML = list.slice(0, 6).map((p, i) =>
    `<div class="${p.id === me.id ? 'me' : ''}"><span>${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="mono">${p.k} / ${p.d}</span></div>`).join('');
}

// ───── 매 프레임 갱신 ─────
export function updateHud(dt) {
  const w = WEAPONS[wp.cur], st = inv[wp.cur];
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

  setText($('amC'), String(st.ammo)); setText($('amR'), `/ ${st.reserve}`);
  setClass($('amC'), 'low', st.ammo <= Math.ceil(w.mag * 0.25));
  setText($('wN'), w.name);
  setText($('wC'), `${w.cls} · ${w.auto ? '연사' : w.bolt ? '볼트액션' : w.shell ? '펌프액션' : '단발'}`);
  slotEls.forEach((el, i) => { setClass(el, 'on', i === wp.cur); setClass(el, 'empty', inv[i].ammo + inv[i].reserve === 0); });

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
