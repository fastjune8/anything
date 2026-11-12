// 키보드/마우스 입력. 입력은 상태(inp)에 기록만 하고, 실제 반응은 player.js / weapon.js 가 매 프레임 처리한다.
import { WEAPONS } from '/shared/weapons.js';
import { canvas, camera } from './scene.js';
import { closeChat, openChat } from './chat.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, PITCH_MAX } from './state.js';
import { $, DEG, BASE_FOV, NOLOCK, clamp } from './util.js';
import { setDisplay } from './dom.js';
import { startReload, switchTo } from './weapon.js';

// 게임 입력을 받아도 되는 상태인가 (접속 중 + 채팅 안 열림 + 마우스 잠금됨)
export const isActive = () => game.joined && !inp.chatOpen && (NOLOCK || document.pointerLockElement === canvas);

function lock() { sfx.init(); const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); }

document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  if (game.joined) setDisplay($('pause'), !on, 'flex'); // 잠금이 풀리면 일시정지 화면
  if (!on) { inp.keys.clear(); inp.fireHeld = inp.adsHeld = inp.fireFresh = false; if (inp.chatOpen) closeChat(); }
});
$('pause').addEventListener('click', e => { if (!e.target.closest('.opt')) lock(); });
canvas.addEventListener('click', () => { if (game.joined && !isActive()) lock(); });

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
