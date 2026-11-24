// 키보드·마우스 입력. 상태(inp)에 기록만 하고, 실제 반응은 predict.js 가 1/60초마다 cmd 로 만든다.
//   이동 WASD · 달리기 Shift · 슬라이딩/앉기 C(또는 Ctrl) · 점프 Space · 사격 좌클릭 · 정조준 우클릭/T · 재장전 R
//   무기 1·2·휠 · 스킬 Q(주무기 자리)·E(보조무기 자리) · 전술 지도 M · 점수판 Tab · 채팅 Enter
//   듀얼 쿠나이: 좌클릭 왼손 · 우클릭 오른손 (던지기/회수) · R 둘 다 회수 · X 기동/설치 모드 전환 · F 핀 노드
import { canvas, camera } from './scene.js';
import { closeChat, openChat } from './chat.js';
import { sfx } from './sfx.js';
import { me, inp, game, PITCH_MAX } from './state.js';
import { $, DEG, BASE_FOV, NOLOCK, clamp } from './util.js';
import { setDisplay } from './dom.js';

export const isActive = () => game.joined && game.matchState === 'playing' && !inp.chatOpen && (NOLOCK || document.pointerLockElement === canvas);
function lock() { if (!game.joined || game.matchState !== 'playing') return; sfx.init(); const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); }

document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  if (game.joined) setDisplay($('pause'), !on && game.matchState === 'playing', 'flex');
  if (!on) { inp.keys.clear(); inp.fireHeld = inp.adsHeld = false; if (inp.chatOpen) closeChat(); }
});
$('pause').addEventListener('click', e => { if (!e.target.closest('.opt, button')) lock(); });
canvas.addEventListener('click', () => { if (game.joined && !isActive()) lock(); });

const GAME_KEYS = ['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyQ', 'KeyE', 'KeyT', 'KeyM', 'KeyX', 'KeyF', 'ControlLeft'];
addEventListener('keydown', e => {
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && isActive()) { e.preventDefault(); openChat(); return; }
  if (!game.joined) return;
  if (e.code === 'Tab') { e.preventDefault(); inp.board = true; }
  if (!isActive()) return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  inp.keys.add(e.code);
  if (e.code === 'KeyR') inp.reloadPress = true;
  else if (e.code === 'Digit1') inp.wantSlot = 0;
  else if (e.code === 'Digit2') inp.wantSlot = 1;
  else if (e.code === 'KeyQ') inp.skillPress[0] = true;
  else if (e.code === 'KeyE') inp.skillPress[1] = true;
  else if (e.code === 'KeyX') inp.modePress = true; // 쿠나이 모드 전환
  else if (e.code === 'KeyF') inp.nodePress = true; // 쿠나이 핀 노드
  else if (e.code === 'KeyM') inp.tactical = !inp.tactical; // 전술 지도 (게임은 멈추지 않는다)
});
addEventListener('keyup', e => { inp.keys.delete(e.code); if (e.code === 'Tab') inp.board = false; });
addEventListener('blur', () => { inp.keys.clear(); inp.fireHeld = inp.adsHeld = false; inp.board = false; });
addEventListener('mousedown', e => {
  if (!isActive()) return;
  if (e.button === 0) inp.fireHeld = true;
  else if (e.button === 2) inp.adsHeld = true;
});
addEventListener('mouseup', e => { if (e.button === 0) inp.fireHeld = false; else if (e.button === 2) inp.adsHeld = false; });
addEventListener('contextmenu', e => { if (game.joined) e.preventDefault(); });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || !me.alive || inp.chatOpen) return;
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
  inp.wantSlot = 1 - inp.wantSlot;
}, { passive: true });

// 설정
const sens = $('sens'), vol = $('vol');
sens.value = String(inp.sens); $('sensV').textContent = inp.sens.toFixed(2);
sens.oninput = () => { inp.sens = Number(sens.value); $('sensV').textContent = inp.sens.toFixed(2); localStorage.setItem('fd_sens', sens.value); };
const v0 = Number(localStorage.getItem('fd_vol') ?? 0.6); vol.value = String(v0); $('volV').textContent = v0.toFixed(2); sfx.setVolume(v0);
vol.oninput = () => { sfx.setVolume(Number(vol.value)); $('volV').textContent = Number(vol.value).toFixed(2); localStorage.setItem('fd_vol', vol.value); };
