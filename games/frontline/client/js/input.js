// 키보드/마우스 입력. 입력은 상태(inp)에 기록만 하고, 실제 반응은 player.js / weapon.js 가 매 프레임 처리한다.
import { WEAPONS } from '/shared/weapons.js';
import { canvas, camera } from './scene.js';
import { closeChat, openChat } from './chat.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, net, PITCH_MAX } from './state.js';
import { $, DEG, BASE_FOV, NOLOCK, clamp } from './util.js';
import { setDisplay } from './dom.js';
import { startReload, switchTo } from './weapon.js';

// 게임 입력을 받아도 되는 상태인가 (접속 중 + 채팅 안 열림 + 마우스 잠금됨)
// 죽어 있을 때: 자동 부활은 없다. 최소 대기 시간이 지난 뒤 "새로 한" 입력(키/클릭)이 부활 요청이 된다.
// (누르고 있던 키의 반복 입력, 채팅 열기/닫기 키는 제외)
function tryRespawn() {
  if (!game.joined || me.alive || inp.chatOpen || game.matchState !== 'playing') return;
  if (performance.now() < game.respawnAt) return;
  net.send({ t: 'respawn' });
}
addEventListener('keydown', e => { if (!e.repeat && !['Enter', 'NumpadEnter', 'Escape'].includes(e.code)) tryRespawn(); });
addEventListener('mousedown', tryRespawn);

export const isActive = () => game.joined && !inp.chatOpen && (NOLOCK || document.pointerLockElement === canvas);

function lock() { if (!game.joined) return; /* 로비에서는 마우스를 잠그지 않는다 */ sfx.init(); const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); }

document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  // 잠금이 풀리면 설정(일시정지) 창을 띄우되, 죽어 있을 때는 띄우지 않는다 (죽을 때마다 창이 뜨던 문제)
  if (game.joined) setDisplay($('pause'), !on && me.alive, 'flex');
  if (!on) { inp.keys.clear(); inp.fireHeld = inp.adsHeld = inp.fireFresh = false; if (inp.chatOpen) closeChat(); }
});
$('pause').addEventListener('click', e => { if (!e.target.closest('.opt, button')) lock(); }); // 설정 슬라이더/버튼(로비로 나가기)을 누른 클릭은 "전투로 복귀"가 아니다
canvas.addEventListener('click', () => { if (game.joined && !isActive()) lock(); });
$('banner').addEventListener('click', lock);

addEventListener('keydown', e => {
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && isActive()) { e.preventDefault(); openChat(); }
});
addEventListener('keydown', e => {
  if (!isActive()) return;
  if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyQ', 'KeyT'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  inp.keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  else if (e.code === 'KeyQ') switchTo(wp.prev);
  else if (/^Digit[1-9]$/.test(e.code)) switchTo(Number(e.code.slice(5)) - 1);
});
addEventListener('keyup', e => inp.keys.delete(e.code));
addEventListener('blur', () => { inp.keys.clear(); inp.fireHeld = inp.adsHeld = false; });

addEventListener('mousedown', e => {
  if (!isActive()) return;
  if (e.button === 0) { inp.fireHeld = true; inp.fireFresh = true; }
  else if (e.button === 2) inp.adsHeld = true;
});
addEventListener('mouseup', e => { if (e.button === 0) inp.fireHeld = false; else if (e.button === 2) inp.adsHeld = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || !me.alive || inp.chatOpen) return;
  // 일부 브라우저에서 간헐적으로 튀는 값 방지
  const dx = clamp(e.movementX, -400, 400), dy = clamp(e.movementY, -400, 400);
  const k = 0.0022 * inp.sens * Math.tan(camera.fov * DEG / 2) / Math.tan(BASE_FOV * DEG / 2);
  me.yaw -= dx * k;
  me.pitch = clamp(me.pitch - dy * k, -PITCH_MAX, PITCH_MAX);
  inp.mdx += dx; inp.mdy += dy;
});

let wheelAt = 0;
addEventListener('wheel', e => {
  if (!isActive()) return;
  const now = performance.now(); if (now - wheelAt < 120) return; wheelAt = now;
  switchTo((wp.cur + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
}, { passive: true });
