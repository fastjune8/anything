// 시작점: 모듈을 불러오고 매 프레임 루프를 돈다.
//   입력(input.js) → 예측(predict.js: 1/60초 시뮬레이션) → 카메라 → 화면 갱신(remotes/hud/minimap/fx) → 그리기
import * as THREE from 'three';
import { renderer, scene, camera, vm, vmScene, vmCam, colliders, currentMap, world } from './scene.js';
import { updateTracers, updateParts, updateGrenades } from './fx.js';
import { vfx } from './vfx.js';
import { updateDashFx, dashView } from './dashfx.js';
import { updateRemotes, remotes, liveTargets, cullRemoteShadows } from './remotes.js';
import { updateViewmodel, guns as vmGuns, arms as fpArms } from './viewmodel.js';
import { updatePrediction, updateRecoil, rpos, teleport, netStats } from './predict.js';
import { updateHud } from './hud.js';
import { updateObjective } from './objective.js';
import { updateMinimap, lastStats as minimapStats } from './minimap.js';
import { connect, sendInputs, leaveMatch } from './net.js';
import { isActive } from './input.js';
import { me, wp, inp, game, roster, net, lobby, eff, PITCH_MAX } from './state.js';
import { outfit, onOutfitChange, setOutfitChoice, equipOutfit, loadout, equip, setSkill } from './loadout.js';
import { $, params, BASE_FOV, EMBED, lerp, clamp, smooth, MODE_CFG, setMode } from './util.js';
import { setDisplay } from './dom.js';
import { WEAPONS } from '/shared/weapons.js';
import { setMapDef } from '/shared/maps/index.js';
import { TPAnimator, RIFLE_WEAPONS, newCharState } from './charanim.js';
import { clipNames, wearableCacheSize } from './charassets.js';
import { buildGun } from './guns.js';
import { dress, setOutfit, outfitState, equip as equipWear, undress } from './outfit.js';
import { clock } from './clock.js';
import { diag } from './netdiag.js';
import { BODY } from '/shared/sim/config.js';
import './lobby.js';

// ───── 3인칭 시점 (기획 11.2: 1인칭·3인칭 지원) ─────
// V 키: 어깨 너머 3인칭 카메라. 1인칭과 같은 게임 상태로 같은 캐릭터·무기를 그린다 (조준·사격 판정은 늘 눈 기준)
const localTP = { anim: TPAnimator.create(), guns: [], cs: newCharState(), view: params.has('tpcam') };
const tpCam = new THREE.PerspectiveCamera(70, 1, 0.05, 1500); tpCam.rotation.order = 'YXZ';
if (localTP.anim) {
  localTP.anim.root.visible = false; scene.add(localTP.anim.root);
  localTP.guns = WEAPONS.map(w => { const g = buildGun(w.id, false, {}, false); g.group.visible = false; return g; });
  localTP.outfit = dress(localTP.anim.inst, outfit.choice, { view: 'tp' });
  onOutfitChange(c => setOutfit(localTP.outfit, c));
}
addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && localTP.anim && game.joined && !inp.chatOpen) localTP.view = !localTP.view; });
function updateLocalTP(dt) {
  const L = localTP, cs = L.cs;
  if (!L.anim) return;
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  cs.fwd = -me.vel.x * sy - me.vel.z * cy; cs.side = me.vel.x * cy - me.vel.z * sy;
  cs.air = !me.onGround; cs.vy = me.vel.y; cs.ads = wp.adsT; cs.sprint = wp.sprinting;
  cs.rifle = RIFLE_WEAPONS.has(WEAPONS[wp.cur].id);
  cs.reloadF = wp.reload && !wp.reload.shell ? Math.min(1, wp.reload.t / wp.reload.total) : null;
  cs.shots = wp.shots; cs.pitch = me.pitch; cs.alive = me.alive;
  const root = L.anim.root;
  root.position.copy(rpos); root.rotation.set(me.slide > 0 ? -0.7 : 0, me.yaw, 0);
  root.scale.set(1, me.crouch && me.slide <= 0 ? 0.74 : 1, 1);
  L.anim.setGun(L.guns[wp.cur]);
  L.anim.update(dt, cs);
}

// 속도감: 달리기보다 빠를수록 시야가 넓어진다 (슬라이딩·슬라이딩 점프·반동 이동)
let fovBoost = 0;
function speedFov(dt) {
  const v = Math.hypot(me.vel.x, me.vel.z), want = Math.min(9, Math.max(0, v - 7) * 1.4) + (me.slide > 0 ? 2 : 0);
  fovBoost += (want - fovBoost) * (1 - Math.exp(-dt * 6));
  return fovBoost;
}
let last = performance.now(), menuAngle = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.25, (now - last) / 1000); last = now;
  const dt = Math.min(0.05, real);
  const active = isActive();
  let cam = camera;
  diag.frame(real * 1000);
  if (game.joined) {
    clock.update(real); // 서버 시계·보간 재생 위치를 먼저 갱신 (입력의 vt 와 원격 플레이어 그리기가 같은 값을 쓴다)
    diag.buffer(clock.delay, clock.delay / 60 * 1000);
    updatePrediction(real, active);
    updateRecoil(dt);
    const w = eff[wp.cur];
    const fov = lerp(BASE_FOV, w.adsFov, smooth(0, 1, wp.adsT)) + wp.sprintT * 4 + dashView.fov + speedFov(dt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    let eye = me.h - BODY.EYE, roll = dashView.roll;
    if (!me.alive) { me.deadT = Math.min(1, me.deadT + dt * 2.2); const e = smooth(0, 1, me.deadT); eye = lerp(eye, 0.3, e); roll = e * 0.6; }
    if (me.stunT > 0) { eye -= 0.35 * Math.min(1, me.stunT / 0.15); roll += 0.3 * Math.min(1, me.stunT / 0.15); }
    if (me.slide > 0) roll += 0.03;
    camera.position.set(rpos.x, rpos.y + eye + me.stepOff, rpos.z);
    camera.rotation.set(clamp(me.pitch + wp.kickP, -PITCH_MAX, PITCH_MAX), me.yaw + wp.kickY, roll);
    camera.updateMatrixWorld();
    updateViewmodel(dt);
    updateLocalTP(dt);
    sendInputs(real);
    if (localTP.view && localTP.anim) {
      // 어깨 너머: 뒤 2.8m · 오른쪽 0.55m, 벽에 막히면 당긴다
      const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw), cp = Math.cos(me.pitch), sp = Math.sin(me.pitch);
      const back = new THREE.Vector3(sy * cp, -sp, cy * cp), side = new THREE.Vector3(cy, 0, -sy);
      const pivot = new THREE.Vector3(rpos.x, rpos.y + me.h - 0.1, rpos.z).addScaledVector(side, 0.55);
      tpCam.position.copy(pivot).addScaledVector(back, 2.8);
      tpCam.rotation.set(me.pitch, me.yaw, 0); tpCam.aspect = camera.aspect; tpCam.fov = camera.fov; tpCam.updateProjectionMatrix();
      cam = tpCam;
    }
  } else {
    menuAngle += dt * 0.05;
    camera.position.set(Math.sin(menuAngle) * 48, 16, Math.cos(menuAngle) * 48);
    camera.lookAt(0, 2, 0);
    vm.visible = false;
  }
  inp.mdx = inp.mdy = 0;
  updateRemotes(dt);
  updateTracers(dt); updateParts(dt); updateGrenades(dt);
  vfx.update(dt, camera);
  updateDashFx(dt);
  updateObjective(dt);
  if (game.joined) { updateHud(dt, inp.board); updateMinimap(); }
  renderer.info.reset();
  renderer.clear();
  if (localTP.anim) localTP.anim.root.visible = game.joined && cam === tpCam && me.alive;
  world.beginShadowCull(cam, cullRemoteShadows); // 시야에 그림자가 보일 수 없는 물체는 그림자 맵에서 뺀다
  renderer.render(scene, cam);
  if (vm.visible && cam === camera) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}
requestAnimationFrame(frame);

// F3: 네트워크 진단 (RTT·수신 간격·버퍼·튐·보정·FPS). 4번/초 갱신
const diagEl = $('netdiag');
addEventListener('keydown', e => { if (e.code === 'F3' && !e.repeat) { e.preventDefault(); diagEl.style.display = diagEl.style.display === 'block' ? 'none' : 'block'; } });
setInterval(() => {
  if (diagEl.style.display !== 'block') return;
  const s = diag.summary(), f = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '-';
  const ri = renderer.info; // 개발·테스트 서버에서만 (envtag 가 보일 때): 마지막 프레임의 렌더 통계
  const renderLine = $('envtag').style.display === 'block' ? [`렌더 draw call ${ri.render.calls} · 삼각형 ${ri.render.triangles} · 지오메트리 ${ri.memory.geometries} · 텍스처 ${ri.memory.textures} · 그림자 ${renderer.shadowMap.enabled ? 'ON' : 'OFF'}`] : [];
  diagEl.textContent = [`RTT ${f(s.rtt.avg)}ms (지터 ${f(s.rtt.jitter)}, 최대 ${f(s.rtt.max)})`, `스냅샷 ${f(s.snap.avg, 1)}ms ±${f(s.snap.jitter, 1)} · p99 ${f(s.snap.p99)} · 최대 ${f(s.snap.maxGap)} · 100ms↑ ${s.snap.gaps100}회`,
    `보간 버퍼 ${f(s.buffer.ms)}ms (${f(s.buffer.ticks, 1)}tick) · 예측으로 그린 ${f(s.remote.underPct, 1)}%`, `원격 튐 ${s.remote.jumps}회 (최대 한 프레임 ${f(s.remote.maxStep, 2)}m)`,
    `내 위치 보정 ${s.correction.n}회 · 최대 ${f(s.correction.max, 2)}m`, `FPS ${f(s.fps.avg)} (최저 ${f(s.fps.min)})`, `수신 ${f(s.rate.kbps, 1)}KB/s · ${Object.entries(s.rate.counts).map(([k, v]) => `${k} ${v}`).join(' ')}`, ...renderLine].join('\n');
}, 250);

// 로비로 나가기 (스튜디오 시험 플레이 중이면 스튜디오로)
$('leave').addEventListener('click', () => { if (EMBED) { parent.postMessage({ t: 'studio-stop' }, location.origin); return; } leaveMatch(); });
if (EMBED) addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyP') { e.preventDefault(); parent.postMessage({ t: 'studio-stop' }, location.origin); } }, true);

// 개발 서버 표시
fetch('/status').then(r => r.json()).then(st => {
  if (st.env === 'prod') return;
  const t = $('envtag'); t.textContent = `${String(st.env).toUpperCase()} · v${st.version}`; t.style.display = 'block';
}).catch(() => {});

// ───── 접속 ─────
// ?auto=이름 : 바로 빠른 매칭 (자동 테스트·스튜디오). ?draft=맵 : 스튜디오의 저장 안 한 맵으로 혼자 쓰는 방
async function autoJoin() {
  const name = params.get('auto');
  if (!name) return;
  localStorage.setItem('fd_name', name);
  if (params.get('mode')) setMode(params.get('mode'));
  const draft = params.get('draft');
  if (draft) {
    const def = await fetch(`/api/drafts/${draft}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (def) setMapDef(def);
  }
  const wait = () => new Promise(res => { const t = setInterval(() => { if (lobby.me) { clearInterval(t); res(); } }, 50); });
  await wait();
  if (lobby.me.name !== name) net.send({ t: 'name', name });
  const map = draft || params.get('map');
  if (map) net.send({ t: 'rcreate', name: `맵 시험 · ${map}`, mode: MODE_CFG.id, map, pass: Math.random().toString(36).slice(2, 8), bots: params.get('bots') !== '0', minutes: 10 });
  else net.send({ t: 'qm', mode: MODE_CFG.id });
}
connect();
autoJoin();
setDisplay($('menu'), true, 'flex');

// 디버그 / 자동 테스트 훅 (tests/browser.test.mjs)
window.__g = {
  netdiag: diag, me, remotes, roster, game, lobby, net, netStats, inp, liveTargets, teleport, clock, loadout, equip, setSkill, minimapStats, vmGuns, fpArms, clipNames, localTP,
  wear: { outfit, setOutfitChoice, equipOutfit, outfitState, dress, setOutfit, equip: equipWear, undress, wearableCacheSize, renderer },
  get cur() { return wp.cur; }, get slot() { return me.ps.cur; }, get state() { return game.matchState; }, get joined() { return game.joined; }, get map() { return currentMap; }, get colliderCount() { return colliders.length; },
  input(o) {
    if ('fire' in o) inp.fireHeld = o.fire;
    if ('ads' in o) inp.adsHeld = o.ads;
    if (o.key) inp.keys.add(o.key);
    if (o.keyUp) inp.keys.delete(o.keyUp);
    if ('slot' in o) inp.wantSlot = o.slot;
    if (o.skill !== undefined) inp.skillPress[o.skill] = true;
    if (o.reload) inp.reloadPress = true;
  },
};
