// FRONTIER 맵 에디터: content/maps/*.json 을 고친다.
// 게임과 같은 코드(shared/maps/build.js 로 펼치고 client/js/world.js 로 그림)를 쓰므로 보이는 그대로 게임에 나온다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from '/js/world.js';
import { expandObject, buildLayout, OBJECT_TYPES } from '/shared/maps/build.js';
import { OBJECT_SCHEMAS, objectSpec, ZONE, checkMap } from '/shared/content/schema.js';
import { MODES } from '/shared/modes.js';
import { buildForm } from './form.js';

const $ = id => document.getElementById(id);
const r2 = v => Math.round(v * 100) / 100;
const TEAM_COLOR = { '-1': 0xe9ecef, 0: 0x5aa9ff, 1: 0xff4b3a };
const TEAM_NAME = { '-1': '개인전 스폰', 0: '0팀 스폰', 1: '1팀 스폰' };

// ───────── 상태 ─────────
let map = null;            // 고치는 중인 맵 데이터
let mapIds = [];
let sel = null;            // { kind: 'obj', i } | { kind: 'spawn', team, i } | { kind: 'zone', i } | null(맵 설정)
let tool = null;           // 배치 도구: { kind: 'obj', type } | { kind: 'spawn', team } | { kind: 'zone' } | null(선택)
let saved = '';            // 마지막으로 저장한(불러온) 내용
let snap = '';             // 되돌리기 기준 (마지막 확정 상태)
const undoStack = [], redoStack = [];

// ───────── 3D ─────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;
const scene = new THREE.Scene();
const world = buildWorld(scene, renderer);
scene.fog.density = 0.0015; // 위에서 내려다보므로 안개를 옅게
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
camera.position.set(0, 80, 70);
const controls = new OrbitControls(camera, canvas);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null }; // 왼쪽·오른쪽 버튼은 아래에서 직접 처리 (선택/비행), 가운데 = 화면 이동
controls.zoomToCursor = true; // 휠: 마우스가 가리키는 곳으로 확대
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.screenSpacePanning = false;

const pickGroup = new THREE.Group(), markGroup = new THREE.Group(), selGroup = new THREE.Group(), helpGroup = new THREE.Group();
scene.add(pickGroup, markGroup, selGroup, helpGroup);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const pickMat = new THREE.MeshBasicMaterial({ visible: false });
const edgeGeo = new THREE.EdgesGeometry(unitBox);
const selMat = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true });
const selMirrorMat = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true, opacity: 0.35 });

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 바닥 격자와 맵 경계
function drawHelpers() {
  for (const c of [...helpGroup.children]) { helpGroup.remove(c); c.geometry && c.geometry.dispose(); }
  const size = map.half * 2;
  const g1 = new THREE.GridHelper(size, Math.round(size), 0x000000, 0x000000); g1.material.opacity = 0.08; g1.material.transparent = true; g1.position.y = 0.02;
  const g5 = new THREE.GridHelper(size, Math.round(size / 5), 0x000000, 0x000000); g5.material.opacity = 0.2; g5.material.transparent = true; g5.position.y = 0.03;
  const h = map.half, pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => new THREE.Vector3(x, 0.05, z));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb43a }));
  helpGroup.add(g1, g5, edge);
}

// 맵 전체를 다시 그린다 (박스 수백 개라 매번 새로 만들어도 충분히 빠르다)
let rebuildQueued = false;
function rebuild() { if (!rebuildQueued) { rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuildNow(); }); } }
function rebuildNow() {
  world.setMap(buildLayout(map));
  for (const c of [...pickGroup.children]) pickGroup.remove(c);
  map.objects.forEach((o, i) => {
    const { boxes, trees } = expandObject(o);
    boxes.forEach((b, k) => {
      const m = new THREE.Mesh(unitBox, pickMat);
      m.scale.set(b.w, b.h, b.d); m.position.set(b.x, b.y + b.h / 2, b.z);
      m.userData = { kind: 'obj', i, mirror: !!o.sym && k >= boxes.length / 2 };
      pickGroup.add(m);
    });
    trees.forEach((t, k) => {
      const m = new THREE.Mesh(unitBox, pickMat);
      m.scale.set(1.2 * t.s, 5 * t.s, 1.2 * t.s); m.position.set(t.x, 2.5 * t.s, t.z);
      m.userData = { kind: 'obj', i, mirror: !!o.sym && k >= trees.length / 2 };
      pickGroup.add(m);
    });
  });
  drawMarkers(); drawSelection(); validate(); updateTitle();
}

// 스폰 지점(기둥)과 거점(원)
function drawMarkers() {
  for (const c of [...markGroup.children]) { markGroup.remove(c); c.geometry && c.geometry.dispose(); }
  const spawnGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.8, 16);
  const add = (list, team) => (list || []).forEach(([x, z], i) => {
    const m = new THREE.Mesh(spawnGeo, new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.85 }));
    m.position.set(x, 0.9, z); m.userData = { kind: 'spawn', team, i };
    markGroup.add(m);
  });
  add(map.spawns.ffa, -1);
  (map.spawns.team || []).forEach((list, t) => add(list, t));
  (map.zones || []).forEach((zn, i) => {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(zn.r, zn.r, 0.3, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    disc.position.set(zn.x, 0.15, zn.z); disc.userData = { kind: 'zone', i };
    const ring = new THREE.Mesh(new THREE.RingGeometry(zn.r - 0.15, zn.r, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(zn.x, 0.32, zn.z); ring.userData = { kind: 'zone', i };
    markGroup.add(disc, ring);
  });
}

function drawSelection() {
  for (const c of [...selGroup.children]) selGroup.remove(c);
  if (!sel) return;
  if (sel.kind === 'obj') {
    for (const m of pickGroup.children) {
      if (m.userData.i !== sel.i) continue;
      const l = new THREE.LineSegments(edgeGeo, m.userData.mirror ? selMirrorMat : selMat);
      l.scale.copy(m.scale).multiplyScalar(1.01); l.position.copy(m.position); l.renderOrder = 10;
      selGroup.add(l);
    }
  } else {
    for (const m of markGroup.children) {
      const u = m.userData;
      if (u.kind === sel.kind && u.i === sel.i && (sel.kind !== 'spawn' || u.team === sel.team)) {
        const l = new THREE.BoxHelper(m, 0xffd23a); l.material.depthTest = false; l.renderOrder = 10; selGroup.add(l);
      }
    }
  }
}

// ───────── 고치기 / 되돌리기 ─────────
const isDirty = () => JSON.stringify(map) !== saved;
// 한 번의 고침이 끝났을 때 (끌기를 놓음, 칸 입력 완료, 추가/삭제)
function commit() {
  const now = JSON.stringify(map);
  if (now === snap) return;
  undoStack.push(snap); if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0; snap = now;
  updateTitle();
}
function restore(text) {
  map = JSON.parse(text); snap = text;
  if (sel && !selected()) sel = null;
  rebuildNow(); drawHelpers(); renderPanel();
}
function undo() { if (undoStack.length) { redoStack.push(snap); restore(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(snap); restore(redoStack.pop()); } }

// 선택한 것의 실제 데이터
function selected() {
  if (!sel) return null;
  if (sel.kind === 'obj') return map.objects[sel.i] || null;
  if (sel.kind === 'zone') return (map.zones || [])[sel.i] || null;
  if (sel.kind === 'spawn') { const list = sel.team < 0 ? map.spawns.ffa : (map.spawns.team || [])[sel.team]; return (list && list[sel.i]) || null; }
  return null;
}
function spawnList(team) {
  if (team < 0) return map.spawns.ffa;
  if (!map.spawns.team) map.spawns.team = [[], []];
  return map.spawns.team[team];
}

// 옮기기: orig(옮기기 시작할 때의 복사본) 에서 (dx, dz) 만큼
function moveTo(orig, dx, dz) {
  if (sel.kind === 'spawn') { const list = spawnList(sel.team); list[sel.i] = [r2(orig[0] + dx), r2(orig[1] + dz)]; return; }
  const o = selected();
  if (o.type === 'wall') {
    const along = (o.axis || 'x') === 'x' ? dx : dz, across = (o.axis || 'x') === 'x' ? dz : dx;
    o.from = r2(orig.from + along); o.to = r2(orig.to + along); o.at = r2(orig.at + across);
    o.ops = (orig.ops || []).map(op => ({ ...op, at: r2(op.at + along) }));
    return;
  }
  o.x = r2(orig.x + dx); o.z = r2(orig.z + dz);
  if (o.type === 'building' && orig.ops) { // 건물의 문·창문 위치는 절대 좌표라 같이 옮긴다
    o.ops = {};
    for (const [side, list] of Object.entries(orig.ops)) o.ops[side] = (list || []).map(op => ({ ...op, at: r2(op.at + (side === 'n' || side === 's' ? dx : dz)) }));
  }
}

// 새로 놓을 물체의 기본값
function newObject(type, x, z) {
  const base = { type };
  switch (type) {
    case 'box': return { ...base, x, y: 0, z, w: 2, h: 2, d: 2, mat: 'concrete' };
    case 'wall': return { ...base, axis: 'x', at: z, from: r2(x - 4), to: r2(x + 4), h: 2.8, t: 0.35, mat: 'brick', ops: [] };
    case 'building': return { ...base, x, z, w: 8, d: 6, h: 3, mat: 'brick', roof: true, ops: { n: [], s: [{ at: x, w: 1.6, type: 'door' }], e: [], w: [] } };
    case 'container': return { ...base, x, z, axis: 'x', tint: '#2f5d8a' };
    case 'crate': return { ...base, x, z, s: 1.2 };
    case 'sandbags': return { ...base, x, z, len: 4, axis: 'x' };
    case 'barrier': return { ...base, x, z, axis: 'x' };
    case 'barrel': return { ...base, x, z, tint: '#7a2a1e' };
    case 'tree': return { ...base, x, z, s: 1 };
    default: return { ...base, x, z };
  }
}

function place(x, z) {
  if (tool.kind === 'obj') { map.objects.push(newObject(tool.type, x, z)); sel = { kind: 'obj', i: map.objects.length - 1 }; }
  else if (tool.kind === 'spawn') { const list = spawnList(tool.team); list.push([x, z]); sel = { kind: 'spawn', team: tool.team, i: list.length - 1 }; }
  else if (tool.kind === 'zone') {
    if (!map.zones) map.zones = [];
    const ids = new Set(map.zones.map(zn => zn.id));
    const id = 'ABCDEFGH'.split('').find(c => !ids.has(c)) || `Z${map.zones.length}`;
    map.zones.push({ id, name: `거점 ${id}`, x, z, r: 6 }); sel = { kind: 'zone', i: map.zones.length - 1 };
  }
  rebuildNow(); commit(); renderPanel();
}

function removeSelected() {
  if (!sel) return;
  if (sel.kind === 'obj') map.objects.splice(sel.i, 1);
  else if (sel.kind === 'zone') map.zones.splice(sel.i, 1);
  else if (sel.kind === 'spawn') spawnList(sel.team).splice(sel.i, 1);
  sel = null; rebuildNow(); commit(); renderPanel();
}
function duplicateSelected() {
  if (!sel || sel.kind !== 'obj') return;
  const copy = JSON.parse(JSON.stringify(selected()));
  map.objects.push(copy); sel = { kind: 'obj', i: map.objects.length - 1 };
  moveTo(JSON.parse(JSON.stringify(copy)), 2, 2);
  rebuildNow(); commit(); renderPanel();
}
function rotateSelected() {
  const o = sel && sel.kind === 'obj' ? selected() : null;
  if (!o) return;
  const rot = ((o.rot || 0) + 90) % 360;
  if (rot) o.rot = rot; else delete o.rot;
  rebuildNow(); commit(); renderPanel();
}

// ───────── 마우스 ─────────
// 유니티·언리얼과 비슷하게:
//   왼쪽 클릭 = 선택·끌어서 이동·배치          Alt + 왼쪽 끌기 = 궤도 회전
//   오른쪽 버튼을 누른 채 = 비행 (마우스로 둘러보기 + WASD 날기, Q/E 내려가기/올라가기, 휠 = 비행 속도)
//   가운데 끌기 = 화면 이동                    휠 = 커서 쪽으로 확대/축소
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
let snapStep = 0.5;   // 격자 (0 = 끔)
let lastSnap = 0.5;   // G 로 다시 켤 때의 격자
let cursor = null;    // 마우스가 가리키는 바닥 좌표 [x, z] (붙여넣기 위치, 좌표 표시)
function aim(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
const snapV = v => (snapStep ? Math.round(v / snapStep) * snapStep : r2(v));
function groundPoint(e) {
  aim(e);
  if (!ray.ray.intersectPlane(ground, hit)) return null;
  return [snapV(hit.x), snapV(hit.z)];
}
function pick(e) {
  aim(e);
  const m = ray.intersectObjects(markGroup.children, false)[0] || ray.intersectObjects(pickGroup.children, false)[0];
  return m ? m.object.userData : null;
}

// 카메라: 비행(오른쪽 버튼) / 궤도(Alt+왼쪽, Q/E)
const look = new THREE.Euler(0, 0, 0, 'YXZ');
let fly = null;       // { dist } 오른쪽 버튼을 누르고 있는 동안
let flySpeed = 20;    // m/s (비행 중 휠로 바꾼다)
let orbiting = false;
function startFly() {
  fly = { dist: Math.max(5, camera.position.distanceTo(controls.target)) };
  controls.enabled = false;
  look.setFromQuaternion(camera.quaternion, 'YXZ');
}
function endFly() {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  controls.target.copy(camera.position).addScaledVector(fwd, fly.dist); // 다시 궤도 조작을 할 때 바라보던 곳을 중심으로
  fly = null; controls.enabled = true; controls.update();
}
function orbitBy(dYaw, dPitch) {
  const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
  s.theta += dYaw; s.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, s.phi + dPitch));
  camera.position.copy(controls.target).add(off.setFromSpherical(s));
  camera.lookAt(controls.target);
}

let drag = null; // { start: [x, z], orig, mirror, moved }
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 2) { startFly(); return; }
  if (e.button !== 0) return;
  if (e.altKey) { orbiting = true; controls.enabled = false; return; }
  const p = groundPoint(e);
  if (tool) { if (p) place(p[0], p[1]); if (!e.shiftKey) setTool(null); return; } // Shift 를 누르고 있으면 계속 놓기
  const u = pick(e);
  sel = u ? (u.kind === 'spawn' ? { kind: 'spawn', team: u.team, i: u.i } : { kind: u.kind, i: u.i }) : null;
  drawSelection(); renderPanel();
  if (u && p) drag = { start: p, orig: JSON.parse(JSON.stringify(selected())), mirror: !!u.mirror, moved: false };
});
canvas.addEventListener('pointermove', e => {
  if (fly) { // 둘러보기
    look.y -= e.movementX * 0.0028; look.x = Math.max(-1.5, Math.min(1.5, look.x - e.movementY * 0.0028));
    camera.quaternion.setFromEuler(look);
    return;
  }
  if (orbiting) { orbitBy(-e.movementX * 0.006, -e.movementY * 0.006); return; }
  const p = groundPoint(e);
  cursor = p; showCoords();
  if (!drag) { if (!tool) canvas.style.cursor = pick(e) ? 'pointer' : 'default'; return; } // 고를 수 있는 것 위에서는 손가락 모양
  if (!p) return;
  let dx = p[0] - drag.start[0], dz = p[1] - drag.start[1];
  if (drag.mirror) { dx = -dx; dz = -dz; } // 대칭 복사본을 끌면 원본은 반대로 움직인다
  if (!dx && !dz && !drag.moved) return;
  drag.moved = true;
  moveTo(drag.orig, dx, dz); rebuild();
});
canvas.addEventListener('pointerup', e => {
  if (e.button === 2 && fly) { endFly(); return; }
  if (orbiting) { orbiting = false; controls.enabled = true; controls.update(); return; }
  if (drag && drag.moved) { commit(); renderPanel(); }
  drag = null;
});
canvas.addEventListener('wheel', e => { // 비행 중 휠 = 비행 속도
  if (!fly) return;
  e.preventDefault();
  flySpeed = Math.min(200, Math.max(2, flySpeed * (e.deltaY < 0 ? 1.25 : 0.8)));
  showCoords(`비행 속도 ${flySpeed.toFixed(0)} m/s`);
}, { passive: false });
canvas.addEventListener('dblclick', () => focusSelected());
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ───────── 키보드 ─────────
// e.code(키 위치)로 본다: 한글 입력 상태여도 W 는 W 로 동작한다
const held = new Set();
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
let clipboard = null;
addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === 'KeyS') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (mod) {
    if (e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.code === 'KeyY') { e.preventDefault(); redo(); }
    else if (e.code === 'KeyD') { e.preventDefault(); duplicateSelected(); }
    else if (e.code === 'KeyC') { e.preventDefault(); copySelected(); }
    else if (e.code === 'KeyV') { e.preventDefault(); paste(); }
    return;
  }
  if (MOVE_KEYS.has(e.code)) { held.add(e.code); e.preventDefault(); return; }
  switch (e.code) {
    case 'Delete': case 'Backspace': e.preventDefault(); removeSelected(); break;
    case 'KeyR': rotateSelected(); break;
    case 'KeyF': focusSelected(); break;
    case 'KeyT': topView(); break;
    case 'Home': overview(); break;
    case 'KeyG': setSnap(snapStep ? 0 : lastSnap); break;
    case 'Escape': setTool(null); sel = null; drawSelection(); renderPanel(); break;
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); nudge(e.code, e.shiftKey); break;
  }
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => held.clear());

// 매 프레임: 누르고 있는 키로 카메라 이동
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Vector3();
function moveCamera(dt) {
  const k = c => (held.has(c) ? 1 : 0);
  const fast = k('ShiftLeft') || k('ShiftRight') ? 3 : 1;
  const fwd = k('KeyW') - k('KeyS'), side = k('KeyD') - k('KeyA'), updown = k('KeyE') - k('KeyQ');
  camera.getWorldDirection(_f);
  if (fly) { // 비행: 바라보는 방향으로, Q/E 는 아래/위
    _r.crossVectors(_f, camera.up).normalize();
    _m.set(0, 0, 0).addScaledVector(_f, fwd).addScaledVector(_r, side).addScaledVector(camera.up, updown);
    if (_m.lengthSq()) camera.position.addScaledVector(_m.normalize(), flySpeed * fast * dt);
    return;
  }
  // 평소: WASD = 지도 위를 앞뒤좌우로 (멀리서 볼수록 빠르게), Q/E = 시점 좌우 회전
  if (fwd || side) {
    _f.y = 0; _f.normalize(); _r.set(-_f.z, 0, _f.x);
    const dist = camera.position.distanceTo(controls.target);
    _m.set(0, 0, 0).addScaledVector(_f, fwd).addScaledVector(_r, side).normalize().multiplyScalar(Math.max(10, dist * 0.9) * fast * dt);
    camera.position.add(_m); controls.target.add(_m);
  }
  if (updown) orbitBy(-updown * 1.5 * fast * dt, 0);
}

// 방향키: 선택한 것을 격자 한 칸씩 (Shift = 4칸). 화면에서 위쪽 화살표 = 멀어지는 쪽
function nudge(code, big) {
  const o = selected();
  if (!o) return;
  camera.getWorldDirection(_f); _f.y = 0;
  const alongX = Math.abs(_f.x) > Math.abs(_f.z);
  const fx = alongX ? Math.sign(_f.x) : 0, fz = alongX ? 0 : Math.sign(_f.z); // 화면 위쪽에 가장 가까운 축
  const rx = -fz, rz = fx;
  const step = (snapStep || 0.1) * (big ? 4 : 1);
  const [u, s] = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[code];
  moveTo(JSON.parse(JSON.stringify(o)), r2((fx * u + rx * s) * step), r2((fz * u + rz * s) * step));
  rebuildNow(); commit(); renderPanel();
}

// 복사 / 붙여넣기 (마우스가 가리키는 곳에)
function copySelected() {
  const o = selected();
  if (!o || sel.kind !== 'obj') return;
  clipboard = JSON.parse(JSON.stringify(o));
  flash('복사했습니다 — ⌘V 로 마우스 위치에 붙여넣기');
}
function paste() {
  if (!clipboard) return;
  const copy = JSON.parse(JSON.stringify(clipboard));
  map.objects.push(copy); sel = { kind: 'obj', i: map.objects.length - 1 };
  const [ax, az] = OBJECT_TYPES[copy.type].anchor(copy), [tx, tz] = cursor || [ax + 2, az + 2];
  moveTo(JSON.parse(JSON.stringify(copy)), r2(snapV(tx) - ax), r2(snapV(tz) - az));
  rebuildNow(); commit(); renderPanel();
}

function setSnap(v) {
  snapStep = v; if (v) lastSnap = v;
  $('snapSel').value = String(v);
  showCoords();
}
function showCoords(extra) {
  const c = cursor ? `x ${cursor[0].toFixed(1)} · z ${cursor[1].toFixed(1)}` : '';
  $('coords').textContent = [c, `격자 ${snapStep ? snapStep + 'm' : '끔'} (G)`, extra || (fly ? `비행 속도 ${flySpeed.toFixed(0)} m/s (휠)` : '')].filter(Boolean).join('  ·  ');
}

function topView() { camera.position.set(controls.target.x, map.half * 2.2, controls.target.z + 0.01); camera.lookAt(controls.target); }
function overview() { controls.target.set(0, 0, 0); camera.position.set(0, map.half * 1.3, map.half * 1.15); camera.lookAt(controls.target); }
function focusSelected() {
  if (!selGroup.children.length) return;
  const box = new THREE.Box3();
  for (const m of selGroup.children) if (m.material !== selMirrorMat) box.expandByObject(m);
  if (box.isEmpty()) box.setFromObject(selGroup);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  const d = camera.position.clone().sub(controls.target);
  controls.target.set(c.x, 0, c.z);
  camera.position.copy(controls.target).add(d.setLength(Math.max(8, size * 1.6)));
  camera.lookAt(controls.target);
}

// ───────── 화면: 도구 / 속성 / 검사 ─────────
function setTool(t) {
  tool = t;
  for (const b of document.querySelectorAll('#palette button')) b.classList.toggle('on', !!t && b.dataset.tool === toolKey(t));
  canvas.style.cursor = t ? 'crosshair' : 'default';
  $('hintTool').textContent = t ? '바닥을 클릭해 놓기 · Shift+클릭 = 계속 놓기 · Esc = 취소' : '';
}
const toolKey = t => (t.kind === 'obj' ? `obj:${t.type}` : t.kind === 'spawn' ? `spawn:${t.team}` : 'zone');

function buildPalette() {
  const pal = $('palette');
  const group = (title, items) => {
    pal.appendChild(Object.assign(document.createElement('h3'), { textContent: title }));
    for (const [label, t] of items) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.tool = toolKey(t);
      b.addEventListener('click', () => setTool(tool && toolKey(tool) === toolKey(t) ? null : t));
      pal.appendChild(b);
    }
  };
  group('물체', Object.entries(OBJECT_SCHEMAS).map(([type, s]) => [s.label, { kind: 'obj', type }]));
  group('스폰 지점', [['개인전', { kind: 'spawn', team: -1 }], ['0팀 (파랑)', { kind: 'spawn', team: 0 }], ['1팀 (빨강)', { kind: 'spawn', team: 1 }]]);
  group('모드', [['거점 (점령전)', { kind: 'zone' }]]);
}

const MAP_FIELDS = { fields: { name: { kind: 'str', label: '이름' }, half: { kind: 'num', label: '맵 절반 크기 (m)', min: 10, max: 250, step: 1, hint: '외곽 벽은 따로 옮겨야 한다' } } };
function renderPanel() {
  const panel = $('props');
  panel.replaceChildren();
  const h = { onInput: () => rebuild(), onCommit: () => { commit(); renderPanel(); } };
  const title = t => panel.appendChild(Object.assign(document.createElement('h2'), { textContent: t }));
  const btns = list => {
    const d = document.createElement('div'); d.className = 'btns';
    for (const [label, fn, cls] of list) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); d.appendChild(b); }
    panel.appendChild(d);
  };
  const o = selected();
  if (!o) {
    title(`맵 설정 · ${map.id}`);
    buildForm(panel, MAP_FIELDS, map, { ...h, onInput: () => { rebuild(); drawHelpers(); } });
    const n = map.objects.length, sp = map.spawns.ffa.length, tm = (map.spawns.team || []).map(l => l.length).join(' / ') || '없음';
    panel.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: `물체 ${n}개 · 개인전 스폰 ${sp}곳 · 팀 스폰 ${tm} · 거점 ${(map.zones || []).length}개` }));
    panel.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: '물체를 클릭하면 여기서 고칠 수 있습니다.' }));
    return;
  }
  if (sel.kind === 'obj') {
    title(`${OBJECT_SCHEMAS[o.type].label} #${sel.i}`);
    buildForm(panel, objectSpec(o.type), o, { ...h, skip: ['type'] });
    btns([['회전 (R)', rotateSelected], ['복제 (⌘D)', duplicateSelected], ['삭제 (Del)', removeSelected, 'danger']]);
  } else if (sel.kind === 'zone') {
    title(`거점 ${o.id}`);
    buildForm(panel, ZONE, o, h);
    btns([['삭제 (Del)', removeSelected, 'danger']]);
  } else {
    title(`${TEAM_NAME[sel.team]} #${sel.i}`);
    const holder = { p: o };
    buildForm(panel, { fields: { p: { kind: 'point', label: '위치 [x, z]' } } }, holder, { ...h, onInput: () => { spawnList(sel.team)[sel.i] = holder.p; rebuild(); } });
    btns([['삭제 (Del)', removeSelected, 'danger']]);
  }
}

let lastErrors = [];
function validate() {
  lastErrors = checkMap(map);
  const box = $('errors');
  box.replaceChildren(...lastErrors.slice(0, 8).map(t => Object.assign(document.createElement('div'), { textContent: t })));
  if (lastErrors.length > 8) box.appendChild(Object.assign(document.createElement('div'), { textContent: `… 외 ${lastErrors.length - 8}건` }));
  box.hidden = !lastErrors.length;
  $('save').disabled = !!lastErrors.length;
}
function updateTitle() {
  const d = isDirty();
  $('status').textContent = d ? '저장 안 됨' : '저장됨';
  $('status').className = d ? 'dirty' : '';
  document.title = `${d ? '• ' : ''}${map.name} — FRONTIER 맵 에디터`;
}

// ───────── 불러오기 / 저장 / 시험 플레이 ─────────
async function loadMapList() {
  mapIds = await (await fetch('/content/maps/index.json', { cache: 'no-store' })).json();
  const s = $('mapSel'); s.replaceChildren(...mapIds.map(id => new Option(id, id)));
}
async function openMap(id) {
  if (map && isDirty() && !confirm('저장하지 않은 내용이 있습니다. 버리고 다른 맵을 열까요?')) { $('mapSel').value = map.id; return; }
  const text = await (await fetch(`/content/maps/${id}.json`, { cache: 'no-store' })).text();
  map = JSON.parse(text); map.zones = map.zones || [];
  saved = snap = JSON.stringify(map); undoStack.length = redoStack.length = 0;
  sel = null; $('mapSel').value = id;
  const p = new URLSearchParams(location.search); p.set('map', id); history.replaceState(null, '', `?${p}`);
  rebuildNow(); drawHelpers(); renderPanel();
  overview();
}

async function save() {
  if (lastErrors.length) { flash('검사 오류가 있어 저장할 수 없습니다'); return false; }
  const res = await fetch(`/api/maps/${map.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(map) });
  const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
  if (!out.ok) { flash('저장 실패: ' + (out.errors || []).join(' / ')); return false; }
  saved = JSON.stringify(map); updateTitle();
  if (out.isNew) { await loadMapList(); $('mapSel').value = map.id; }
  flash(out.isNew ? '새 맵을 저장했습니다' : '저장했습니다');
  return true;
}

async function play() {
  if (isDirty() && !(await save())) return;
  const mode = $('playMode').value, bots = $('playBots').checked ? 1 : 0;
  window.open(`/?auto=${encodeURIComponent('맵시험')}&mode=${mode}&map=${map.id}&bots=${bots}`, '_blank');
}

function newMap() {
  const id = (prompt('새 맵 id (영문 소문자·숫자·_, 파일 이름이 됩니다)') || '').trim();
  if (!id) return;
  if (!/^[a-z0-9_]+$/.test(id)) { alert('영문 소문자, 숫자, _ 만 쓸 수 있습니다.'); return; }
  if (mapIds.includes(id)) { alert('이미 있는 id 입니다.'); return; }
  if (map && isDirty() && !confirm('저장하지 않은 내용이 있습니다. 버리고 새 맵을 만들까요?')) return;
  const name = (prompt('맵 이름', id) || id).trim();
  const h = 40, wall = (x, z, w, d) => ({ type: 'box', x, y: 0, z, w, h: 4.5, d, mat: 'concrete' });
  map = {
    id, name, half: h,
    spawns: { ffa: [[-30, -30], [30, 30], [-30, 30], [30, -30]], team: [[[-4, 34], [0, 35], [4, 34]], [[-4, -34], [0, -35], [4, -34]]] },
    zones: [{ id: 'A', name: '거점 A', x: 0, z: 0, r: 6 }],
    objects: [wall(0, -h - 0.5, 2 * h + 2, 1), wall(0, h + 0.5, 2 * h + 2, 1), wall(-h - 0.5, 0, 1, 2 * h), wall(h + 0.5, 0, 1, 2 * h)],
  };
  saved = ''; snap = JSON.stringify(map); undoStack.length = redoStack.length = 0; sel = null;
  if (![...$('mapSel').options].some(o => o.value === id)) $('mapSel').appendChild(new Option(`${id} (새 맵)`, id));
  $('mapSel').value = id;
  rebuildNow(); drawHelpers(); renderPanel();
  overview();
}

let flashT = 0;
function flash(text) { const f = $('flash'); f.textContent = text; f.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { f.hidden = true; }, 2600); }

// ───────── 시작 ─────────
$('mapSel').addEventListener('change', () => openMap($('mapSel').value));
$('newMap').addEventListener('click', newMap);
$('save').addEventListener('click', save);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('top').addEventListener('click', topView);
$('snapSel').addEventListener('change', () => setSnap(Number($('snapSel').value)));
$('play').addEventListener('click', play);
for (const m of Object.values(MODES)) $('playMode').appendChild(new Option(m.name, m.id));
addEventListener('beforeunload', e => { if (map && isDirty()) e.preventDefault(); });

buildPalette();
resize();
await loadMapList();
await openMap(new URLSearchParams(location.search).get('map') || mapIds[0]);

let lastT = performance.now();
renderer.setAnimationLoop(t => {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  moveCamera(dt);
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
});
showCoords();

// 자동 테스트용
window.__ed = { get map() { return map; }, get sel() { return sel; }, get errors() { return lastErrors; }, isDirty, save, undo, redo, setTool, place, select: s => { sel = s; drawSelection(); renderPanel(); }, moveTo: (dx, dz) => { moveTo(JSON.parse(JSON.stringify(selected())), dx, dz); rebuildNow(); commit(); renderPanel(); }, removeSelected, rotateSelected, duplicateSelected, rebuildNow, openMap, camera, controls, get snap() { return snapStep; }, get clipboard() { return clipboard; } };
