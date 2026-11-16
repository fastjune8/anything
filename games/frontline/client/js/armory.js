// 무기고 (로비에서 연다): 지금까지 얻은 무기가 벽에 걸려 있다.
//  - 벽의 무기를 클릭해 고르고, 오른쪽 패널에서 1·2번 자리에 장착하거나 파츠를 단다.
//  - 벽은 전장과 별개의 3D 장면이고(main.js 가 무기고가 열려 있으면 이 장면을 그린다), 글자(이름표·패널)는 HTML 이다.
//  - 저장과 성능 계산은 loadout.js / shared/parts.js 가 맡는다. 여기는 화면만 다룬다.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { SLOTS, partsFor, getPart, applyParts, describePart } from '/shared/parts.js';
import { buildGun, setGunParts } from './guns.js';
import { owned, equip, setPart, onLoadoutChange } from './loadout.js';
import { canvas, scene as worldScene } from './scene.js';
import { loadout, eff, game } from './state.js';
import { $, lerp, esc } from './util.js';
import { setDisplay } from './dom.js';

// ───── 벽 배치 (단위 m) ─────
const COLS = 2, ROWS = Math.ceil((WEAPONS.length + 1) / COLS); // +1: 다음 무기를 위한 빈 거치대 한 칸은 항상 남긴다
const COL_W = 1.62, ROW_H = 0.47, PLATE_W = 1.5, PLATE_H = 0.39;
const CONTENT_W = COLS * COL_W + 0.25, CONTENT_H = ROWS * ROW_H + 0.5;
const FOV = 30, ACCENT = 0xffb43a;
const PLATE_COLOR = 0x3a3f46, PLATE_HOVER = 0x464c54, PLATE_SEL = 0x525962; // 뒤판은 총보다 밝아야 검은 총의 윤곽이 산다
const GUN_SCALE = 1.12, GUN_UP = 0.028;                                      // 총은 조금 키워서, 아래 이름표 자리만큼 위로 올려 건다

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090a);
scene.environment = worldScene.environment; // 금속 반사용 (전장의 하늘을 같이 쓴다)
scene.environmentIntensity = 0.22;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);

export const armory = { open: false, scene, camera, selected: 0 };

// 벽: 가로 홈이 파인 어두운 철판
function wallTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#23272c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${(Math.random() * 0.05).toFixed(3)})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1); }
  for (let y = 0; y < 256; y += 32) { g.fillStyle = '#0d0f11'; g.fillRect(0, y, 256, 5); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, y + 5, 256, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 22); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.8, metalness: 0.25 }));
wall.receiveShadow = true; scene.add(wall);

// 조명: 열마다 위에서 비추는 따뜻한 등 (총 그림자가 벽에 떨어진다) + 약한 전체 조명
scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3128, 0.75));
const fill = new THREE.DirectionalLight(0xcfe0ff, 0.7); fill.position.set(-1.5, 0.6, 4); scene.add(fill); // 검은 총의 옆면이 묻히지 않게 정면에서 받쳐 주는 빛
for (let c = 0; c < COLS; c++) {
  const x = (c - (COLS - 1) / 2) * COL_W;
  const spot = new THREE.SpotLight(0xffe4c0, 60, 16, 0.4, 0.8, 1.6);
  spot.position.set(x * 0.9, 1.5, 4.4); spot.target.position.set(x, -0.15, 0);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.radius = 5;
  scene.add(spot, spot.target);
}

const MAT = {
  peg: new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.8, roughness: 0.4 }),
  locked: new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 1, metalness: 0 }), // 아직 얻지 못한 무기: 검은 윤곽만
  edgeOff: new THREE.Color(0x3a3f46), edgeOn: new THREE.Color(ACCENT),
};
const labelsEl = $('arLabels');

// 거치대 한 칸: 뒤판 + 테두리 + 못. gunIndex 가 없으면 빈 칸.
function makeSlot(n, gunIndex) {
  const x = (n % COLS - (COLS - 1) / 2) * COL_W, y = ((ROWS - 1) / 2 - Math.floor(n / COLS)) * ROW_H;
  const plateMat = new THREE.MeshStandardMaterial({ color: PLATE_COLOR, roughness: 0.9, metalness: 0.05 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(PLATE_W, PLATE_H, 0.02), plateMat);
  plate.position.set(x, y, 0.01); plate.receiveShadow = true; scene.add(plate);
  const edgeMat = new THREE.MeshBasicMaterial({ color: MAT.edgeOff.clone() });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(PLATE_W, 0.007, 0.026), edgeMat);
  edge.position.set(x, y - PLATE_H / 2 + 0.0035, 0.013); scene.add(edge);
  const label = document.createElement('div'); label.className = 'ar-label'; labelsEl.appendChild(label);
  const slot = { x, y, plate, plateMat, edgeMat, label, wi: gunIndex ?? -1, gun: null, pivot: null, lift: 0, spin: 0 };
  plate.userData.slot = slot;
  if (gunIndex === undefined) { label.innerHTML = '<span class="nm empty">빈 거치대</span>'; return slot; }

  for (const dx of [-0.12, 0.12]) { // 벽에서 튀어나온 못 두 개가 총을 받친다
    const geo = new THREE.CylinderGeometry(0.008, 0.008, 0.09, 8); geo.rotateX(Math.PI / 2);
    const peg = new THREE.Mesh(geo, MAT.peg); peg.position.set(x + dx, y + GUN_UP + 0.01, 0.06); peg.castShadow = true; scene.add(peg);
  }
  const w = WEAPONS[gunIndex], gun = buildGun(w.id, false);
  gun.group.rotation.y = Math.PI / 2; // 총구가 왼쪽을 보도록 옆으로 눕혀 건다
  const box = new THREE.Box3().setFromObject(gun.group), mid = box.getCenter(new THREE.Vector3());
  gun.group.position.set(-mid.x, -mid.y, 0); // 기본 상태의 총이 칸 가운데 오도록 (파츠를 달면 그만큼 바깥으로 나온다)
  const pivot = new THREE.Group(); pivot.position.set(x, y + GUN_UP, 0.1); pivot.add(gun.group); scene.add(pivot);
  slot.gun = gun; slot.pivot = pivot;
  dress(slot);
  return slot;
}
// 총 모델에 현재 파츠를 반영 (얻지 못한 무기는 윤곽만)
function dress(slot) {
  const has = owned.has(WEAPONS[slot.wi].id);
  setGunParts(slot.gun, has ? loadout.parts[slot.wi] : {});
  slot.gun.group.traverse(o => { if (!o.isMesh) return; o.castShadow = true; if (!has) o.material = MAT.locked; });
}
const slots = WEAPONS.map((w, i) => makeSlot(i, i));
for (let n = WEAPONS.length; n < COLS * ROWS; n++) slots.push(makeSlot(n));
const plates = slots.map(s => s.plate);

// ───── 이름표 (HTML) ─────
function renderLabels() {
  for (const s of slots) {
    if (s.wi < 0) continue;
    const w = WEAPONS[s.wi], has = owned.has(w.id), n = loadout.slots.indexOf(s.wi);
    s.label.innerHTML = `<span class="nm${has ? '' : ' empty'}">${esc(w.name)}<i>${esc(has ? w.cls : '미획득')}</i></span>${n >= 0 ? `<em>${n + 1}번 무기</em>` : ''}`;
    s.label.classList.toggle('sel', s.wi === armory.selected);
  }
}

// ───── 오른쪽 패널 ─────
// 성능 표의 한 줄: [이름, 점수(0~1, 클수록 좋다), 표시 글]
const STAT_ROWS = [
  ['피해', w => w.dmg * w.pellets / 120, w => (w.pellets > 1 ? `${w.dmg}×${w.pellets}` : `${w.dmg}`)],
  ['연사 속도', w => w.rpm / 850, w => `${w.rpm} RPM`],
  ['유효 사거리', w => (w.falloff ? w.falloff[1] / 125 : 1), w => (w.falloff ? `${Math.round(w.falloff[0])}–${Math.round(w.falloff[1])}m` : '거리 무관')],
  ['반동 제어', w => 1 - (w.recoilV + w.recoilH) / 5.4, w => `${w.recoilV.toFixed(2)} / ${w.recoilH.toFixed(2)}`],
  ['지향 정확도', w => 1 - w.hip / 5.8, w => `${w.hip.toFixed(2)}°`],
  ['조준 정확도', w => 1 - w.ads / 3.6, w => `${w.ads.toFixed(2)}°`],
  ['조준 속도', w => 1 - w.adsTime / 0.5, w => `${w.adsTime.toFixed(2)}초`],
  ['재장전', w => 1 - w.reload * (w.shell ? w.mag : 1) / 6.5, w => (w.shell ? `발당 ${w.reload.toFixed(2)}초` : `${w.reload.toFixed(1)}초`)],
  ['탄창', w => 0.12 + w.mag / 150, w => `${w.mag}발`],
  ['기동성', w => (w.move - 0.72) / 0.4, w => `${Math.round(w.move * 100)}%`],
];
const pct = v => `${(Math.max(0.03, Math.min(1, v)) * 100).toFixed(1)}%`;
let preview = null; // 마우스를 올린 파츠 { slot, part } — 달기 전에 성능 변화를 미리 보여 준다

function renderStats() {
  const wi = armory.selected, base = WEAPONS[wi];
  const shown = preview ? applyParts(base, { ...loadout.parts[wi], [preview.slot]: preview.part }) : eff[wi];
  $('arStats').innerHTML = STAT_ROWS.map(([name, score, text]) => {
    const a = score(base), b = score(shown), cls = b > a + 0.001 ? 'up' : b < a - 0.001 ? 'down' : '';
    return `<div class="st ${cls}"><span>${name}</span><div class="bar"><i style="width:${pct(b)}"></i><u style="left:${pct(a)}"></u></div><b>${text(shown)}</b></div>`;
  }).join('');
}
// 파츠 한 자리의 설명 줄: 마우스를 올린 파츠가 있으면 그것, 아니면 달려 있는 것
function describe(slotId) {
  const wi = armory.selected, base = WEAPONS[wi];
  const id = preview && preview.slot === slotId ? preview.part : loadout.parts[wi][slotId];
  const part = getPart(base.id, slotId, id);
  if (!part) return '<span>기본 상태 — 성능 변화 없음</span>';
  const d = describePart(base, part);
  return d.pros.map(t => `<span class="pro">▲ ${t}</span>`).join('') + d.cons.map(t => `<span class="con">▼ ${t}</span>`).join('');
}
function renderParts() {
  const wi = armory.selected, base = WEAPONS[wi], has = owned.has(base.id);
  $('arParts').innerHTML = SLOTS.map(s => {
    const list = partsFor(base.id, s.id), cur = loadout.parts[wi][s.id] || '';
    const chips = [{ id: '', name: '기본' }, ...list].map(p => `<button type="button" class="chip${p.id === cur ? ' on' : ''}" data-slot="${s.id}" data-part="${p.id}"${has ? '' : ' disabled'}>${p.name}</button>`).join('');
    return `<div class="pslot"><div class="pt">${s.name}</div>${list.length ? `<div class="chips">${chips}</div><div class="pd" data-desc="${s.id}">${describe(s.id)}</div>` : '<div class="pd"><span>이 무기에는 달 수 있는 파츠가 없습니다</span></div>'}</div>`;
  }).join('');
}
function renderPanel() {
  const wi = armory.selected, w = WEAPONS[wi], has = owned.has(w.id);
  $('arName').textContent = w.name;
  $('arCls').textContent = `${w.cls} · ${w.auto ? '연사' : w.bolt ? '볼트액션' : w.shell ? '펌프액션' : '단발'}`;
  for (const b of $('arEquip').children) {
    const n = Number(b.dataset.slot), on = loadout.slots[n] === wi;
    b.textContent = !has ? '아직 얻지 못한 무기' : on ? `${n + 1}번 무기로 장착 중` : `${n + 1}번 무기로 장착`;
    b.disabled = !has || on; b.classList.toggle('on', on);
  }
  $('arSum').innerHTML = loadout.slots.map((i, n) => `<span><em>${n + 1}</em>${esc(WEAPONS[i].name)}</span>`).join('');
  preview = null;
  renderStats(); renderParts(); renderLabels();
}
function select(wi) { armory.selected = wi; renderPanel(); }

// 로비 카드의 "무기고" 버튼에 지금 출전 무기를 보여 준다
function renderLobbySummary() { $('loadoutSum').textContent = loadout.slots.map((i, n) => `${n + 1} ${WEAPONS[i].name}`).join('  ·  '); }
renderLobbySummary();
onLoadoutChange(wi => { if (wi >= 0) dress(slots[wi]); renderLobbySummary(); renderPanel(); });

// ───── 조작 ─────
function setOpen(on) {
  if (on && game.joined) return;
  armory.open = on;
  setDisplay($('armory'), on); setDisplay($('menu'), !on, 'flex');
  canvas.style.cursor = '';
  if (on) { hover = -1; select(loadout.slots[0]); }
}
$('armoryBtn').addEventListener('click', () => setOpen(true));
$('arClose').addEventListener('click', () => setOpen(false));
addEventListener('keydown', e => { if (armory.open && e.code === 'Escape') setOpen(false); });
$('arEquip').addEventListener('click', e => { const b = e.target.closest('button'); if (b) equip(Number(b.dataset.slot), armory.selected); });

const chipOf = e => (e.target instanceof Element ? e.target.closest('.chip') : null);
$('arParts').addEventListener('click', e => { const c = chipOf(e); if (c && !c.disabled) setPart(armory.selected, c.dataset.slot, c.dataset.part || null); });
function setPreview(p) {
  const old = preview; preview = p;
  renderStats();
  for (const s of new Set([old && old.slot, p && p.slot])) { const el = s && $('arParts').querySelector(`[data-desc="${s}"]`); if (el) el.innerHTML = describe(s); }
}
$('arParts').addEventListener('mouseover', e => { const c = chipOf(e); if (c && !c.disabled) setPreview({ slot: c.dataset.slot, part: c.dataset.part }); });
$('arParts').addEventListener('mouseout', e => { if (chipOf(e) && preview) setPreview(null); });

// 벽의 무기 고르기: 마우스 아래의 거치대를 찾는다
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hover = -1, mx = 0, my = 0;
function pick(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(plates, false)[0];
  return hit ? hit.object.userData.slot.wi : -1;
}
canvas.addEventListener('mousemove', e => {
  if (!armory.open) return;
  mx = e.clientX / innerWidth * 2 - 1; my = 1 - e.clientY / innerHeight * 2;
  hover = pick(e); canvas.style.cursor = hover >= 0 ? 'pointer' : '';
});
canvas.addEventListener('mouseleave', () => { hover = -1; });
canvas.addEventListener('click', e => { if (!armory.open) return; const wi = pick(e); if (wi >= 0) select(wi); });

// ───── 매 프레임 ─────
const _p = new THREE.Vector3();
const toScreen = (x, y, z) => { _p.set(x, y, z).project(camera); return [(_p.x + 1) / 2 * innerWidth, (1 - _p.y) / 2 * innerHeight]; };
let camX = 0, camY = 0;
export function updateArmory(dt) {
  // 카메라: 패널을 뺀 왼쪽 영역 한가운데에 벽이 다 들어오는 거리. 마우스를 따라 살짝 움직여 입체감을 준다.
  const vw = innerWidth, vh = innerHeight, panelW = $('arPanel').offsetWidth, topH = 64;
  const t = Math.tan(FOV * Math.PI / 360);
  camera.aspect = vw / vh;
  const dist = Math.max(CONTENT_H / (2 * t * (1 - topH / vh)), CONTENT_W / (2 * t * camera.aspect * Math.max(0.3, 1 - panelW / vw)));
  camera.setViewOffset(vw, vh, panelW / 2, -topH / 2, vw, vh);
  const k = 1 - Math.exp(-dt * 5);
  camX = lerp(camX, mx * 0.45, k); camY = lerp(camY, my * 0.25, k);
  camera.position.set(camX, camY, dist); camera.lookAt(camX * 0.25, camY * 0.25, 0);
  camera.updateMatrixWorld();

  for (const s of slots) {
    const sel = s.wi >= 0 && s.wi === armory.selected, hov = s.wi >= 0 && s.wi === hover, used = loadout.slots.includes(s.wi);
    if (s.pivot) { // 고른 총은 벽에서 앞으로 나와 천천히 좌우로 돌며 옆모습을 보여 준다
      const a = 1 - Math.exp(-dt * 9);
      s.lift = lerp(s.lift, sel ? 1 : hov ? 0.3 : 0, a);
      s.spin = sel ? s.spin + dt : 0;
      s.pivot.position.z = 0.1 + s.lift * 0.24;
      s.pivot.rotation.y = lerp(s.pivot.rotation.y, sel ? Math.sin(s.spin * 0.7) * 0.3 : 0, a);
      s.pivot.scale.setScalar(GUN_SCALE * (1 + s.lift * 0.08));
    }
    s.edgeMat.color.lerp(sel || used ? MAT.edgeOn : MAT.edgeOff, 0.2);
    s.plateMat.color.setHex(sel ? PLATE_SEL : hov ? PLATE_HOVER : PLATE_COLOR);
    // 이름표를 거치대 아래쪽 가장자리에 맞춘다
    const [x0, y0] = toScreen(s.x - PLATE_W / 2, s.y - PLATE_H / 2, 0.02), [x1] = toScreen(s.x + PLATE_W / 2, s.y - PLATE_H / 2, 0.02);
    s.label.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px) translateY(-100%)`;
    s.label.style.width = `${(x1 - x0).toFixed(1)}px`;
  }
}
