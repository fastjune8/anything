// TEMPORARY developer test interface for the outfit system (audit tool).  Open /devwear.html on a dev server.
// Uses the real game modules (charassets.js makeInstance, outfit.js dress/equip/setOutfit/undress) — no copies of the logic.
// "ALT" items are NOT new clothing assets: they are runtime aliases of the existing item (same GLB, different id), injected here only
// so that replace-A-with-B can be exercised mechanically.  They exist only in this page's memory (not in content/cosmetics.json).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { tpAsset, fpAsset, makeInstance, wearableCacheSize } from '/js/charassets.js';
import { dress, setOutfit, equip, undress, outfitState } from '/js/outfit.js';
import { ITEMS, PALETTES, SLOTS } from '/shared/cosmetics.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.autoClear = false;

// ?wear=2 → view the _v_2 garment files (dev only; swaps the paths in the in-memory item table)
const WV = new URLSearchParams(location.search).get('wear');
if (WV) for (const it of ITEMS.values()) { for (const k of ['tp', 'fp']) if (it[k]) it[k] = it[k].replace(/_v_1/, '_v_' + WV); }
// ── aliases (dev only) ──
const ALT = {};
for (const it of [...ITEMS.values()]) {
  const alt = { ...it, id: 'devalt_' + it.id, name: it.name + ' [ALT alias, same GLB]' };
  ITEMS.set(alt.id, alt); ALT[it.id] = alt.id;
}
PALETTES.devalt = { fabric: '#5a2f2f', fabric2: '#7a5a2a', leather: '#3b2a1a', metal: '#9aa0a8', accent: '#e0a030', team: '#2a4a7a', core: '#202020', hair: '#c8a060' };

const pe = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
function mkScene(withGround) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x30353f);
  s.environment = pe; s.environmentIntensity = 0.55;
  s.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a4234, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(2, 4, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; // same as game world.js Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
  s.add(sun);
  if (withGround) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x4a505c, roughness: 0.95 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; s.add(g);
    s.add(new THREE.GridHelper(10, 20, 0x666d7a, 0x444a55));
  }
  return s;
}
const tpScene = mkScene(true), fpScene = mkScene(false);
const tpCam = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
const fpCam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);

// ── characters ──
const tp = makeInstance(tpAsset), fp = makeInstance(fpAsset);
tpScene.add(tp.root); fpScene.add(fp.root);
const tpMix = new THREE.AnimationMixer(tp.root), fpMix = new THREE.AnimationMixer(fp.root);
let tpAct = null, fpAct = null, paused = false, tpClipName = null, fpClipName = null;
function setClip(name, which = 'tp') {
  const asset = which === 'tp' ? tpAsset : fpAsset, mix = which === 'tp' ? tpMix : fpMix;
  const clip = asset.clips.get(name); if (!clip) return false;
  const a = mix.clipAction(clip); mix.stopAllAction(); a.reset().play();
  if (which === 'tp') { tpAct = a; tpClipName = name; } else { fpAct = a; fpClipName = name; }
  return true;
}
function setTime(t) { paused = true; for (const [m, a] of [[tpMix, tpAct], [fpMix, fpAct]]) if (a) { a.time = t % a.getClip().duration; a.paused = true; m.update(0); } }
const play = () => { paused = false; for (const a of [tpAct, fpAct]) if (a) a.paused = false; };
setClip('TP_Idle', 'tp'); setClip('FP_Rifle_Idle', 'fp');

// ── outfit handles: one per view, like the game (main.js / viewmodel.js) ──
let choice = { items: {} };
const hTP = dress(tp, choice, { view: 'tp' });
const hFP = dress(fp, choice, { view: 'fp' });
const apply = () => { setOutfit(hTP, choice); setOutfit(hFP, choice); };
const doEquip = (slot, id) => { choice = { ...choice, items: { ...choice.items, [slot]: id } }; apply(); };
const doReset = () => { choice = { items: {}, palette: undefined }; setOutfit(hTP, choice); setOutfit(hFP, choice); };
const ready = async () => { for (let i = 0; i < 400 && (outfitState(hTP).pending || outfitState(hFP).pending); i++) await new Promise(r => setTimeout(r, 25)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };

// ── camera ──
const cam = { az: 0, el: 0.1, dist: 3.4, ty: 0.85 };
const PRESETS = {
  front: { az: 0, el: 0.08, dist: 3.4, ty: 0.85 }, back: { az: Math.PI, el: 0.08, dist: 3.4, ty: 0.85 },
  left: { az: -Math.PI / 2, el: 0.08, dist: 3.4, ty: 0.85 }, right: { az: Math.PI / 2, el: 0.08, dist: 3.4, ty: 0.85 },
  three_q: { az: 0.7, el: 0.15, dist: 3.4, ty: 0.85 }, upper: { az: 0.5, el: 0.1, dist: 1.5, ty: 1.15 }, upper_back: { az: Math.PI - 0.4, el: 0.1, dist: 1.6, ty: 1.15 },
  head: { az: 0.45, el: 0.05, dist: 0.9, ty: 1.45 }, head_back: { az: Math.PI - 0.5, el: 0.05, dist: 0.9, ty: 1.45 },
  hands: { az: 0.2, el: 0.5, dist: 1.1, ty: 0.85 }, legs: { az: 0.5, el: 0.05, dist: 1.8, ty: 0.55 }, boots: { az: 0.6, el: 0.2, dist: 0.9, ty: 0.12 },
  shoulder: { az: 0.9, el: 0.1, dist: 0.8, ty: 1.28 },
};
const setCam = p => Object.assign(cam, typeof p === 'string' ? PRESETS[p] : p);
function placeCam() {
  tpCam.position.set(Math.sin(cam.az) * Math.cos(cam.el) * cam.dist, cam.ty + Math.sin(cam.el) * cam.dist, Math.cos(cam.az) * Math.cos(cam.el) * cam.dist);
  tpCam.lookAt(0, cam.ty, 0);
}
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', e => { if (!drag) return; cam.az -= (e.clientX - drag[0]) * 0.008; cam.el = Math.max(-0.6, Math.min(1.2, cam.el + (e.clientY - drag[1]) * 0.006)); drag = [e.clientX, e.clientY]; });
canvas.addEventListener('wheel', e => { cam.dist = Math.max(0.4, Math.min(8, cam.dist * (1 + e.deltaY * 0.001))); e.preventDefault(); }, { passive: false });

let showTP = true, showFP = true;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) { tpMix.update(dt); fpMix.update(dt); }
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H, false);
  renderer.setScissorTest(false); renderer.clear();
  placeCam(); tpCam.aspect = W / H; tpCam.updateProjectionMatrix();
  if (showTP) renderer.render(tpScene, tpCam);
  if (showFP) {
    const w = Math.min(520, W * 0.4), h = w * 0.6, x = W - w - 10, y = 34;
    renderer.setScissorTest(true); renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    renderer.clearDepth(); renderer.setClearColor(0x30353f, 1); renderer.clear(true, true, false);
    fpCam.aspect = w / h; fpCam.updateProjectionMatrix(); renderer.render(fpScene, fpCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── introspection ──
function countWear(root) { const per = {}; root.traverse(o => { if (o.userData.wear) { const k = o.userData.wear.slot + ':' + o.userData.wear.id; per[k] = (per[k] || 0) + 1; } }); return per; }
function uuids(h) { return Object.fromEntries(Object.entries(h.worn).map(([s, w]) => [s, w.objs.map(o => o.uuid).join()])); }
function state() {
  const m = renderer.info.memory;
  return { tp: outfitState(hTP), fp: outfitState(hFP), tpSceneWear: countWear(tp.root), fpSceneWear: countWear(fp.root), choice, tpClip: tpClipName,
    memory: { geometries: m.geometries, textures: m.textures, programs: renderer.info.programs.length, cache: wearableCacheSize() }, uuids: uuids(hTP) };
}

// ── UI ──
const LABEL = { upper: 'Jacket', lower: 'Pants', hands: 'Gloves', feet: 'Boots', hair: 'Hair', head: 'Headset', back: 'Backpack' };
const panel = document.getElementById('panel');
const logEl = document.createElement('div'); logEl.id = 'log';
const log = s => { logEl.textContent = s; };
const refresh = () => { const s = state(); const w = Object.entries(s.tp.worn).map(([k, v]) => `${k}=${v.id.replace('tactical_', '').replace('_001', '')}(${v.meshes})`).join(' '); log(`TP worn: ${w || '(none)'}\nTP mask=0x${s.tp.mask.toString(16)}  FP mask=0x${s.fp.mask.toString(16)}  pending=${s.tp.pending}/${s.fp.pending}\nGPU geo=${s.memory.geometries} tex=${s.memory.textures} prog=${s.memory.programs} cache=${s.memory.cache}`); };
function build() {
  let h = '<h3>Equipment slots</h3>';
  for (const [slot, name] of Object.entries(LABEL)) {
    const real = [...ITEMS.values()].find(i => i.slot === slot && !i.id.startsWith('devalt_'));
    h += `<div class="row"><label>${name}</label><select data-slot="${slot}"><option value="">(default: ${real.id.replace('tactical_', '')})</option><option value="__null">(bare / none)</option><option value="${real.id}">A: ${real.id}</option><option value="${ALT[real.id]}">B: ${ALT[real.id]} [alias]</option></select><button data-eq="${slot}">Equip</button><button data-un="${slot}">Unequip</button></div>`;
  }
  h += `<h3>Outfit</h3><div class="row"><button id="reset">Reset to default</button><button id="nude">Strip all</button><button id="allalt">All ALT (B)</button></div>
  <div class="row"><button id="upperonly">Jacket only</button><button id="lowerkeep">Swap jacket→B, keep rest</button></div>
  <div class="row"><label>Palette</label><select id="pal"><option value="tactical_dark">tactical_dark</option><option value="devalt">devalt (dev)</option></select><label style="width:auto">Skin</label><select id="skin"><option>0</option><option>1</option><option>2</option><option>3</option></select></div>
  <h3>View</h3><div class="row">${Object.keys(PRESETS).map(k => `<button data-cam="${k}">${k}</button>`).join('')}</div>
  <div class="row"><button id="tptog">Toggle TP pane</button><button id="fptog">Toggle FP pane</button></div>
  <h3>Animation (TP)</h3><div class="row"><select id="clip">${[...tpAsset.clips.keys()].map(n => `<option>${n}</option>`).join('')}</select></div>
  <div class="row"><button id="play">Play</button><button id="pause">Pause</button><input id="t" type="range" min="0" max="1" step="0.01" value="0" style="flex:1"></div>
  <h3>FP clip</h3><div class="row"><select id="fclip">${[...fpAsset.clips.keys()].map(n => `<option>${n}</option>`).join('')}</select></div>
  <h3>Stress</h3><div class="row"><button id="stress">200 random swaps</button></div>`;
  panel.innerHTML = h; panel.appendChild(logEl);
  const val = slot => panel.querySelector(`select[data-slot="${slot}"]`).value;
  panel.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.eq) { const v = val(b.dataset.eq); if (v === '__null') doEquip(b.dataset.eq, null); else if (v) doEquip(b.dataset.eq, v); else { const c = { ...choice.items }; delete c[b.dataset.eq]; choice = { ...choice, items: c }; apply(); } }
    else if (b.dataset.un) doEquip(b.dataset.un, null);
    else if (b.dataset.cam) setCam(b.dataset.cam);
    else if (b.id === 'reset') { doReset(); panel.querySelectorAll('select[data-slot]').forEach(s => s.value = ''); }
    else if (b.id === 'nude') { choice = { ...choice, items: Object.fromEntries(Object.keys(LABEL).map(s => [s, null])) }; apply(); }
    else if (b.id === 'allalt') { choice = { ...choice, items: Object.fromEntries(Object.keys(LABEL).map(s => [s, ALT[[...ITEMS.values()].find(i => i.slot === s && !i.id.startsWith('devalt_')).id]])) }; apply(); }
    else if (b.id === 'upperonly') { choice = { ...choice, items: { hair: null, head: null, lower: null, hands: null, feet: null, back: null } }; apply(); }
    else if (b.id === 'lowerkeep') doEquip('upper', ALT.tactical_jacket_001);
    else if (b.id === 'tptog') showTP = !showTP; else if (b.id === 'fptog') showFP = !showFP;
    else if (b.id === 'play') play(); else if (b.id === 'pause') paused = true;
    else if (b.id === 'stress') stress(200);
    setTimeout(refresh, 80);
  };
  panel.querySelector('#clip').onchange = e => setClip(e.target.value, 'tp');
  panel.querySelector('#fclip').onchange = e => setClip(e.target.value, 'fp');
  panel.querySelector('#t').oninput = e => { if (tpAct) setTime(+e.target.value * tpAct.getClip().duration); };
  panel.querySelector('#pal').onchange = e => { choice = { ...choice, palette: e.target.value }; apply(); };
  panel.querySelector('#skin').onchange = e => { choice = { ...choice, skin: +e.target.value }; apply(); };
}
async function stress(n) {
  const slots = Object.keys(LABEL), reals = Object.fromEntries(slots.map(s => [s, [...ITEMS.values()].find(i => i.slot === s && !i.id.startsWith('devalt_')).id]));
  for (let i = 0; i < n; i++) {
    const s = slots[Math.floor(Math.random() * slots.length)], r = Math.random();
    doEquip(s, r < 0.25 ? null : r < 0.6 ? reals[s] : ALT[reals[s]]);
    if (i % 5 === 0) await ready();
  }
  await ready(); refresh();
}
build();
await ready(); refresh();
window.__dev = { state, equip: doEquip, reset: doReset, apply, ready, setCam, setClip, setTime, play, stress, setChoice: c => { choice = c; apply(); }, getChoice: () => choice, ALT, hTP, hFP, tp, fp, renderer, SLOTS,
  setPane: (a, b) => { showTP = a; showFP = b; }, panelHide: v => { panel.style.display = v ? 'none' : ''; }, undressAll: () => { undress(hTP); undress(hFP); } };
window.__devReady = true;
