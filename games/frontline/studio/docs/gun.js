// 총 모델 문서: Blender 에서 내보낸 .glb 를 규칙(docs/GUN_MODELING.md)대로 검사하고,
// 게임과 같은 코드로 1인칭·정조준·파츠·스킨을 미리 본다. 통과하면 content/guns/<id>.glb 로 저장한다.
//   id: 저장된 총 id | 'sample' (예시 총) | 'file…' (opts.buffer 로 연 파일)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS } from '/shared/weapons.js';
import { SLOTS as PART_SLOTS, PARTS as PART_LIST } from '/shared/parts.js';
import { buildGun, wrapGun, setGunParts, attachArms } from '/js/guns.js';
import { SLOTS, SKINS, scanModel, gunSpec, checkModel, applySkin, slotOf, modelType, socketsFor } from '/js/modelrules.js';
import { sampleGunGlb } from '../samplegun.js';
import { attachClips, poseClip, reloadMotion } from '/js/gunanim.js';
import { dressGun, gunMats, setGunMats, setGunFx, useGunMaterials, LAYERS } from '/js/gunmat.js';
import { GUN_SLOTS, checkGunMaterials } from '/shared/content/schema.js';
import { html, saveContent } from '../util.js';

const VM_FOV = 52; // 게임의 1인칭 총 카메라와 같은 시야각
const hex = n => '#' + n.toString(16).padStart(6, '0');
let envTex = null; // 반사용 환경 (모든 총 문서가 같이 쓴다)

export async function createGunDoc(ctx, id, opts = {}) {
  const { canvas, renderer } = ctx;
  // 모델 데이터 읽기
  let buffer, name, savedId = null;
  if (id === 'sample') { buffer = await sampleGunGlb(); name = '예시 총 (규칙대로 만든 것)'; }
  else if (opts.buffer) { buffer = opts.buffer; name = opts.name || '모델.glb'; }
  else {
    const res = await fetch(`/content/guns/${id}.glb`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`content/guns/${id}.glb 를 읽을 수 없음`);
    buffer = await res.arrayBuffer(); name = `${id}.glb`; savedId = id;
  }

  // ───────── 화면 조각 ─────────
  const overlay = html('div', '', '<div class="labels" data-r="labels"></div><div class="vhint" data-r="vhint"></div>');
  const sec = (title, inner) => `<div class="tbx-h">${title}</div><div>${inner}</div>`;
  const tools = html('div', '', sec('보기', `<div class="seg" data-r="views"><button type="button" data-view="orbit" class="on" title="돌려 보며 부착 지점 확인">살펴보기</button><button type="button" data-view="hip" title="게임에서 들고 있는 모습">1인칭</button><button type="button" data-view="ads" title="정조준 — 빨간 점에 가늠쇠가 겹쳐야 한다">정조준</button></div>`)
    + sec('표시', `<label class="tog"><input type="checkbox" data-r="showSockets" checked> 부착 지점</label><label class="tog"><input type="checkbox" data-r="showWire"> 와이어프레임</label>
      <label class="tog"><input type="checkbox" data-r="showArms" checked> 팔 (1인칭)</label><label class="tog"><input type="checkbox" data-r="spin"> 천천히 돌리기</label>`)
    + sec('크기 비교', '<select data-r="ghostSel" title="지금 게임의 총을 반투명으로 겹쳐 보기"><option value="">없음</option></select>')
    + sec('파츠 달아 보기', '<div data-r="partSels"></div>')
    + sec('스킨 (색 칸)', '<select data-r="skinSel"></select><div class="slots" data-r="slotList"></div>')
    + sec('모션', '<div data-r="motion"></div>')
    + sec('질감 비교', `<label class="tog" title="끄면 Blender 에서 나온 그대로 (엔진 질감 없이) — 켜고 끄며 비교"><input type="checkbox" data-r="engineMat" checked> 엔진 질감 <kbd>M</kbd></label>
      <label class="tog" title="금속의 브러시 결, 폴리머의 오돌토돌함"><input type="checkbox" data-r="layGrain" checked> 미세 질감</label>
      <label class="tog" title="각진 모서리의 칠이 벗겨져 금속이 보인다"><input type="checkbox" data-r="layWear" checked> 모서리 닳음</label>
      <label class="tog" title="도장면의 맑은 반사층"><input type="checkbox" data-r="layCoat" checked> 광택 코팅</label>
      <label class="tog" title="Blender 에서 정점 색으로 구운 틈새 그림자"><input type="checkbox" data-r="showAo" checked> 정점 색 AO</label>
      <label class="kv">조명<select data-r="lightSel"><option value="studio">스튜디오</option><option value="game">게임 (1인칭)</option><option value="sun">밝은 햇빛</option><option value="dark">어두운 곳</option></select></label>
      <button type="button" data-r="closeUp" title="질감이 잘 보이게 가까이 (다시 누르면 전체)">가까이 보기</button>
      <label class="kv" title="과열 스킬: 총열(metal 칸)이 달아오른다">효과 · 열<input type="range" min="0" max="1" step="0.01" value="0" data-r="fxHeat"></label>
      <label class="kv" title="차지 샷 충전·아드레날린: core 가 밝아진다">효과 · 충전<input type="range" min="0" max="1" step="0.01" value="0" data-r="fxCharge"></label>`)
    + '<p class="note">만드는 규칙: docs/GUN_MODELING.md · 조작법은 ? (F1)</p>');
  for (const h of tools.querySelectorAll('.tbx-h')) h.addEventListener('click', () => h.classList.toggle('shut'));
  const toolbar = html('div', '', `<span class="grp"><span class="gl">파일</span><span class="status" data-r="fname"></span></span><span class="grow"></span>
    <span class="grp"><span class="gl">총 id</span><input type="text" data-r="gunId" placeholder="예: vk12" size="14" title="영문 소문자·숫자·_ (content/guns/<id>.glb)">
    <button type="button" class="primary" data-r="save" title="검사를 통과하면 프로젝트(content/guns)에 저장 (⌘S)">프로젝트에 저장</button></span>
    <span class="sep"></span><span class="grp"><span class="pill" data-r="regState"></span>
    <button type="button" data-r="register" title="검증을 통과해 저장한 모델을 게임 데이터로 등록 (무기에 연결)">데이터로 등록</button></span>`);
  const inspector = html('div', '', '<h2>규칙 검사</h2><div class="checks" data-r="checks"></div><h2 class="sub2">부착 지점</h2><div class="socks" data-r="socks"></div><h2 class="sub2">질감 값 <small>(모든 총 공통)</small></h2><div class="matTable" data-r="matTable"></div><button type="button" data-r="matSave" disabled title="content/gunmaterials.json — 모든 총(게임 포함)에 적용">질감 저장</button>');
  const r = n => overlay.querySelector(`[data-r="${n}"]`) || tools.querySelector(`[data-r="${n}"]`) || toolbar.querySelector(`[data-r="${n}"]`) || inspector.querySelector(`[data-r="${n}"]`);

  // ───────── 3D ─────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4f7470);
  if (!envTex) envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex; scene.environmentIntensity = 0.5;
  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x3a4a48, 1.2); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.2); sun.position.set(-2, 3, 1.5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 50);
  const controls = new OrbitControls(camera, canvas); controls.disconnect();
  controls.enableDamping = true;
  const holder = new THREE.Group(); scene.add(holder);
  const adsDot = new THREE.Mesh(new THREE.SphereGeometry(0.0006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020, depthTest: false }));
  adsDot.position.set(0, 0, -0.1); adsDot.renderOrder = 20; camera.add(adsDot); scene.add(camera);

  // ───────── 모델 ─────────
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const root = new THREE.Group(); root.add(gltf.scene); root.updateMatrixWorld(true);
  const scan = scanModel(root);
  const checks = checkModel(root, { bytes: buffer.byteLength, clips: gltf.animations }, scan);
  const type = modelType(scan), SOCKETS = socketsFor(type); // 총 / 근접 무기(socket_tip 이 있고 socket_muzzle 이 없음)
  const spec = type === 'gun' ? gunSpec(root, scan) : null;
  for (const [k, o] of Object.entries(scan.sockets)) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshBasicMaterial({ color: SOCKETS[k] ? SOCKETS[k].color : 0xffffff, depthTest: false, transparent: true }));
    m.renderOrder = 10; m.userData.socket = k; o.add(m);
  }
  const arms = new THREE.Group(); root.add(arms);
  const armL = spec ? attachArms(arms, spec) : null;
  let parts = {};
  const gun = spec ? wrapGun(root, spec, parts) : null;
  holder.add(root);
  const fxTarget = gun || dressGun({ group: root }); // 색 칸 재질 값 + 효과용 (총은 wrapGun 이 이미 입혔다, 근접 무기는 여기서)
  { // 스킨·색 칸 목록은 실제로 그려지는 (총마다 복제된) 재질. 팔은 빼고
    const inArms = o => { for (let p = o; p; p = p.parent) if (p === arms) return true; return false; };
    const used = new Set(); root.traverse(o => { if (o.isMesh && !o.userData.socket && !inArms(o)) for (const m of [].concat(o.material)) used.add(m); });
    scan.materials = [...used];
  }
  if (gun) attachClips(gun, root, gltf.animations, armL); // 모션 클립 (게임과 같은 코드로 재생)
  const model = { root, gun, spec, scan, checks, bytes: buffer.byteLength, buffer, name, arms };
  const hasFail = () => checks.some(c => c.level === 'fail');
  if (type === 'melee') { // 근접 무기: 파츠·정조준·총 크기 비교는 해당 없음
    for (const k of ['partSels', 'ghostSel']) { const el = r(k).parentElement; el.hidden = true; el.previousElementSibling.hidden = true; }
    tools.querySelector('[data-view="ads"]').disabled = true;
  }
  for (const c of checks) if (c.level === 'fail') ctx.log(`[${name}] ${c.text}`, 'error');

  // ───────── 보기 ─────────
  let view = 'orbit', palette = null, ghost = null;
  const holderBase = new THREE.Vector3(); // 1인칭·정조준의 총 위치 (모션의 총 기울임은 여기에 더한다)
  const showMarkers = () => root.traverse(o => { if (o.userData.socket) o.visible = view === 'orbit' && r('showSockets').checked; });
  function setView(v, refit) {
    const changed = v !== view || refit;
    view = v;
    for (const b of r('views').children) b.classList.toggle('on', b.dataset.view === v);
    holder.rotation.set(0, 0, 0);
    arms.visible = v !== 'orbit' && r('showArms').checked;
    adsDot.visible = v === 'ads';
    showMarkers();
    if (v === 'orbit') {
      controls.enabled = true; camera.fov = 35; holder.position.set(0, 0, 0);
      if (changed) {
        const box = new THREE.Box3(); for (const m of scan.meshes) box.expandByObject(m); // 팔·파츠는 빼고 총만
        const c = box.getCenter(new THREE.Vector3()), len = box.getSize(new THREE.Vector3()).length();
        controls.target.copy(c);
        camera.position.set(c.x + len * 1.25, c.y + len * 0.35, c.z + len * 0.35); // 총의 오른쪽 옆에서 (총구가 오른쪽)
      }
      r('vhint').textContent = '왼쪽 끌기 회전 · 오른쪽 끌기 이동 · 휠 확대';
    } else {
      controls.enabled = false; camera.fov = VM_FOV;
      camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
      if (type === 'melee') { // 근접 무기: 오른손으로 쥐고 날을 앞쪽 위로 (정조준은 없다)
        const h = scan.sockets.hand_r ? scan.sockets.hand_r.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
        holder.rotation.set(0.35, 0.25, -0.2); holder.position.set(0.2, -0.2, -0.36).sub(h.applyEuler(holder.rotation));
        r('vhint').textContent = v === 'ads' ? '근접 무기는 정조준이 없습니다 — 1인칭과 같은 모습' : '게임에서 들고 있을 때의 모습 (오른손으로 쥠, 시야각 같음)';
        camera.updateProjectionMatrix(); return;
      }
      if (gun) { if (v === 'hip') holder.position.fromArray(gun.hip); else holder.position.set(0, -gun.sightY, gun.adsZ); }
      holderBase.copy(holder.position);
      r('vhint').textContent = !gun ? '필수 부착 지점이 없어 1인칭으로 볼 수 없습니다'
        : v === 'hip' ? '게임에서 총을 들고 있을 때의 모습 (시야각 같음)' : '빨간 점 = 조준점. 가늠자·가늠쇠(또는 조준경의 점)가 여기에 겹쳐야 합니다';
    }
    camera.updateProjectionMatrix();
  }
  for (const b of r('views').children) b.addEventListener('click', () => setView(b.dataset.view));
  r('showArms').addEventListener('change', () => setView(view));
  r('showSockets').addEventListener('change', showMarkers);
  r('showWire').addEventListener('change', () => root.traverse(o => { if (o.isMesh && !o.userData.socket) for (const m of [].concat(o.material)) m.wireframe = r('showWire').checked; }));

  // 크기 비교: 지금 게임에 있는 (코드로 만든) 총을 반투명으로 겹쳐 본다. 오른손 위치를 맞춘다
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
  function setGhost(wid) {
    if (ghost) { holder.remove(ghost); ghost = null; }
    if (!wid || !spec) return;
    const g = buildGun(wid, false, {});
    g.group.traverse(o => { if (o.isMesh) o.material = ghostMat; });
    g.group.position.set(0, spec.gripY - (-0.085), spec.gripZ - g.gripZ);
    ghost = g.group; holder.add(ghost);
  }
  for (const w of WEAPONS) r('ghostSel').appendChild(new Option(`${w.name} (${w.cls})`, w.id));
  r('ghostSel').addEventListener('change', () => setGhost(r('ghostSel').value));

  // 파츠 달아 보기
  for (const s of PART_SLOTS) {
    const l = html('label', 'kv'); l.textContent = s.name;
    const sel = document.createElement('select'); sel.dataset.slot = s.id;
    sel.appendChild(new Option('없음', ''));
    for (const p of PART_LIST[s.id] || []) sel.appendChild(new Option(p.name, p.id));
    sel.addEventListener('change', () => {
      parts = {}; for (const x of r('partSels').querySelectorAll('select')) if (x.value) parts[x.dataset.slot] = x.value;
      if (gun) { setGunParts(gun, parts); setView(view); }
    });
    l.appendChild(sel); r('partSels').appendChild(l);
  }

  // 스킨
  for (const n of Object.keys(SKINS)) r('skinSel').appendChild(new Option(n, n));
  r('skinSel').appendChild(new Option('직접 고른 색', 'custom'));
  r('skinSel').addEventListener('change', () => {
    const v = r('skinSel').value;
    if (v !== 'custom') palette = SKINS[v] ? { ...SKINS[v] } : null;
    applySkin(root, palette); renderSlots();
  });
  function renderSlots() {
    const box = r('slotList'); box.replaceChildren();
    for (const slot of [...new Set(scan.materials.map(m => slotOf(m.name)))]) {
      const m = scan.materials.find(x => slotOf(x.name) === slot);
      const l = document.createElement('label');
      l.textContent = SLOTS[slot] ? `${slot} · ${SLOTS[slot]}` : `${slot} (색 칸 아님)`;
      const c = document.createElement('input'); c.type = 'color'; c.value = '#' + m.color.getHexString(); c.disabled = !SLOTS[slot];
      c.addEventListener('input', () => { palette = { ...(palette || {}), [slot]: c.value }; r('skinSel').value = 'custom'; applySkin(root, palette); });
      l.appendChild(c); box.appendChild(l);
    }
  }

  // ───────── 모션: 모델의 모션 클립을 게임과 같은 코드(gunanim.js)로 재생 · 멈춤 · 한 장면씩 ─────────
  const mo = { clip: null, f: 0, playing: false };
  (function motionPanel() {
    const box = r('motion'), clips = gun ? gun.clips : [];
    if (!clips.length) { box.appendChild(html('p', 'note', gun ? '모션 클립이 없습니다. Blender 에서 NLA 트랙 "reload" 로 만들어 내보내면 여기서 재생됩니다 (docs/GUN_MODELING.md 11)' : '총 모델에서만 재생할 수 있습니다')); return; }
    box.innerHTML = `<label class="kv">클립<select data-r="clipSel"></select></label>
      <div class="motionbar"><button type="button" data-r="play" title="재생 / 멈춤 (Space)">▶</button><input type="range" min="0" max="1" step="0.001" value="0" data-r="scrub" title="끌어서 한 장면씩"><span class="status" data-r="clipT">0.00초</span></div>
      <label class="kv" title="게임은 무기 데이터의 재장전 시간에 맞춰 늘이거나 줄인다">빠르기<select data-r="clipSpeed"><option value="clip">클립 그대로</option><option value="0.25">×0.25 (느리게)</option><option value="0.5">×0.5</option></select></label>
      <label class="tog" title="게임 1인칭처럼 재장전 때 총 전체를 기울이는 코드 동작도 같이 (1인칭·정조준 보기에서)"><input type="checkbox" data-r="clipTilt" checked> 총 기울임 (게임처럼)</label>
      <label class="tog"><input type="checkbox" data-r="clipLoop" checked> 반복</label>`;
    for (const c of clips) r('clipSel').appendChild(new Option(`${c.name} (${c.duration.toFixed(2)}초)`, c.name));
    for (const w of WEAPONS) r('clipSpeed').appendChild(new Option(`게임: ${w.name} 재장전 ${w.reload}초`, `w:${w.id}`));
    const linked = ctx.weapons().find(w => w.model === savedId); if (linked) r('clipSpeed').value = `w:${linked.id}`; // 이 모델을 쓰는 무기의 재장전 시간
    mo.clip = clips[0].name;
    r('clipSel').addEventListener('change', () => { mo.clip = r('clipSel').value; mo.f = 0; poseMotion(); });
    r('play').addEventListener('click', () => togglePlay());
    r('scrub').addEventListener('input', () => { mo.playing = false; r('play').textContent = '▶'; mo.f = Number(r('scrub').value); poseMotion(); });
    r('clipTilt').addEventListener('change', poseMotion);
  })();
  function togglePlay() {
    if (!mo.clip) return;
    mo.playing = !mo.playing; r('play').textContent = mo.playing ? '❚❚' : '▶';
    if (mo.playing && mo.f >= 1) mo.f = 0;
    poseMotion();
  }
  // 한 바퀴에 걸리는 시간 (초): 클립 그대로 · 느리게 · 게임의 재장전 시간
  function motionDuration() {
    const c = gun.clips.find(x => x.name === mo.clip), v = r('clipSpeed').value;
    if (v === 'clip') return c.duration;
    if (v.startsWith('w:')) { const w = WEAPONS.find(x => x.id === v.slice(2)); return w ? w.reload : c.duration; }
    return c.duration / Number(v);
  }
  function poseMotion() {
    if (!gun || !mo.clip) return;
    poseClip(gun, mo.clip, mo.f);
    arms.visible = r('showArms').checked && (view !== 'orbit' || mo.playing || mo.f > 0); // 살펴보기에서도 모션 중에는 팔(왼손이 따라가는 모습)
    const tilt = view !== 'orbit' && r('clipTilt').checked && mo.clip === 'reload' && (mo.playing || mo.f > 0);
    const m = tilt ? reloadMotion(mo.f) : null;
    if (view !== 'orbit') { holder.position.copy(holderBase); holder.rotation.set(0, 0, 0); if (m) { holder.position.add(new THREE.Vector3(m.x, m.y, m.z)); holder.rotation.set(m.rx, m.ry, m.rz); } }
    r('scrub').value = mo.f; r('clipT').textContent = `${(mo.f * motionDuration()).toFixed(2)}초`;
  }
  function stepMotion(dt) {
    if (!mo.playing) return;
    mo.f += dt / motionDuration();
    if (mo.f >= 1) { if (r('clipLoop').checked) mo.f %= 1; else { mo.f = 1; mo.playing = false; r('play').textContent = '▶'; } }
    poseMotion();
  }

  // ───────── 질감: 색 칸별 재질 값 (모든 총 공통, content/gunmaterials.json) · 정점 색 AO 비교 · 효과 미리 보기 ─────────
  let matSaved = JSON.stringify(gunMats());
  const fxNow = () => setGunFx(fxTarget, { heat: Number(r('fxHeat').value), charge: Number(r('fxCharge').value) });
  r('fxHeat').addEventListener('input', fxNow); r('fxCharge').addEventListener('input', fxNow);
  const setAo = () => root.traverse(o => { if (o.isMesh && o.geometry.attributes.color) for (const m of [].concat(o.material)) { m.vertexColors = r('showAo').checked; m.needsUpdate = true; } });
  r('showAo').addEventListener('change', setAo);
  const openGuns = () => [...ctx.docs().values()].filter(d => d.kind === 'gun' && d.api && d.api.fxTarget).map(d => d.api.fxTarget);
  // 엔진 질감 켜고 끄기 (Blender 원본과 비교) · 층 켜고 끄기 (모든 열린 총에)
  const setEngine = on => { r('engineMat').checked = on; useGunMaterials(fxTarget, on); setAo(); };
  r('engineMat').addEventListener('change', () => setEngine(r('engineMat').checked));
  for (const [id, k] of [['layGrain', 'grain'], ['layWear', 'wear'], ['layCoat', 'coat']]) r(id).addEventListener('change', () => { LAYERS[k] = r(id).checked; setGunMats(null, openGuns()); });
  // 조명: 질감은 빛에 따라 달라 보인다 → 몇 가지 환경에서 확인
  const LIGHTS = { studio: [0x4f7470, 0.5, 1.2, 2.2], game: [0x8fb3d6, 0.55, 1.0, 2.6], sun: [0xc9d7e2, 0.85, 1.4, 3.6], dark: [0x1b1f23, 0.22, 0.35, 1.1] };
  r('lightSel').addEventListener('change', () => { const [bg, env, h, su] = LIGHTS[r('lightSel').value]; scene.background.setHex(bg); scene.environmentIntensity = env; hemi.intensity = h; sun.intensity = su; });
  let close = false;
  r('closeUp').addEventListener('click', () => { // 가까이: 손잡이·몸통 쪽 (모서리 닳음과 결이 잘 보이는 거리)
    if (view !== 'orbit') setView('orbit');
    close = !close;
    const box = new THREE.Box3(); for (const m of scan.meshes) box.expandByObject(m);
    const c = box.getCenter(new THREE.Vector3()), len = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(c);
    camera.position.copy(c).add(close ? new THREE.Vector3(len * 0.55, len * 0.18, len * 0.3) : new THREE.Vector3(len * 1.25, len * 0.35, len * 0.35));
    r('closeUp').textContent = close ? '전체 보기' : '가까이 보기';
  });
  function renderMatTable() {
    const box = r('matTable'), d = gunMats(); box.replaceChildren();
    const COLS = [['metal', '금속', 1], ['rough', '거칠기', 1], ['coat', '코팅', 1], ['grain', '결', 2], ['wear', '닳음', 1]];
    const head = html('div', 'mrow mhead', `<span>색 칸</span>${COLS.map(([, l]) => `<span>${l}</span>`).join('')}`); box.appendChild(head);
    for (const slot of GUN_SLOTS) {
      const row = html('div', 'mrow'); row.appendChild(html('span', '', slot));
      for (const [k, , max] of COLS) {
        const i = document.createElement('input'); i.type = 'number'; i.step = 0.05; i.min = 0; i.max = max; i.value = d.slots[slot][k] ?? 0; i.dataset.slot = slot; i.dataset.k = k;
        i.addEventListener('input', () => {
          const v = Number(i.value); if (!Number.isFinite(v)) return;
          const next = JSON.parse(JSON.stringify(gunMats())); next.slots[slot][k] = v;
          if (checkGunMaterials(next).length) return;
          setGunMats(next, openGuns()); r('matSave').disabled = JSON.stringify(next) === matSaved;
        });
        row.appendChild(i);
      }
      box.appendChild(row);
    }
  }
  renderMatTable();
  r('matSave').addEventListener('click', async () => {
    const out = await saveContent('gunmaterials', gunMats());
    if (!out.ok) { ctx.log(`질감 저장 실패: ${(out.errors || []).join(' / ')}`, 'error'); ctx.flash('질감 저장 실패'); return; }
    matSaved = JSON.stringify(gunMats()); r('matSave').disabled = true;
    ctx.log('질감 저장: content/gunmaterials.json — 모든 총(게임 포함)에 적용됩니다', 'ok'); ctx.flash('질감을 저장했습니다');
  });

  // ───────── 속성: 검사 결과 / 부착 지점 ─────────
  (function renderChecks() {
    const box = r('checks');
    const fails = checks.filter(c => c.level === 'fail').length, warns = checks.filter(c => c.level === 'warn').length;
    box.appendChild(html('div', `sum ${fails ? 'bad' : 'good'}`)).textContent = fails ? `고쳐야 할 것 ${fails}개 — 저장할 수 없습니다` : warns ? `통과 (확인할 것 ${warns}개)` : '모두 통과';
    for (const c of checks) { const d = html('div', `ck ${c.level}`); d.appendChild(document.createElement('span')).textContent = c.text; box.appendChild(d); }
  })();
  (function renderSockets() {
    const box = r('socks');
    for (const [k, v] of Object.entries(SOCKETS)) {
      const have = scan.sockets[k], d = html('div', have ? '' : 'miss');
      const dot = document.createElement('i'); dot.style.background = hex(v.color);
      const p = have ? have.getWorldPosition(new THREE.Vector3()) : null;
      const t = document.createElement('span');
      t.innerHTML = `<b>socket_${k}</b>${v.required ? '' : ' (선택)'}<small>${v.label}${p ? ` · ${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}` : ' · 없음'}</small>`;
      d.append(dot, t); box.appendChild(d);
    }
  })();

  // 화면 위 지점 이름 (살펴보기에서만)
  const labelEls = new Map(), _p = new THREE.Vector3();
  function updateLabels() {
    const show = view === 'orbit' && r('showSockets').checked, b = canvas.getBoundingClientRect();
    for (const [k, o] of Object.entries(scan.sockets)) {
      let e = labelEls.get(k);
      if (!e) { e = document.createElement('span'); e.textContent = k; e.style.color = hex(SOCKETS[k] ? SOCKETS[k].color : 0xffffff); r('labels').appendChild(e); labelEls.set(k, e); }
      if (!show) { e.style.display = 'none'; continue; }
      o.getWorldPosition(_p).project(camera);
      e.style.left = `${(_p.x * 0.5 + 0.5) * b.width}px`; e.style.top = `${(-_p.y * 0.5 + 0.5) * b.height}px`;
      e.style.display = _p.z < 1 ? 'block' : 'none';
    }
  }

  // ───────── 저장 ─────────
  const doc = { kind: 'gun', modelType: type, key: savedId ? `gun:${savedId}` : null, id: savedId || id, title: savedId || name.replace(/\.glb$/i, ''), icon: '⌐', is3D: true, overlay, tools, toolbar, inspector };
  doc.onKeyDown = e => {
    if (e.metaKey || e.ctrlKey) return;
    if (e.code === 'KeyM') setEngine(!r('engineMat').checked); // M = 엔진 질감 켜고 끄기 (비교)
    else if (e.code === 'Space' && mo.clip) { e.preventDefault(); togglePlay(); } // Space = 모션 재생 / 멈춤
  };
  r('gunId').value = savedId || (id === 'sample' ? '' : name.replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  r('fname').textContent = savedId ? `content/guns/${savedId}.glb` : name;
  const idOk = () => /^[a-z0-9_]+$/.test(r('gunId').value);
  const updateSave = () => { r('save').disabled = hasFail() || !idOk(); };
  r('gunId').addEventListener('input', updateSave);
  updateSave();
  async function save() {
    if (hasFail()) { ctx.flash('검사에서 고쳐야 할 것이 있어 저장할 수 없습니다'); return false; }
    if (!idOk()) { ctx.flash('총 id 를 영문 소문자·숫자·_ 로 넣으세요'); r('gunId').focus(); return false; }
    const gid = r('gunId').value;
    const res = await fetch(`/api/guns/${gid}`, { method: 'PUT', headers: { 'Content-Type': 'model/gltf-binary' }, body: buffer });
    const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
    if (!out.ok) { ctx.flash('저장 실패'); ctx.log(`총 모델 저장 실패: ${(out.errors || []).join(' / ')}`, 'error'); return false; }
    savedId = gid; doc.title = gid; doc.id = gid; updateRegister();
    r('fname').textContent = `content/guns/${gid}.glb`;
    ctx.log(`저장: content/guns/${gid}.glb${out.isNew ? ' (새 총)' : ''} — 커밋해서 올리세요`, 'ok'); ctx.flash('저장했습니다');
    await ctx.refreshAssets(); ctx.rekey(doc, `gun:${gid}`);
    return true;
  }
  r('save').addEventListener('click', () => save());

  // ───────── 데이터로 등록 ─────────
  // 프로젝트에 저장했고 검사에 ✕ 가 없으면 등록할 수 있다. 확인 사항(!)이 남아 있으면 확인했다고 체크해야 한다.
  const regEntry = () => ctx.registry().find(m => m.id === savedId) || null;
  function updateRegister() {
    const e = regEntry();
    r('regState').textContent = e ? `등록됨${e.linkedTo ? ` · ${e.linkedTo}` : ''}` : savedId ? '등록 전' : '저장 전';
    r('regState').className = `pill ${e ? 'good' : ''}`;
    r('register').disabled = hasFail() || !savedId;
    r('register').textContent = e ? '등록 정보 바꾸기' : '데이터로 등록';
    r('register').title = !savedId ? '먼저 "프로젝트에 저장"' : hasFail() ? '검사에서 고쳐야 할 것(✕)이 있어 등록할 수 없다' : '검증을 통과한 모델을 게임 데이터로 등록 (무기에 연결)';
  }
  function openRegister() {
    const e = regEntry(), warns = checks.filter(c => c.level === 'warn');
    const tris = scan.meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
    const linked = ctx.weapons().find(w => w.model === savedId);
    const m = html('div', 'modal', `<div class="card" style="width:min(460px,92vw)"><header><b>데이터로 등록 — ${savedId}</b></header>
      <div style="padding:14px 18px;display:grid;gap:12px">
        <p class="note" style="margin:0">등록하면 <code>content/models.json</code> 에 올라가고, 게임 데이터(무기)가 이 모델을 쓸 수 있게 됩니다.</p>
        <label class="kv" style="grid-template-columns:90px 1fr">이름<input type="text" data-f="name"></label>
        <label class="kv" style="grid-template-columns:90px 1fr">종류<select data-f="kind" disabled><option value="gun">총</option><option value="melee">근접 무기</option><option value="prop" disabled>물체 (준비 중)</option></select></label>
        <label class="kv" style="grid-template-columns:90px 1fr">쓸 무기<select data-f="weapon"><option value="">(지금은 연결 안 함)</option></select></label>
        <div data-f="warn" ${warns.length ? '' : 'hidden'}><p class="note" style="color:var(--accent);margin:0 0 4px">확인 사항 ${warns.length}개가 남아 있습니다:</p>
          <ul class="note" style="margin:0 0 6px;padding-left:18px">${warns.map(w => `<li></li>`).join('')}</ul>
          <label class="tog"><input type="checkbox" data-f="ok"> 확인했고, 이대로 등록합니다</label></div>
      </div>
      <footer>${e ? '<button type="button" class="danger" data-f="unreg">등록 해제</button>' : ''}<span class="grow"></span><button type="button" data-f="cancel">취소</button><button type="button" class="primary" data-f="go">${e ? '바꾸기' : '등록'}</button></footer></div>`);
    const f = n => m.querySelector(`[data-f="${n}"]`);
    f('name').value = e ? e.name : savedId;
    for (const w of ctx.weapons()) f('weapon').appendChild(new Option(`${w.name} (${w.cls})${w.model && w.model !== savedId ? ' · 다른 모델 사용 중' : ''}`, w.id));
    f('weapon').value = linked ? linked.id : '';
    f('kind').value = type; // 종류는 모델 구조로 정해진다 (socket_tip = 근접 무기)
    if (type === 'melee') { f('weapon').disabled = true; f('weapon').options[0].text = '(근접 무기를 쓰는 무기가 아직 없음 — 근접 공격이 생기면 연결)'; f('weapon').value = ''; }
    m.querySelectorAll('[data-f="warn"] li').forEach((li, i) => { li.textContent = warns[i].text; });
    const gate = () => { f('go').disabled = !!warns.length && !f('ok').checked; };
    if (warns.length) f('ok').addEventListener('change', gate);
    gate();
    const close = () => m.remove();
    f('cancel').addEventListener('click', close);
    m.addEventListener('click', ev => { if (ev.target === m) close(); });
    f('go').addEventListener('click', async () => {
      const res = await fetch('/api/register/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: savedId, name: f('name').value.trim() || savedId, kind: type, weapon: type === 'gun' ? f('weapon').value || null : null, tris: Math.round(tris), warnings: warns.length }) });
      const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
      if (!out.ok) { ctx.log(`등록 실패: ${(out.errors || []).join(' / ')}`, 'error'); ctx.flash('등록 실패 — 콘솔을 보세요'); return; }
      close();
      ctx.log(`데이터로 등록: ${savedId}${out.linked ? ` → 무기 ${out.linked} 의 모델` : ' — 아직 어느 무기에도 연결 안 함 (데이터 에디터 → 무기 → "모델" 에서 고를 수 있습니다)'} (content/models.json)`, 'ok');
      ctx.flash(out.linked ? '데이터로 등록했습니다' : '등록했습니다 — 무기에 연결하려면 데이터 에디터 → 무기 → 모델');
      await ctx.refreshAssets(); updateRegister();
    });
    if (f('unreg')) f('unreg').addEventListener('click', async () => {
      if (!confirm(`${savedId} 의 등록을 해제할까요? 이 모델을 쓰던 무기는 코드로 만든 총으로 돌아갑니다.`)) return;
      const out = await (await fetch(`/api/register/model/${savedId}`, { method: 'DELETE' })).json().catch(() => ({ ok: false }));
      if (!out.ok) { ctx.log('등록 해제 실패', 'error'); return; }
      close(); ctx.log(`등록 해제: ${savedId}`, 'ok'); await ctx.refreshAssets(); updateRegister();
    });
    document.body.appendChild(m); f('name').focus();
  }
  r('register').addEventListener('click', openRegister);

  applySkin(root, palette); renderSlots(); setView('orbit', true); updateRegister();

  return Object.assign(doc, {
    activate() { controls.connect(); renderer.toneMappingExposure = 0.9; canvas.style.cursor = 'default'; updateRegister(); },
    deactivate() { controls.disconnect(); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    frame(dt = 1 / 60) {
      stepMotion(dt);
      if (view === 'orbit') { if (r('spin').checked) holder.rotation.y += 0.004; controls.update(); }
      updateLabels(); renderer.render(scene, camera);
    },
    isDirty: () => !savedId && id !== 'sample', // 파일로 연 모델은 프로젝트에 저장하기 전까지 "저장 안 됨"
    save,
    dispose() { controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    api: { get model() { return model; }, get view() { return view; }, setView, save, holder, camera, openRegister, fxTarget, motion: mo, togglePlay, poseMotion },
  });
}
