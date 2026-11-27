// 전투 피드백: 맞힘 표시·피해 숫자·피격 비네트와 방향·조준선(십자선)·도트 사이트 점.
//   조준 방식별 조준점은 weaponview.js 가 정한다 — 여기서는 그 값을 그리기만 한다.
import { spreadOf } from '/shared/sim/player.js';
import { HEALTH } from '/shared/sim/config.js';
import { camera } from '../scene.js';
import { sfx } from '../sfx.js';
import { me, wp } from '../state.js';
import { viewOf } from '../weaponview.js';
import { $, DEG, clamp, smooth } from '../util.js';
import { setClass } from '../dom.js';

const crossEl = $('cross'), hitEl = $('hitm'), vigEl = $('vig'), dirEl = $('dmgdir'), dotEl = $('reddot');
const crossParts = { l: crossEl.querySelector('.l'), r: crossEl.querySelector('.r'), t: crossEl.querySelector('.t'), b: crossEl.querySelector('.b') };

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


// 도트 사이트: 정조준하면 조준경 유리 한가운데에 빨간 점 (총과 같이 움직이지 않고 화면 중앙에 고정 — 시선 = 조준선)
let dotOp = -1;
function updateReticle(ads) {
  const a = ads.reticle === 'dot' && me.alive && !wp.reload ? smooth(0.55, 0.95, wp.adsT) : 0;
  if (Math.abs(a - dotOp) > 0.01) { dotOp = a; dotEl.style.opacity = a.toFixed(2); }
}

// 매 프레임
export function updateCombat(dt) {
  const ps = me.ps, hp = Math.max(0, Math.ceil(me.hp));
  // 조준선: 실제 탄퍼짐 크기
  const spread = spreadOf(ps, me.lo), px = Math.tan(spread * DEG) / Math.tan(camera.fov * DEG / 2) * (innerHeight / 2);
  const gap = clamp(px, 3, 120) + 2;
  crossParts.l.style.left = `${-gap - 9}px`; crossParts.r.style.left = `${gap}px`; crossParts.t.style.top = `${-gap - 9}px`; crossParts.b.style.top = `${gap}px`;
  const ads = viewOf(wp.cur).ads; // 조준 방식별 조준점 (weaponview.js)
  crossEl.style.opacity = me.alive && wp.adsT < 0.85 && wp.sprintT < 0.6 ? '1' : String(ads.crosshair);
  updateReticle(ads);
  hitT -= dt; hitEl.style.opacity = hitT > 0 ? String(Math.min(1, hitT / 0.12)) : '0';
  killT -= dt; setClass(hitEl, 'kill', killT > 0);
  vigT = Math.max(0, vigT - dt * 1.2); vigEl.style.opacity = String(Math.max(vigT, hp < HEALTH.max * 0.3 && me.alive ? 0.35 : 0));
  dirT = Math.max(0, dirT - dt);
  if (dirFrom && dirT > 0) {
    const a = Math.atan2(dirFrom.x - me.pos.x, dirFrom.z - me.pos.z) - me.yaw + Math.PI;
    dirEl.style.transform = `rotate(${-a}rad)`; dirEl.style.opacity = String(Math.min(1, dirT));
  } else dirEl.style.opacity = '0';
}
