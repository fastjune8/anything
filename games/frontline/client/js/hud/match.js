// 위쪽 경기 정보: 팀 점수·시간·거점 소유, 점령 진행 상자, 가운데 알림(banner), 부활 보호 표시
import { me, game, roster } from '../state.js';
import { $, MODE_CFG, esc } from '../util.js';
import { setText, setDisplay, setClass } from '../dom.js';
import { teamCss, fmt } from './common.js';

const hudEl = $('hud'), bannerEl = $('banner');

// ───── 가운데 알림 (점령·경합·연장전) ─────
let bannerT = 0;
export function banner(text, cls = '') { bannerEl.textContent = text; bannerEl.className = cls; bannerT = 2.2; }

// ───── 위: 점수 · 시간 · 거점 ─────
const topEl = $('top'), zoneEls = [];
function renderZones() {
  const box = $('zones'); box.replaceChildren(); zoneEls.length = 0;
  for (const z of game.zones) {
    const d = document.createElement('div'); d.className = 'zp n';
    d.innerHTML = `<b>${esc(z.id)}</b><i></i>`; box.append(d); zoneEls.push(d);
  }
}
export function setZones(zones) { game.zones = zones; renderZones(); }

// 매 프레임
export function updateMatchBar(dt) {
  const ps = me.ps;
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
}
