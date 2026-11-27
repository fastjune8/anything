// 키보드·마우스 입력. 상태(inp)에 기록만 하고, 실제 반응은 predict.js 가 1/60초마다 cmd 로 만든다.
//   이동 WASD · 달리기 Shift · 슬라이딩/앉기 C(또는 Ctrl) · 점프 Space · 사격 좌클릭 · 정조준 우클릭/T · 재장전 R
//   무기 1·2·휠 · 스킬 Q(주무기 자리)·E(보조무기 자리) · 전술 지도 M · 점수판 Tab · 채팅 Enter
//   듀얼 쿠나이: 좌클릭 왼손 · 우클릭 오른손 (던지기/회수) · R 둘 다 회수 · X 기동/설치 모드 전환 · F 핀 노드
import { canvas, camera } from './scene.js';
import { closeChat, openChat } from './chat.js';
import { sfx } from './sfx.js';
import { me, inp, game, PITCH_MAX } from './state.js';
import { $, DEG, BASE_FOV, NOLOCK, clamp, params } from './util.js';
import { setDisplay } from './dom.js';
import { lookDiag } from './lookdiag.js';
import { createMouseFilter } from './mousefilter.js';

export const isActive = () => game.joined && game.matchState === 'playing' && !inp.chatOpen && (NOLOCK || document.pointerLockElement === canvas);
// Windows 의 Chrome·Edge 는 포인터 락일 때 커서를 화면 중앙으로 되돌리는 방식(warp)으로 이동량을 계산하는데, 고폴링 마우스에서 가끔 큰 값(movementX 스파이크)을 한 번씩 만든다
//   → 시점이 한 프레임에 수십 도 튄다. unadjustedMovement(원시 입력)는 이 계산을 쓰지 않고 OS 마우스 가속("포인터 정확도 향상")도 없다.
//   Mac 은 이 문제가 없고 가속을 끄면 마우스 느낌이 바뀌므로 Windows 에서만 쓴다. 주소에 ?unadj=0/1 로 강제할 수 있다. 지원하지 않는 브라우저면 예전 방식으로 대체한다
const UNADJ = params.has('unadj') ? params.get('unadj') !== '0' : /Windows/i.test(navigator.userAgent);
function lock() {
  if (!game.joined || game.matchState !== 'playing') return;
  sfx.init();
  const plain = () => { try { const q = canvas.requestPointerLock?.(); if (q && q.catch) q.catch(() => {}); } catch { /* 락을 못 걸어도 다시 클릭하면 된다 */ } };
  if (!UNADJ) { plain(); return; }
  let p;
  try { p = canvas.requestPointerLock?.({ unadjustedMovement: true }); } catch { plain(); return; } // 옵션을 모르는 브라우저
  if (p && p.catch) p.catch(e => { if (lookDiag) console.info('[debuglook] unadjustedMovement 실패 → 기본 방식', e?.name); plain(); });
  else if (!p) plain();
}

const mouseFilter = createMouseFilter();
document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  if (on) mouseFilter.onLock();
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
  const [dx, dy, dropped] = mouseFilter.apply(e.movementX, e.movementY, e.timeStamp); // 고립된 스파이크·락 직후 이벤트는 버린다 (mousefilter.js)
  const k = 0.0022 * inp.sens * Math.tan(camera.fov * DEG / 2) / Math.tan(BASE_FOV * DEG / 2);
  if (lookDiag) lookDiag.mouse(e, dx, dy, k, dropped);
  if (dropped) return;
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
