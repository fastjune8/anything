// FRONTIER 총기 뷰어: Blender 에서 내보낸 .glb 를 열어 규칙(docs/GUN_MODELING.md)대로 만들어졌는지 검사하고,
// 게임과 같은 코드로 1인칭·정조준·파츠·스킨을 미리 본다. 통과하면 content/guns/<id>.glb 로 저장한다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS } from '/shared/weapons.js';
import { SLOTS as PART_SLOTS, PARTS as PART_LIST } from '/shared/parts.js';
import { buildGun, wrapGun, setGunParts, attachArms } from '/js/guns.js';
import { SOCKETS, SLOTS, SKINS, scanModel, gunSpec, checkModel, applySkin, slotOf } from '/js/gunmodel.js';
import { sampleGunGlb } from './samplegun.js';

const $ = id => document.getElementById(id);
const VM_FOV = 52; // 게임의 1인칭 총 카메라와 같은 시야각

// ───────── 3D ─────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4f7470);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a4a48, 1.2));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2); sun.position.set(-2, 3, 1.5); scene.add(sun);
const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const holder = new THREE.Group(); scene.add(holder); // 보기 방식에 따라 옮겨지는 총 자리
const adsDot = new THREE.Mesh(new THREE.SphereGeometry(0.0006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020, depthTest: false }));
adsDot.position.set(0, 0, -0.1); adsDot.renderOrder = 20; camera.add(adsDot); scene.add(camera);

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ───────── 상태 ─────────
let model = null;   // { root, gun, spec, scan, bytes, buffer, name, arms, markers }
let view = 'orbit';
let parts = {};
let ghost = null;
let palette = null; // 지금 스킨 (null = 원래 색)

const sockMat = k => new THREE.MeshBasicMaterial({ color: SOCKETS[k] ? SOCKETS[k].color : 0xffffff, depthTest: false, transparent: true });

// ───────── 불러오기 ─────────
const loader = new GLTFLoader();
async function loadBuffer(buffer, name) {
  const gltf = await loader.parseAsync(buffer, '');
  if (model) holder.remove(model.root);
  const root = new THREE.Group(); root.add(gltf.scene); // 원점·방향 그대로 (Blender 원점 = 총의 원점)
  root.updateMatrixWorld(true);
  const scan = scanModel(root);
  const checks = checkModel(root, { bytes: buffer.byteLength }, scan);
  const spec = gunSpec(root, scan);
  for (const [k, o] of Object.entries(scan.sockets)) { // 부착 지점 표시: 지점에 붙여 두면 총과 같이 움직인다
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), sockMat(k)); m.renderOrder = 10; m.userData.socket = k;
    o.add(m);
  }
  const arms = new THREE.Group(); root.add(arms);
  if (spec) attachArms(arms, spec);
  const gun = spec ? wrapGun(root, spec, parts) : null;
  holder.add(root);
  model = { root, gun, spec, scan, checks, bytes: buffer.byteLength, buffer, name, arms };
  applySkin(root, palette);
  $('fileName').textContent = name;
  $('drop').classList.add('loaded');
  renderChecks(); renderSockets(); renderSlots(); setGhost($('ghostSel').value); setWire($('showWire').checked);
  setView(view, true);
  const id = name.replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!$('gunId').value) $('gunId').value = id;
  updateSaveButton();
}
async function openFile(file) {
  if (!file) return;
  try { await loadBuffer(await file.arrayBuffer(), file.name); }
  catch (e) { flash(`열 수 없는 파일입니다: ${e.message || e}`); }
}
async function openSaved(id) {
  if (!id) return;
  const res = await fetch(`/content/guns/${id}.glb`, { cache: 'no-store' });
  if (!res.ok) { flash('파일을 찾을 수 없습니다'); return; }
  $('gunId').value = id;
  await loadBuffer(await res.arrayBuffer(), `${id}.glb`);
}

// ───────── 보기 ─────────
function setView(v, refit) {
  const changed = v !== view || refit;
  view = v;
  for (const b of $('views').children) b.classList.toggle('on', b.dataset.view === v);
  const g = model && model.gun;
  holder.rotation.set(0, 0, 0);
  if (model) model.arms.visible = v !== 'orbit' && $('showArms').checked;
  adsDot.visible = v === 'ads';
  showMarkers();
  if (v === 'orbit') {
    controls.enabled = true; camera.fov = 35; holder.position.set(0, 0, 0);
    if (changed && model) {
      const box = new THREE.Box3(); for (const m of model.scan.meshes) box.expandByObject(m); // 팔·파츠는 빼고 총만
      const c = box.getCenter(new THREE.Vector3()), len = box.getSize(new THREE.Vector3()).length();
      controls.target.copy(c);
      camera.position.set(c.x + len * 1.25, c.y + len * 0.35, c.z + len * 0.35); // 총의 오른쪽 옆에서 (참고 이미지처럼 총구가 오른쪽)
    }
    $('viewHint').textContent = '왼쪽 끌기 회전 · 오른쪽 끌기 이동 · 휠 확대';
  } else {
    controls.enabled = false; camera.fov = VM_FOV;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    if (g) { if (v === 'hip') holder.position.fromArray(g.hip); else holder.position.set(0, -g.sightY, g.adsZ); }
    $('viewHint').textContent = v === 'hip' ? '게임에서 총을 들고 있을 때의 모습 (시야각 같음)'
      : '빨간 점 = 조준점. 가늠자·가늠쇠(또는 조준경의 점)가 여기에 겹쳐야 합니다';
    if (!g) $('viewHint').textContent = '필수 부착 지점이 없어 1인칭으로 볼 수 없습니다';
  }
  camera.updateProjectionMatrix();
}
for (const b of $('views').children) b.addEventListener('click', () => setView(b.dataset.view));
$('showArms').addEventListener('change', () => setView(view));
// 부착 지점 표시는 살펴보기에서만 (1인칭에서는 눈앞을 가린다)
const showMarkers = () => { if (model) model.root.traverse(o => { if (o.userData.socket) o.visible = view === 'orbit' && $('showSockets').checked; }); };
$('showSockets').addEventListener('change', showMarkers);
function setWire(on) { if (model) model.root.traverse(o => { if (o.isMesh && !o.userData.socket) for (const m of [].concat(o.material)) m.wireframe = on; }); }
$('showWire').addEventListener('change', () => setWire($('showWire').checked));

// 크기 비교: 지금 게임에 있는 (코드로 만든) 총을 반투명으로 겹쳐 본다. 오른손 위치를 맞춘다
const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
function setGhost(id) {
  if (ghost) { holder.remove(ghost); ghost = null; }
  if (!id || !model || !model.spec) return;
  const g = buildGun(id, false, {});
  g.group.traverse(o => { if (o.isMesh) o.material = ghostMat; });
  g.group.position.set(0, model.spec.gripY - (-0.085), model.spec.gripZ - g.gripZ);
  ghost = g.group; holder.add(ghost);
}
for (const w of WEAPONS) $('ghostSel').appendChild(new Option(`${w.name} (${w.cls})`, w.id));
$('ghostSel').addEventListener('change', () => setGhost($('ghostSel').value));

// 파츠 달아 보기 (모든 파츠를 고를 수 있다: 이 총에 어떤 파츠를 허용할지는 content/parts.json 에서 정한다)
for (const s of PART_SLOTS) {
  const l = document.createElement('label'); l.textContent = s.name;
  const sel = document.createElement('select'); sel.dataset.slot = s.id;
  sel.appendChild(new Option('없음', ''));
  for (const p of PART_LIST[s.id] || []) sel.appendChild(new Option(p.name, p.id));
  sel.addEventListener('change', () => {
    parts = {}; for (const x of document.querySelectorAll('#partSels select')) if (x.value) parts[x.dataset.slot] = x.value;
    if (model && model.gun) { setGunParts(model.gun, parts); setView(view); }
  });
  l.appendChild(sel); $('partSels').appendChild(l);
}

// 스킨
for (const name of Object.keys(SKINS)) $('skinSel').appendChild(new Option(name, name));
$('skinSel').appendChild(new Option('직접 고른 색', 'custom'));
$('skinSel').addEventListener('change', () => {
  const v = $('skinSel').value;
  if (v !== 'custom') palette = SKINS[v] ? { ...SKINS[v] } : null;
  if (model) applySkin(model.root, palette);
  renderSlots();
});
function renderSlots() {
  const box = $('slotList'); box.replaceChildren();
  if (!model) return;
  const used = [...new Set(model.scan.materials.map(m => slotOf(m.name)))];
  for (const slot of used) {
    const m = model.scan.materials.find(x => slotOf(x.name) === slot);
    const l = document.createElement('label');
    l.textContent = SLOTS[slot] ? `${slot} · ${SLOTS[slot]}` : `${slot} (색 칸 아님)`;
    const c = document.createElement('input'); c.type = 'color'; c.value = '#' + m.color.getHexString();
    c.disabled = !SLOTS[slot];
    c.addEventListener('input', () => {
      palette = { ...(palette || {}), [slot]: c.value }; $('skinSel').value = 'custom';
      applySkin(model.root, palette);
    });
    l.appendChild(c); box.appendChild(l);
  }
}

// ───────── 검사 결과 / 부착 지점 목록 ─────────
const hasFail = () => !model || model.checks.some(c => c.level === 'fail');
function renderChecks() {
  const box = $('checks'); box.replaceChildren();
  const fails = model.checks.filter(c => c.level === 'fail').length, warns = model.checks.filter(c => c.level === 'warn').length;
  const sum = document.createElement('div');
  sum.className = `sum ${fails ? 'bad' : 'good'}`;
  sum.textContent = fails ? `고쳐야 할 것 ${fails}개 — 저장할 수 없습니다` : warns ? `통과 (확인할 것 ${warns}개)` : '모두 통과';
  box.appendChild(sum);
  for (const c of model.checks) { // 앞 칸(✓ ! ✕)은 CSS 가 그린다
    const d = document.createElement('div'); d.className = `ck ${c.level}`;
    d.appendChild(Object.assign(document.createElement('span'), { textContent: c.text }));
    box.appendChild(d);
  }
}
function renderSockets() {
  const box = $('socketList'); box.replaceChildren();
  for (const [k, v] of Object.entries(SOCKETS)) {
    const have = model && model.scan.sockets[k];
    const d = document.createElement('div'); if (!have) d.className = 'miss';
    const dot = document.createElement('i'); dot.style.background = '#' + v.color.toString(16).padStart(6, '0');
    const t = document.createElement('span');
    const p = have ? have.getWorldPosition(new THREE.Vector3()) : null;
    t.innerHTML = `<b>socket_${k}</b>${v.required ? '' : ' (선택)'}<small>${v.label}${p ? ` · ${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}` : ' · 없음'}</small>`;
    d.append(dot, t); box.appendChild(d);
  }
}

// 화면 위 지점 이름 (살펴보기 보기에서만)
const labelEls = new Map();
const _p = new THREE.Vector3();
function updateLabels() {
  const show = model && view === 'orbit' && $('showSockets').checked;
  const r = canvas.getBoundingClientRect();
  const seen = new Set();
  if (show) for (const [k, o] of Object.entries(model.scan.sockets)) {
    let el = labelEls.get(k);
    if (!el) { el = document.createElement('span'); el.textContent = k; el.style.color = '#' + (SOCKETS[k] ? SOCKETS[k].color : 0xffffff).toString(16).padStart(6, '0'); $('labels').appendChild(el); labelEls.set(k, el); }
    o.getWorldPosition(_p).project(camera);
    el.style.left = `${(_p.x * 0.5 + 0.5) * r.width}px`; el.style.top = `${(-_p.y * 0.5 + 0.5) * r.height}px`;
    el.style.display = _p.z < 1 ? 'block' : 'none';
    seen.add(k);
  }
  for (const [k, el] of labelEls) if (!seen.has(k)) el.style.display = 'none';
}

// ───────── 저장 ─────────
const idOk = () => /^[a-z0-9_]+$/.test($('gunId').value);
function updateSaveButton() { $('saveGun').disabled = hasFail() || !idOk(); }
$('gunId').addEventListener('input', updateSaveButton);
async function saveGun() {
  if (hasFail() || !idOk()) return false;
  const id = $('gunId').value;
  const res = await fetch(`/api/guns/${id}`, { method: 'PUT', headers: { 'Content-Type': 'model/gltf-binary' }, body: model.buffer });
  const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
  if (!out.ok) { flash('저장 실패: ' + (out.errors || []).join(' / ')); return false; }
  flash(`content/guns/${id}.glb 에 저장했습니다${out.isNew ? ' (새 총)' : ''} — 커밋해서 올리세요`);
  await loadSavedList(); $('savedSel').value = id;
  return true;
}
$('saveGun').addEventListener('click', saveGun);

async function loadSavedList() {
  const list = await fetch('/content/guns/index.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  const sel = $('savedSel');
  sel.replaceChildren(new Option(list.length ? '저장된 총 열기…' : '저장된 총 없음', ''), ...list.map(id => new Option(id, id)));
}
$('savedSel').addEventListener('change', () => openSaved($('savedSel').value));

// ───────── 파일 열기 / 끌어다 놓기 ─────────
$('openFile').addEventListener('click', () => $('fileIn').click());
async function loadSample() { $('gunId').value = ''; await loadBuffer(await sampleGunGlb(), '예시 총 (규칙대로 만든 것).glb'); $('gunId').value = ''; updateSaveButton(); }
$('sample').addEventListener('click', loadSample);
$('fileIn').addEventListener('change', () => openFile($('fileIn').files[0]));
const stage = $('stage');
stage.addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
stage.addEventListener('dragleave', () => $('drop').classList.remove('over'));
stage.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('over'); openFile(e.dataTransfer.files[0]); });

let flashT = 0;
function flash(text) { const f = $('flash'); f.textContent = text; f.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { f.hidden = true; }, 3500); }

// ───────── 시작 ─────────
resize();
camera.position.set(-1, 0.3, 0.3); controls.target.set(0, 0, -0.2);
await loadSavedList();
const want = new URLSearchParams(location.search).get('gun');
if (want) await openSaved(want);

renderer.setAnimationLoop(() => {
  if (view === 'orbit') { if ($('spin').checked) holder.rotation.y += 0.004; controls.update(); }
  updateLabels();
  renderer.render(scene, camera);
});

// 자동 테스트용
window.__gv = { loadBuffer, loadSample, saveGun, setView, get model() { return model; }, get view() { return view; }, holder, camera };
