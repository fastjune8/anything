// 시작점: 모듈을 불러오고 매 프레임 루프를 돈다.
//   입력(input.js) → 이동(player.js)·무기(weapon.js) → 카메라 → 화면 갱신(hud/fx/remotes) → 그리기
import { LEAN_DIST } from '/shared/constants.js';
import { renderer, scene, camera, vm, vmScene, vmCam, colliders, currentMap } from './scene.js';
import { updateTracers, updateParts } from './fx.js';
import { updateRemotes, remotes, remoteHit } from './remotes.js';
import { updateViewmodel } from './viewmodel.js';
import { updateMovement } from './player.js';
import { updateWeapon, startReload, switchTo } from './weapon.js';
import { updateHud } from './hud.js';
import { updateObjective } from './objective.js';
import { updateMinimap, lastStats as minimapStats } from './minimap.js';
import { sendState } from './net.js';
import { isActive } from './input.js';
import { join, nameEl } from './menu.js';
import { me, inv, wp, inp, game, roster, net, loadout, eff, PITCH_MAX } from './state.js';
import { armory, updateArmory } from './armory.js';
import { $, params, BASE_FOV, EMBED, lerp, clamp, smooth } from './util.js';

let last = performance.now(), menuAngle = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.25, (now - last) / 1000); last = now; // 실제로 흐른 시간 (탭을 오래 비웠을 때만 자른다)
  const dt = Math.min(0.05, real); // 연출·무기는 한 프레임에 너무 많이 진행하지 않게
  const active = isActive();

  if (game.joined) {
    updateMovement(real, active); // 이동은 실제 시간대로 (느린 컴퓨터에서도 게임 시간이 늦게 흐르지 않는다)
    updateWeapon(dt, active);
    const w = eff[wp.cur];
    const fov = lerp(BASE_FOV, w.adsFov, smooth(0, 1, wp.adsT)) + wp.sprintT * 4;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    let eye = me.h - 0.13, roll = 0;
    if (!me.alive) { me.deadT = Math.min(1, me.deadT + dt * 2.2); const e = smooth(0, 1, me.deadT); eye = lerp(eye, 0.3, e); roll = e * 0.6; }
    // 기울이기: 머리를 옆으로 내밀고(조금 낮아짐) 화면을 그쪽으로 기울인다. 사격도 이 위치에서 나간다.
    const lo = me.alive ? me.leanOff : 0;
    roll -= (lo / LEAN_DIST) * 0.18;
    camera.position.set(me.pos.x + Math.cos(me.yaw) * lo, me.pos.y + eye + me.stepOff - Math.abs(lo) * 0.12, me.pos.z - Math.sin(me.yaw) * lo);
    camera.rotation.set(clamp(me.pitch + wp.kickP, -PITCH_MAX, PITCH_MAX), me.yaw + wp.kickY, roll);
    camera.updateMatrixWorld();
    updateViewmodel(dt);
    sendState(dt);
  } else if (armory.open) {
    updateArmory(dt);
    vm.visible = false;
  } else {
    // 메뉴 배경: 전장을 천천히 선회
    menuAngle += dt * 0.05;
    camera.position.set(Math.sin(menuAngle) * 48, 16, Math.cos(menuAngle) * 48);
    camera.lookAt(0, 2, 0);
    vm.visible = false;
  }
  inp.mdx = inp.mdy = 0;

  updateRemotes(dt);
  updateTracers(dt);
  updateParts(dt);
  updateObjective(dt); // 점령전 거점 (방에 없으면 숨긴다)
  if (game.joined) { updateHud(dt); updateMinimap(); }

  renderer.clear();
  if (armory.open && !game.joined) { renderer.render(armory.scene, armory.camera); return; } // 무기고는 전장 대신 자기 장면을 그린다
  renderer.render(scene, camera);
  if (vm.visible) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}
requestAnimationFrame(frame);

// 라이브(prod)가 아닌 서버에서는 화면 아래에 환경 이름을 표시해 헷갈리지 않게 한다
fetch('/status').then(r => r.json()).then(st => {
  if (st.env === 'prod') return;
  const t = $('envtag'); t.textContent = `${String(st.env).toUpperCase()} · v${st.version}`; t.style.display = 'block';
}).catch(() => {});

// 디버그 / 자동 테스트 훅 (tests/browser.test.mjs 가 사용)
window.__g = { me, remotes, roster, inv, net, remoteHit, get cur() { return wp.cur; }, get state() { return game.matchState; }, get joined() { return game.joined; }, get map() { return currentMap; }, get colliderCount() { return colliders.length; }, game, minimapStats, switchTo, startReload, loadout, eff, armory,
  input(o) { if ('fire' in o) { inp.fireHeld = o.fire; if (o.fire) inp.fireFresh = true; } if ('ads' in o) inp.adsHeld = o.ads; if (o.key) inp.keys.add(o.key); if (o.keyUp) inp.keys.delete(o.keyUp); } };
if (params.get('auto')) { nameEl.value = params.get('auto'); join(); }
// 스튜디오 안에서 시험 플레이 중: Ctrl/⌘+P 로 멈추고 스튜디오로 돌아간다 (Unity 의 Play 버튼과 같은 단축키)
if (EMBED) addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyP') { e.preventDefault(); parent.postMessage({ t: 'studio-stop' }, location.origin); } }, true);
