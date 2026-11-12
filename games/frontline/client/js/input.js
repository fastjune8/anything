// 키보드/마우스 입력. 입력은 상태(inp)에 기록만 하고, 실제 반응은 player.js / weapon.js 가 매 프레임 처리한다.
import { WEAPONS } from '/shared/weapons.js';
import { canvas, camera } from './scene.js';
import { closeChat, openChat } from './chat.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, PITCH_MAX } from './state.js';
import { $, DEG, BASE_FOV, NOLOCK, clamp } from './util.js';
import { setDisplay } from './dom.js';
import { startReload, switchTo } from './weapon.js';
import { createMouseFilter } from './mousefilter.js';

const mouseFilter = createMouseFilter();

// 게임 입력을 받아도 되는 상태인가 (접속 중 + 채팅 안 열림 + 마우스 잠금됨)
export const isActive = () => game.joined && !inp.chatOpen && (NOLOCK || document.pointerLockElement === canvas);

// 마우스 잠금. 가능하면 "가공되지 않은 입력"(unadjustedMovement)으로 받는다:
// 운영체제의 포인터 가속과 화면 가장자리 되돌림의 영향을 받지 않아 시야가 튀는 문제가 줄어든다.
function lock() {
  sfx.init();
  if (!canvas.requestPointerLock) return;
  const plain = () => { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); };
  let p;
  try { p = canvas.requestPointerLock({ unadjustedMovement: true }); } catch { plain(); return; }
  if (p && p.catch) p.catch(e => { if (e && e.name === 'NotSupportedError') plain(); }); // 지원하지 않는 환경은 일반 잠금으로
}

document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  if (on) mouseFilter.reset();
  // 잠금이 풀리면 설정(일시정지) 창을 띄우되, 죽어 있을 때는 띄우지 않는다 (죽을 때마다 창이 뜨던 문제)
  if (game.joined) setDisplay($('pause'), !on && me.alive, 'flex');
  if (!on) { inp.keys.clear(); inp.fireHeld = inp.adsHeld = inp.fireFresh = false; if (inp.chatOpen) closeChat(); }
});
$('pause').addEventListener('click', e => { if (!e.target.closest('.opt')) lock(); });
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
  const moved = mouseFilter.apply(e.movementX, e.movementY); // 갑자기 튀는 값 제거
  if (!moved) return;
  const [dx, dy] = moved;
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
