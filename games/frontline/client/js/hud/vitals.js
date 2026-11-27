// 체력·탄약·무기 이름·재장전 바 (왼쪽 아래와 오른쪽 아래)
import { HEALTH } from '/shared/sim/config.js';
import { KS, isKunai } from '/shared/sim/kunai.js';
import { me } from '../state.js';
import { $ } from '../util.js';
import { setText, setClass } from '../dom.js';

export function updateVitals() {
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
  $('rbar').style.display = ws.rl > 0 ? 'block' : 'none';
  if (ws.rl > 0) $('rbar').firstChild.style.width = `${(1 - ws.rl / ws.rlT) * 100}%`;
}
