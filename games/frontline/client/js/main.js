// 시작점: 모듈을 불러오고 매 프레임 루프를 돈다.
//   입력(input.js) → 예측(predict.js: 1/60초 시뮬레이션) → 카메라 → 화면 갱신(remotes/hud/minimap/fx) → 그리기
import { renderer, scene, camera, vm, vmScene, vmCam, colliders, currentMap, world, precompile } from './scene.js';
import { updateTracers, updateParts, updateGrenades } from './fx.js';
import { updateKunai } from './kunai.js';
import { vfx } from './vfx.js';
import { updateDashFx } from './dashfx.js';
import { updateRemotes, remotes, liveTargets, cullRemoteShadows } from './remotes.js';
import { updateViewmodel, guns as vmGuns, arms as fpArms } from './viewmodel.js';
import { updatePrediction, teleport, netStats } from './predict.js';
import { updatePlayerFx } from './playerfx.js';
import { updateHud } from './hud.js';
import { updateObjective } from './objective.js';
import { updateMinimap, lastStats as minimapStats } from './minimap.js';
import { connect, sendInputs, leaveMatch } from './net.js';
import { isActive } from './input.js';
import { me, wp, inp, game, roster, net, lobby } from './state.js';
import { outfit, setOutfitChoice, equipOutfit, loadout, equip, setSkill } from './loadout.js';
import { $, params, EMBED, MODE_CFG, setMode } from './util.js';
import { setDisplay } from './dom.js';
import { setMapDef } from '/shared/maps/index.js';
import { clipNames, wearableCacheSize } from './charassets.js';
import { dress, setOutfit, outfitState, equip as equipWear, undress } from './outfit.js';
import { clock } from './clock.js';
import { diag } from './netdiag.js';
import { lookDiag } from './lookdiag.js';
import { adaptQuality } from './quality.js';
import { localTP, updateCamera, updateBody, thirdPersonCamera, isThirdPerson, updateMenuCamera } from './selfview.js';
import './lobby.js';

let last = performance.now(), remoteCount = -1;
function frame(now) {
  requestAnimationFrame(frame);
  const jsT0 = lookDiag ? performance.now() : 0;
  const rawMs = now - last, real = Math.min(0.25, rawMs / 1000); last = now;
  const dt = Math.min(0.05, real);
  const active = isActive();
  let cam = camera;
  diag.frame(real * 1000);
  if (game.joined) {
    clock.update(real); // 서버 시계·보간 재생 위치를 먼저 갱신 (입력의 vt 와 원격 플레이어 그리기가 같은 값을 쓴다)
    diag.buffer(clock.delay, clock.delay / 60 * 1000);
    updatePrediction(real, active);
    updatePlayerFx(dt);
    updateCamera(dt);
    updateViewmodel(dt);
    updateBody(dt);
    sendInputs(real);
    cam = thirdPersonCamera() || camera;
  } else updateMenuCamera(dt);
  inp.mdx = inp.mdy = 0;
  updateRemotes(dt);
  if (remotes.size !== remoteCount) { remoteCount = remotes.size; setTimeout(precompile, 300); } // 새 플레이어 모델(재질)이 장면에 들어오면 처음 보이기 전에 셰이더를 미리 컴파일한다 (scene.js precompile)
  updateTracers(dt); updateParts(dt); updateGrenades(dt); updateKunai(dt);
  vfx.update(dt, camera);
  updateDashFx(dt);
  updateObjective(dt);
  if (game.joined) { updateHud(dt, inp.board); updateMinimap(); }
  renderer.info.reset();
  renderer.clear();
  if (localTP.anim) localTP.anim.root.visible = game.joined && isThirdPerson(cam) && me.alive;
  world.beginShadowCull(cam, cullRemoteShadows); // 시야에 그림자가 보일 수 없는 물체는 그림자 맵에서 뺀다
  renderer.render(scene, cam);
  if (vm.visible && cam === camera) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  adaptQuality(rawMs, game.joined && game.matchState === 'playing');
  if (lookDiag && game.joined) lookDiag.frame(rawMs, me.yaw, renderer.info.programs.length, active, performance.now() - jsT0);
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
    if (o.mode) inp.modePress = true; // 쿠나이 모드 전환 (X)
    if (o.node) inp.nodePress = true; // 쿠나이 핀 노드 (F)
  },
};
