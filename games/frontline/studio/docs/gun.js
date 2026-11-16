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
import { SOCKETS, SLOTS, SKINS, scanModel, gunSpec, checkModel, applySkin, slotOf } from '/js/gunmodel.js';
import { sampleGunGlb } from '../samplegun.js';

const VM_FOV = 52; // 게임의 1인칭 총 카메라와 같은 시야각
const hex = n => '#' + n.toString(16).padStart(6, '0');
function html(tag, cls, inner) { const e = document.createElement(tag); if (cls) e.className = cls; if (inner) e.innerHTML = inner; return e; }
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
  const tools = html('div', '', `<h3 class="sub">보기</h3>
    <div class="seg" data-r="views"><button type="button" data-view="orbit" class="on">살펴보기</button><button type="button" data-view="hip">1인칭</button><button type="button" data-view="ads">정조준</button></div>
    <h3 class="sub">표시</h3>
    <label class="tog"><input type="checkbox" data-r="showSockets" checked> 부착 지점</label>
    <label class="tog"><input type="checkbox" data-r="showWire"> 와이어프레임</label>
    <label class="tog"><input type="checkbox" data-r="showArms" checked> 팔 (1인칭)</label>
    <label class="tog"><input type="checkbox" data-r="spin"> 천천히 돌리기</label>
    <h3 class="sub">크기 비교 (지금 게임의 총)</h3><select data-r="ghostSel"><option value="">없음</option></select>
    <h3 class="sub">파츠 달아 보기</h3><div data-r="partSels"></div>
    <h3 class="sub">스킨 (색 칸)</h3><select data-r="skinSel"></select><div class="slots" data-r="slotList"></div>
    <p class="note">규칙: docs/GUN_MODELING.md · Blender 템플릿: tools/blender/</p>`);
  const toolbar = html('div', '', `<span class="status" data-r="fname"></span>
    <input type="text" data-r="gunId" placeholder="총 id (예: vk12)" size="14" title="영문 소문자·숫자·_ (content/guns/<id>.glb)">
    <button type="button" class="primary" data-r="save" title="검사를 통과하면 프로젝트(content/guns)에 저장 (⌘S)">프로젝트에 저장</button>`);
  const inspector = html('div', '', '<h2>규칙 검사</h2><div class="checks" data-r="checks"></div><h2 class="sub2">부착 지점</h2><div class="socks" data-r="socks"></div>');
  const r = n => overlay.querySelector(`[data-r="${n}"]`) || tools.querySelector(`[data-r="${n}"]`) || toolbar.querySelector(`[data-r="${n}"]`) || inspector.querySelector(`[data-r="${n}"]`);

  // ───────── 3D ─────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4f7470);
  if (!envTex) envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex; scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a4a48, 1.2));
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
  const checks = checkModel(root, { bytes: buffer.byteLength }, scan);
  const spec = gunSpec(root, scan);
  for (const [k, o] of Object.entries(scan.sockets)) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshBasicMaterial({ color: SOCKETS[k] ? SOCKETS[k].color : 0xffffff, depthTest: false, transparent: true }));
    m.renderOrder = 10; m.userData.socket = k; o.add(m);
  }
  const arms = new THREE.Group(); root.add(arms);
  if (spec) attachArms(arms, spec);
  let parts = {};
  const gun = spec ? wrapGun(root, spec, parts) : null;
  holder.add(root);
  const model = { root, gun, spec, scan, checks, bytes: buffer.byteLength, buffer, name, arms };
  const hasFail = () => checks.some(c => c.level === 'fail');
  for (const c of checks) if (c.level === 'fail') ctx.log(`[${name}] ${c.text}`, 'error');

  // ───────── 보기 ─────────
  let view = 'orbit', palette = null, ghost = null;
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
      if (gun) { if (v === 'hip') holder.position.fromArray(gun.hip); else holder.position.set(0, -gun.sightY, gun.adsZ); }
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
  const doc = { kind: 'gun', key: savedId ? `gun:${savedId}` : null, id: savedId || id, title: savedId || name.replace(/\.glb$/i, ''), icon: '⌐', is3D: true, overlay, tools, toolbar, inspector };
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
    savedId = gid; doc.title = gid; doc.id = gid;
    r('fname').textContent = `content/guns/${gid}.glb`;
    ctx.log(`저장: content/guns/${gid}.glb${out.isNew ? ' (새 총)' : ''} — 커밋해서 올리세요`, 'ok'); ctx.flash('저장했습니다');
    await ctx.refreshAssets(); ctx.rekey(doc, `gun:${gid}`);
    return true;
  }
  r('save').addEventListener('click', () => save());

  applySkin(root, palette); renderSlots(); setView('orbit', true);

  return Object.assign(doc, {
    activate() { controls.connect(); renderer.toneMappingExposure = 0.9; canvas.style.cursor = 'default'; },
    deactivate() { controls.disconnect(); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    frame() {
      if (view === 'orbit') { if (r('spin').checked) holder.rotation.y += 0.004; controls.update(); }
      updateLabels(); renderer.render(scene, camera);
    },
    isDirty: () => !savedId && id !== 'sample', // 파일로 연 모델은 프로젝트에 저장하기 전까지 "저장 안 됨"
    save,
    dispose() { controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    api: { get model() { return model; }, get view() { return view; }, setView, save, holder, camera },
  });
}
