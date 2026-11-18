// 캐릭터 문서 (모델 에디터): 리깅된 캐릭터 .glb 를 규칙대로 검사하고, 뼈·웨이트·무기 쥐기·애니메이션을 미리 본다.
//   3인칭 전신(tp)과 1인칭 팔(fp, 뷰모델) 모두. 규칙은 client/js/charrules.js, 팔 IK 는 client/js/charik.js (나중에 게임도 같이 쓴다)
//   통과하면 content/characters/<id>.glb 로 저장한다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { checkCharacter, detectRig, bonesOf, RIGS } from '/js/charrules.js';
import { reachGrip, socketWorld, elbowPole } from '/js/charik.js';
import { gunSpec } from '/js/modelrules.js';
import { dressGun } from '/js/gunmat.js';
import { buildSoldier } from '/js/guns.js';
import { el, html } from '../util.js';

const VM_FOV = 52; // 게임의 1인칭 카메라 시야각
const LOWER = new Set(['Root', 'Hips', 'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToe', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToe']); // 하체 마스크
const DEG = Math.PI / 180;
const heat = (w, c) => { const t = Math.max(0, Math.min(1, w)); return c.setRGB(t < 0.5 ? 0 : (t - 0.5) * 2, t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2, t < 0.5 ? 1 - t * 2 : 0); }; // 파랑 → 초록 → 빨강

export async function createCharacterDoc(ctx, id, opts = {}) {
  const { canvas, renderer } = ctx;
  let buffer = opts.buffer, name = opts.name || '캐릭터.glb', savedId = null, gltf = opts.gltf;
  if (!buffer) {
    const res = await fetch(`/content/characters/${id}.glb`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`content/characters/${id}.glb 를 읽을 수 없음`);
    buffer = await res.arrayBuffer(); name = `${id}.glb`; savedId = id;
  }
  if (!gltf) gltf = await new GLTFLoader().parseAsync(buffer, '');

  // ───────── 모델 ─────────
  const root = new THREE.Group(); root.add(gltf.scene); root.updateMatrixWorld(true);
  const kind = detectRig(root), rig = RIGS[kind] || RIGS.tp;
  const bones = bonesOf(root);
  const skinned = []; root.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; } });
  const clips = [...gltf.animations];
  const checks = checkCharacter(root, { bytes: buffer.byteLength, clips });
  const hasFail = () => checks.some(c => c.level === 'fail');
  const rest = new Map([...bones].map(([n, b]) => [n, { q: b.quaternion.clone(), p: b.position.clone() }])); // 레스트 자세 (되돌리기용)
  const forward = new THREE.Vector3(0, 0, kind === 'fp' ? -1 : 1); // 캐릭터 정면

  // ───────── 화면 조각 ─────────
  const overlay = html('div', '', '<div class="labels" data-r="labels"></div><div class="vhint" data-r="vhint"></div>');
  const sec = (title, inner) => `<div class="tbx-h">${title}</div><div>${inner}</div>`;
  const tools = html('div', '', sec('보기', `<div class="seg" data-r="views"><button type="button" data-view="orbit" class="on" title="돌려 보기">살펴보기</button><button type="button" data-view="eye" title="${kind === 'fp' ? '게임 1인칭 카메라 그대로' : '캐릭터 눈높이에서 정면'}">${kind === 'fp' ? '1인칭' : '눈높이'}</button></div>`)
    + sec('표시', `<label class="tog"><input type="checkbox" data-r="showMesh" checked> 몸 (메시)</label><label class="tog"><input type="checkbox" data-r="showBones" checked> 뼈대</label>
      <label class="tog"><input type="checkbox" data-r="showSockets" checked> 부착 지점</label><label class="tog"><input type="checkbox" data-r="showWire"> 와이어프레임</label>
      <label class="tog" title="고른 뼈가 몸을 얼마나 움직이는지 (파랑 0 → 빨강 1)"><input type="checkbox" data-r="showWeights"> 웨이트 (고른 뼈)</label>
      ${kind === 'tp' ? '<label class="tog" title="지금 게임의 상자 병사와 크기 비교"><input type="checkbox" data-r="showGhost"> 게임 병사 비교</label>' : ''}`)
    + sec('뼈', '<input type="search" data-r="boneFind" placeholder="뼈 찾기 (예: Hand)"><div class="bonetree" data-r="boneTree"></div>')
    + sec('무기 쥐기', `<label class="kv">무기<select data-r="gunSel"><option value="">없음</option></select></label>
      <label class="kv">방식<select data-r="holdMode"><option value="hold">들기 (양손 IK)</option><option value="hand">손에 붙이기 (그립 그대로)</option></select></label>
      <label class="tog"><input type="checkbox" data-r="leftIK" checked> 왼손 IK (socket_hand_l)</label>
      <label class="kv" title="들기 자세의 무기 위치 (앞뒤)">앞<input type="range" min="-0.2" max="0.3" step="0.005" value="0" data-r="holdF"></label>
      <label class="kv" title="들기 자세의 무기 위치 (위아래)">높이<input type="range" min="-0.2" max="0.2" step="0.005" value="0" data-r="holdU"></label>
      <p class="note" data-r="holdNote"></p>`)
    + sec('애니메이션', `<div data-r="clipBox"></div><button type="button" data-r="loadAnim" title="같은 뼈대로 만든 애니메이션 .glb (클립만 있어도 된다)">애니메이션 불러오기</button><input type="file" accept=".glb" data-r="animFile" hidden>`)
    + '<p class="note">규칙: docs/CHARACTER_MODELING.md · 조작법은 ? (F1)</p>');
  for (const h of tools.querySelectorAll('.tbx-h')) h.addEventListener('click', () => h.classList.toggle('shut'));
  const toolbar = html('div', '', `<span class="grp"><span class="gl">파일</span><span class="status" data-r="fname"></span><span class="pill">${rig.label}</span></span><span class="grow"></span>
    <span class="grp"><button type="button" data-r="resetAll" title="모든 뼈를 레스트(T-포즈)로">레스트 자세</button></span>
    <span class="grp"><span class="gl">캐릭터 id</span><input type="text" data-r="charId" placeholder="예: base_body" size="14" title="영문 소문자·숫자·_ (content/characters/<id>.glb)">
    <button type="button" class="primary" data-r="save" title="검사를 통과하면 content/characters 에 저장 (⌘S)">프로젝트에 저장</button></span>`);
  const inspector = html('div', '', '<h2>규칙 검사</h2><div class="checks" data-r="checks"></div><h2 class="sub2">고른 뼈</h2><div data-r="boneInfo"></div><h2 class="sub2">부착 지점</h2><div class="socks" data-r="socks"></div>');
  const r = n => overlay.querySelector(`[data-r="${n}"]`) || tools.querySelector(`[data-r="${n}"]`) || toolbar.querySelector(`[data-r="${n}"]`) || inspector.querySelector(`[data-r="${n}"]`);

  // ───────── 3D ─────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3d4a52);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a4048, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2); sun.position.set(-2, 4, 3); scene.add(sun);
  if (kind === 'tp') {
    const grid = new THREE.GridHelper(6, 12, 0x000000, 0x000000); grid.material.opacity = 0.25; grid.material.transparent = true; scene.add(grid);
  }
  scene.add(root);
  const skel = new THREE.SkeletonHelper(root); skel.material.depthTest = false; skel.material.transparent = true; skel.renderOrder = 20; scene.add(skel);
  const ghost = kind === 'tp' ? buildSoldier({ uniform: 0x8899aa, vest: 0x99aabb }).root : null;
  if (ghost) { ghost.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.25; o.material.depthWrite = false; } }); ghost.rotation.y = Math.PI; ghost.position.x = 0; ghost.visible = false; scene.add(ghost); }
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas); controls.disconnect(); controls.enableDamping = true;
  const gizmo = new TransformControls(camera, canvas); gizmo.disconnect(); gizmo.setMode('rotate'); gizmo.setSpace('local'); gizmo.size = 0.6;
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', e => { controls.enabled = !e.value && view === 'orbit'; });
  gizmo.addEventListener('objectChange', () => renderBoneInfo());

  // 부착 지점 표시 (작은 공 + 이름)
  const socketMarks = [];
  for (const n of Object.keys(rig.sockets)) {
    const b = bones.get(n) || root.getObjectByName(n);
    if (!b) continue;
    const m = new THREE.Mesh(new THREE.SphereGeometry(kind === 'fp' ? 0.006 : 0.015, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb43a, depthTest: false, transparent: true }));
    m.renderOrder = 21; b.add(m); socketMarks.push([n, m]);
  }

  // ───────── 보기 ─────────
  let view = 'orbit';
  const box = new THREE.Box3(); for (const m of skinned) box.expandByObject(m);
  function frame() {
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(c);
    camera.position.copy(c).add(kind === 'fp' ? new THREE.Vector3(0.5, 0.25, 0.6).multiplyScalar(size) : new THREE.Vector3(0.55, 0.15, 0.95).multiplyScalar(size));
    controls.update();
  }
  function setView(v) {
    view = v;
    for (const b of r('views').children) b.classList.toggle('on', b.dataset.view === v);
    controls.enabled = v === 'orbit';
    if (v === 'orbit') { camera.fov = 40; frame(); r('vhint').textContent = '왼쪽 끌기 회전 · 오른쪽 끌기 이동 · 휠 확대 · 뼈를 클릭해 고르고 고리를 끌어 돌려 보기'; }
    else if (kind === 'fp') { camera.fov = VM_FOV; camera.position.set(0, 0, 0); camera.quaternion.identity(); r('vhint').textContent = '게임 1인칭 카메라 (원점 = 눈, 시야각 같음)'; }
    else {
      const head = bones.get('Head'); const p = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.62, 0);
      camera.fov = 70; camera.position.copy(p).addScaledVector(forward, 0.12); camera.lookAt(camera.position.clone().add(forward));
      r('vhint').textContent = '캐릭터 눈높이에서 정면 (무기 쥔 모습 확인)';
    }
    camera.updateProjectionMatrix();
  }
  for (const b of r('views').children) b.addEventListener('click', () => setView(b.dataset.view));
  r('showMesh').addEventListener('change', () => { for (const m of skinned) m.visible = r('showMesh').checked; });
  r('showBones').addEventListener('change', () => { skel.visible = r('showBones').checked; });
  r('showSockets').addEventListener('change', () => { for (const [, m] of socketMarks) m.visible = r('showSockets').checked; });
  r('showWire').addEventListener('change', () => { for (const m of skinned) for (const mt of [].concat(m.material)) mt.wireframe = r('showWire').checked; });
  if (ghost) r('showGhost').addEventListener('change', () => { ghost.visible = r('showGhost').checked; });

  // ───────── 뼈 고르기 · 돌려 보기 ─────────
  let selBone = null;
  const depthOf = b => { let d = 0; for (let p = b.parent; p && p.isBone; p = p.parent) d++; return d; };
  function renderBoneTree() {
    const box2 = r('boneTree'), q = r('boneFind').value.trim().toLowerCase(); box2.replaceChildren();
    for (const [n, b] of bones) {
      if (q && !n.toLowerCase().includes(q)) continue;
      const row = el('div', `bone${b === selBone ? ' on' : ''}${rig.sockets[n] ? ' sock' : ''}`, n); row.dataset.bone = n;
      row.style.paddingLeft = `${4 + (q ? 0 : depthOf(b) * 9)}px`;
      row.addEventListener('click', () => selectBone(b));
      box2.appendChild(row);
    }
  }
  r('boneFind').addEventListener('input', renderBoneTree);
  function selectBone(b) {
    selBone = b;
    if (b) gizmo.attach(b); else gizmo.detach();
    renderBoneTree(); renderBoneInfo(); paintWeights();
    const row = b && r('boneTree').querySelector(`[data-bone="${b.name}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function renderBoneInfo() {
    const box2 = r('boneInfo'); box2.replaceChildren();
    if (!selBone) { box2.appendChild(el('p', 'note', '뼈를 고르면(왼쪽 목록 또는 화면에서 클릭) 고리를 끌어 돌려 볼 수 있습니다. 몸이 자연스럽게 따라 휘는지(웨이트) 확인하는 용도 — 저장되지 않습니다.')); return; }
    box2.appendChild(el('p', '', `${selBone.name}${rig.sockets[selBone.name] ? ` — ${rig.sockets[selBone.name]}` : ''}`));
    const e = new THREE.Euler().setFromQuaternion(selBone.quaternion);
    for (const ax of ['x', 'y', 'z']) {
      const l = el('label', 'kv'); l.append(document.createTextNode(`회전 ${ax.toUpperCase()} (도)`));
      const i = document.createElement('input'); i.type = 'number'; i.step = 1; i.value = (e[ax] / DEG).toFixed(1);
      i.addEventListener('input', () => { const n = Number(i.value); if (!Number.isFinite(n)) return; const ee = new THREE.Euler().setFromQuaternion(selBone.quaternion); ee[ax] = n * DEG; selBone.quaternion.setFromEuler(ee); });
      l.appendChild(i); box2.appendChild(l);
    }
    const btns = el('div', 'btns'), back = el('button', '', '이 뼈 레스트로'); back.type = 'button';
    back.addEventListener('click', () => { resetBone(selBone.name); renderBoneInfo(); }); btns.appendChild(back); box2.appendChild(btns);
  }
  const resetBone = n => { const s = rest.get(n), b = bones.get(n); if (s && b) { b.quaternion.copy(s.q); b.position.copy(s.p); } };
  r('resetAll').addEventListener('click', () => { for (const n of bones.keys()) resetBone(n); stopClips(); renderBoneInfo(); });
  // 화면 클릭: 가장 가까운 관절 (12px 안)
  const _p = new THREE.Vector3();
  let downAt = null;
  const listeners = [
    ['pointerdown', e => { downAt = [e.clientX, e.clientY]; }],
    ['pointerup', e => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo.dragging || view !== 'orbit') { downAt = null; return; }
      downAt = null;
      const rect = canvas.getBoundingClientRect(); let best = null, bd = 14;
      for (const b of bones.values()) {
        b.getWorldPosition(_p).project(camera);
        if (_p.z > 1) continue;
        const d = Math.hypot((_p.x * 0.5 + 0.5) * rect.width - (e.clientX - rect.left), (-_p.y * 0.5 + 0.5) * rect.height - (e.clientY - rect.top));
        if (d < bd) { bd = d; best = b; }
      }
      selectBone(best);
    }],
  ];

  // ───────── 웨이트 보기 ─────────
  const weightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const origMat = new Map(skinned.map(m => [m, m.material]));
  function paintWeights() {
    const on = r('showWeights').checked && selBone;
    for (const m of skinned) {
      if (!on) { m.material = origMat.get(m); continue; }
      const bi = m.skeleton.bones.indexOf(selBone), g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      if (!g.userData.weightColor) g.userData.weightColor = new THREE.BufferAttribute(new Float32Array(si.count * 3), 3);
      const col = g.userData.weightColor, c = new THREE.Color();
      for (let i = 0; i < si.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
        heat(w, c); col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true; g.setAttribute('color', col); m.material = weightMat;
    }
  }
  r('showWeights').addEventListener('change', paintWeights);

  // ───────── 무기 쥐기 ─────────
  let gun = null, gunSpecV = null, lastHold = null;
  const gunIds = [...new Set([...(ctx.assets().guns || [])])];
  for (const g of gunIds) { const reg = ctx.registry().find(m => m.id === g); r('gunSel').appendChild(new Option(reg ? `${reg.name}${reg.kind === 'melee' ? ' (근접)' : ''}` : g, g)); }
  const gunLoader = new GLTFLoader();
  async function setGun(gid) {
    if (gun) { gun.removeFromParent(); gun = null; }
    for (const n of bones.keys()) if (/(Upper|Fore)Arm$|Hand$/.test(n)) resetBone(n);
    if (!gid) { r('holdNote').textContent = ''; return; }
    const g = await gunLoader.loadAsync(`/content/guns/${gid}.glb`).catch(() => null);
    if (!g) { ctx.log(`무기 모델을 읽을 수 없음: ${gid}`, 'error'); return; }
    const group = new THREE.Group(); group.add(g.scene); group.updateMatrixWorld(true);
    dressGun({ group });
    gun = group; gunSpecV = gunSpec(group);
    scene.add(gun); placeGun();
  }
  r('gunSel').addEventListener('change', () => setGun(r('gunSel').value));
  for (const k of ['holdMode', 'leftIK', 'holdF', 'holdU']) r(k).addEventListener('input', placeGun);
  // 무기 위치를 정하고 (들기 = 가슴 앞 / 1인칭 = 게임의 허리 위치, 손에 = 오른손 그립), 팔을 맞춘다. 매 프레임 (애니메이션 뒤)
  function placeGun() {
    if (!gun) return;
    const mode = r('holdMode').value, grip = bones.get(rig.grip.right), hr = gun.getObjectByName('socket_hand_r');
    const hrLocal = hr ? hr.position.clone() : new THREE.Vector3();
    if (mode === 'hand' && grip) { // 규칙 그대로: 무기의 socket_hand_r 이 그립에, 회전 없음
      if (gun.parent !== grip) grip.add(gun);
      gun.position.copy(hrLocal).negate(); gun.quaternion.identity();
    } else {
      if (gun.parent !== scene) scene.add(gun);
      const f = Number(r('holdF').value), u = Number(r('holdU').value);
      if (kind === 'fp') { // 게임 1인칭과 같은 자리 (총 원점 = hip)
        const hip = gunSpecV ? gunSpecV.hip : [0.19, -0.19, -0.42];
        gun.position.set(hip[0], hip[1] + u, hip[2] - f); gun.quaternion.identity();
      } else { // 3인칭: 가슴 앞, 총구가 정면(+Z)
        const chest = bones.get('Chest'); const c = chest ? chest.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.3, 0);
        gun.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const gripAt = c.add(new THREE.Vector3(-0.14, -0.08 + u, 0.34 + f)); // 오른손(캐릭터 기준 오른쪽 = −X) 가슴 앞
        gun.position.copy(gripAt).sub(hrLocal.clone().applyQuaternion(gun.quaternion));
      }
      const rw = socketWorld(gun, 'socket_hand_r');
      if (rw) reachGrip('Right', bones, rig.grip.right, rw, elbowPole(bones, 'Right', forward));
    }
    let res = null;
    if (r('leftIK').checked) {
      const lw = socketWorld(gun, 'socket_hand_l'), back = new THREE.Vector3(0, 0, 1).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion())); // 총열을 따라 개머리판 쪽
      if (lw) res = reachGrip('Left', bones, rig.grip.left, lw, elbowPole(bones, 'Left', forward), back);
    }
    lastHold = res;
    r('holdNote').textContent = !gun.getObjectByName('socket_hand_r') ? 'socket_hand_r 가 없는 무기'
      : res && res.slid > 0.005 ? `왼손이 socket_hand_l 에 닿지 않아 총열을 따라 ${(res.slid * 100).toFixed(0)}cm 뒤에 쥡니다 — 총의 socket_hand_l 을 뒤로 옮기거나, 총·팔 크기를 맞춰 보세요` : '';
  }

  // ───────── 애니메이션 ─────────
  const mixer = new THREE.AnimationMixer(root);
  let actions = [], playing = false, t = 0, speed = 1, loop = true;
  const masked = (clip, keepLower) => new THREE.AnimationClip(`${clip.name}${keepLower ? '·하체' : '·상체'}`, clip.duration, clip.tracks.filter(tr => LOWER.has(tr.name.split('.')[0]) === keepLower));
  function renderClips() {
    const box2 = r('clipBox'); box2.replaceChildren();
    if (!clips.length) { box2.appendChild(el('p', 'note', `클립이 없습니다. Blender 에서 NLA 트랙(이름 ${rig.clipPrefix}<동작>)으로 내보내거나, 애니메이션만 담은 .glb 를 불러오세요.`)); return; }
    box2.innerHTML = `<label class="kv">클립<select data-r="clipA"></select></label>
      <label class="kv" title="상체만 이 클립으로 덧씌운다 (하체는 위 클립)">상체 덧씌우기<select data-r="clipB"><option value="">없음</option></select></label>
      <div class="motionbar"><button type="button" data-r="cPlay" title="재생 / 멈춤 (Space)">▶</button><input type="range" min="0" max="1" step="0.001" value="0" data-r="cScrub"><span class="status" data-r="cTime">0.00초</span></div>
      <label class="kv">빠르기<select data-r="cSpeed"><option value="1">×1</option><option value="0.5">×0.5</option><option value="0.25">×0.25</option></select></label>
      <label class="tog"><input type="checkbox" data-r="cLoop" checked> 반복</label>`;
    for (const c of clips) { box2.querySelector('[data-r="clipA"]').appendChild(new Option(`${c.name} (${c.duration.toFixed(2)}초)`, c.name)); box2.querySelector('[data-r="clipB"]').appendChild(new Option(c.name, c.name)); }
    const q = n => box2.querySelector(`[data-r="${n}"]`);
    q('clipA').addEventListener('change', setupClips); q('clipB').addEventListener('change', setupClips);
    q('cPlay').addEventListener('click', togglePlay);
    q('cScrub').addEventListener('input', () => { playing = false; q('cPlay').textContent = '▶'; t = Number(q('cScrub').value) * clipLen(); poseAt(t); });
    q('cSpeed').addEventListener('change', () => { speed = Number(q('cSpeed').value); });
    q('cLoop').addEventListener('change', () => { loop = q('cLoop').checked; });
    setupClips();
  }
  const clipLen = () => Math.max(0.01, ...actions.map(a => a.getClip().duration));
  function setupClips() {
    mixer.stopAllAction(); actions = [];
    const a = clips.find(c => c.name === r('clipA')?.value), b = clips.find(c => c.name === r('clipB')?.value);
    if (!a) return;
    const list = b ? [masked(a, true), masked(b, false)] : [a];
    actions = list.map(c => { const x = mixer.clipAction(c); x.play(); x.paused = true; return x; });
    t = 0; poseAt(0);
  }
  function poseAt(time) {
    for (const a of actions) a.time = Math.min(time, a.getClip().duration);
    mixer.update(0);
    const s = r('cScrub'); if (s) s.value = time / clipLen();
    const tt = r('cTime'); if (tt) tt.textContent = `${time.toFixed(2)}초`;
  }
  function togglePlay() { if (!actions.length) return; playing = !playing; r('cPlay').textContent = playing ? '❚❚' : '▶'; }
  function stopClips() { playing = false; if (r('cPlay')) r('cPlay').textContent = '▶'; mixer.stopAllAction(); actions = []; if (clips.length) setupClips(); }
  renderClips();
  r('loadAnim').addEventListener('click', () => r('animFile').click());
  r('animFile').addEventListener('change', async () => {
    const f = r('animFile').files[0]; r('animFile').value = '';
    if (!f) return;
    try {
      const g = await new GLTFLoader().parseAsync(await f.arrayBuffer(), '');
      const added = g.animations.filter(c => !clips.some(x => x.name === c.name));
      if (!added.length) { ctx.flash('새 클립이 없습니다'); return; }
      clips.push(...added);
      const more = checkCharacter(root, { clips: added }).filter(c => /클립/.test(c.text));
      for (const c of more) ctx.log(`[${f.name}] ${c.text}`, c.level === 'ok' ? 'info' : 'warn');
      renderClips(); ctx.log(`애니메이션 ${added.length}개 불러옴: ${added.map(c => c.name).join(', ')} (${f.name})`, 'ok');
    } catch (e) { ctx.log(`애니메이션을 읽을 수 없음: ${e.message}`, 'error'); }
  });

  // ───────── 속성: 검사 · 부착 지점 ─────────
  (function renderChecks() {
    const b = r('checks'), fails = checks.filter(c => c.level === 'fail').length, warns = checks.filter(c => c.level === 'warn').length;
    b.appendChild(html('div', `sum ${fails ? 'bad' : 'good'}`)).textContent = fails ? `고쳐야 할 것 ${fails}개 — 저장할 수 없습니다` : warns ? `통과 (확인할 것 ${warns}개)` : '모두 통과';
    for (const c of checks) { const d = html('div', `ck ${c.level}`); d.appendChild(document.createElement('span')).textContent = c.text; b.appendChild(d); }
  })();
  (function renderSockets() {
    const b = r('socks');
    for (const [n, label] of Object.entries(rig.sockets)) {
      const have = bones.get(n) || root.getObjectByName(n), d = html('div', have ? '' : 'miss');
      const dot = document.createElement('i'); dot.style.background = '#ffb43a';
      const tx = document.createElement('span'); tx.innerHTML = `<b></b><small></small>`; tx.querySelector('b').textContent = n; tx.querySelector('small').textContent = `${label}${have ? '' : ' · 없음'}`;
      d.append(dot, tx); if (have) d.addEventListener('click', () => selectBone(bones.get(n) || null)); b.appendChild(d);
    }
  })();

  // ───────── 저장 ─────────
  r('fname').textContent = savedId ? `content/characters/${savedId}.glb` : name;
  r('charId').value = savedId || name.replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const idOk = () => /^[a-z0-9_]+$/.test(r('charId').value);
  const updateSave = () => { r('save').disabled = hasFail() || !idOk(); };
  r('charId').addEventListener('input', updateSave); updateSave();
  async function save() {
    if (hasFail()) { ctx.flash('검사에서 고쳐야 할 것이 있어 저장할 수 없습니다'); return false; }
    if (!idOk()) { ctx.flash('캐릭터 id 를 영문 소문자·숫자·_ 로 넣으세요'); return false; }
    const cid = r('charId').value;
    const res = await fetch(`/api/characters/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'model/gltf-binary' }, body: buffer });
    const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
    if (!out.ok) { ctx.flash('저장 실패'); ctx.log(`캐릭터 저장 실패: ${(out.errors || []).join(' / ')}`, 'error'); return false; }
    savedId = cid; doc.title = cid; r('fname').textContent = `content/characters/${cid}.glb`;
    ctx.log(`저장: content/characters/${cid}.glb${out.isNew ? ' (새 캐릭터)' : ''} — 커밋해서 올리세요`, 'ok'); ctx.flash('저장했습니다');
    await ctx.refreshAssets(); ctx.rekey(doc, `char:${cid}`);
    return true;
  }
  r('save').addEventListener('click', () => save());

  for (const c of checks) if (c.level === 'fail') ctx.log(`[${name}] ${c.text}`, 'error');
  renderBoneTree(); renderBoneInfo(); setView('orbit');

  const labelBox = r('labels');
  const doc = {
    kind: 'character', editor: 'model', key: savedId ? `char:${savedId}` : null, id: savedId || id, title: savedId || name.replace(/\.glb$/i, ''), icon: '♙', is3D: true, overlay, tools, toolbar, inspector,
    activate() { controls.connect(); gizmo.connect(); for (const [tp, fn] of listeners) canvas.addEventListener(tp, fn); renderer.toneMappingExposure = 0.9; canvas.style.cursor = 'default'; },
    deactivate() { controls.disconnect(); gizmo.disconnect(); for (const [tp, fn] of listeners) canvas.removeEventListener(tp, fn); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    frame(dt = 1 / 60) {
      if (playing && actions.length) {
        t += dt * speed;
        if (t >= clipLen()) { if (loop) t %= clipLen(); else { t = clipLen(); playing = false; r('cPlay').textContent = '▶'; } }
        poseAt(t);
      }
      placeGun(); // 애니메이션 뒤에 팔 IK
      if (view === 'orbit') controls.update();
      // 부착 지점 이름 (살펴보기에서만)
      labelBox.replaceChildren();
      if (view === 'orbit' && r('showSockets').checked) {
        const rect = canvas.getBoundingClientRect();
        for (const [n, m] of socketMarks) {
          m.getWorldPosition(_p).project(camera); if (_p.z > 1) continue;
          const s = el('span', '', n); s.style.left = `${(_p.x * 0.5 + 0.5) * rect.width}px`; s.style.top = `${(-_p.y * 0.5 + 0.5) * rect.height}px`; s.style.display = 'block'; s.style.color = '#ffb43a'; labelBox.appendChild(s);
        }
      }
      renderer.render(scene, camera);
    },
    isDirty: () => !savedId,
    save,
    onKeyDown(e) {
      if (e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space' && actions.length) { e.preventDefault(); togglePlay(); }
      else if (e.code === 'Escape') selectBone(null);
      else if (e.code === 'KeyF') frame();
    },
    dispose() { controls.dispose(); gizmo.dispose(); mixer.stopAllAction(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    api: { kind, rig, root, bones, clips, checks, get gun() { return gun; }, get hold() { return lastHold; }, setGun, selectBone, get selBone() { return selBone; }, setView, placeGun, poseAt, setupClips, togglePlay, paintWeights, addClips: list => { clips.push(...list); renderClips(); } },
  };
  return doc;
}
