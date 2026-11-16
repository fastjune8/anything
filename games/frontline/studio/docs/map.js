// 맵 문서: content/maps/<id>.json 을 고친다.
// 게임과 같은 코드(shared/maps/build.js 로 펼치고 client/js/world.js 로 그림)를 쓰므로 보이는 그대로 게임에 나온다.
// 조작은 유니티·언리얼과 비슷하다 (왼쪽 도구 패널 아래 도움말 참고).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from '/js/world.js';
import { expandObject, buildLayout, OBJECT_TYPES } from '/shared/maps/build.js';
import { OBJECT_SCHEMAS, objectSpec, ZONE, checkMap, MATERIALS } from '/shared/content/schema.js';
import { MODES } from '/shared/modes.js';
import { buildForm } from '../form.js';
import { formDialog } from '../dialog.js';

const r2 = v => Math.round(v * 100) / 100;
const TEAM_COLOR = { '-1': 0xe9ecef, 0: 0x5aa9ff, 1: 0xff4b3a };
const TEAM_NAME = { '-1': '개인전 스폰', 0: '0팀 스폰', 1: '1팀 스폰' };
const MAP_FIELDS = { fields: { name: { kind: 'str', label: '이름' }, half: { kind: 'num', label: '맵 절반 크기 (m)', min: 10, max: 250, step: 1, hint: '외곽 벽은 따로 옮겨야 한다' } } };
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);

function html(tag, cls, inner) { const e = document.createElement(tag); if (cls) e.className = cls; if (inner) e.innerHTML = inner; return e; }
export class Cancelled extends Error {}

// 새 맵 기본 내용: 외곽 벽 4개, 스폰, 가운데 거점
export function newMapDef(id, name, h = 40) {
  const wall = (x, z, w, d) => ({ type: 'box', x, y: 0, z, w, h: 4.5, d, mat: 'concrete' });
  return {
    id, name, half: h,
    spawns: { ffa: [[-30, -30], [30, 30], [-30, 30], [30, -30]], team: [[[-4, 34], [0, 35], [4, 34]], [[-4, -34], [0, -35], [4, -34]]] },
    zones: [{ id: 'A', name: '거점 A', x: 0, z: 0, r: 6 }],
    objects: [wall(0, -h - 0.5, 2 * h + 2, 1), wall(0, h + 0.5, 2 * h + 2, 1), wall(-h - 0.5, 0, 1, 2 * h), wall(h + 0.5, 0, 1, 2 * h)],
  };
}

export async function createMapDoc(ctx, id, opts = {}) {
  const { canvas, renderer } = ctx;
  let map, saved;
  if (opts.create) { // 새 맵: id 와 이름을 묻는다
    const nid = (prompt('새 맵 id (영문 소문자·숫자·_, 파일 이름이 됩니다)') || '').trim();
    if (!nid) throw new Cancelled();
    if (!/^[a-z0-9_]+$/.test(nid)) { alert('영문 소문자, 숫자, _ 만 쓸 수 있습니다.'); throw new Cancelled(); }
    if (ctx.assets().maps.includes(nid)) { alert('이미 있는 id 입니다. 목록에서 여세요.'); throw new Cancelled(); }
    const name = (prompt('맵 이름', nid) || nid).trim();
    map = newMapDef(nid, name); saved = '';
  } else {
    const res = await fetch(`/content/maps/${id}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`content/maps/${id}.json 을 읽을 수 없음`);
    map = await res.json(); map.zones = map.zones || []; saved = JSON.stringify(map);
  }

  // ───────── 화면 조각 ─────────
  const overlay = html('div', '', '<div class="hint" data-r="hint"></div><div class="errors" data-r="errors" hidden></div><div class="coords" data-r="coords"></div>');
  const tools = html('div', '', '<div data-r="palette"></div>');
  const toolbar = html('div', '', `<span class="grp"><button type="button" data-r="undo" title="되돌리기 (⌘Z)">↶</button><button type="button" data-r="redo" title="다시 하기 (⌘⇧Z)">↷</button></span>
    <span class="grp"><span class="gl">보기</span><button type="button" data-r="top" title="위에서 보기 (T)">위에서</button><button type="button" data-r="all" title="맵 전체 보기 (Home)">전체</button>
      <span class="gl">격자</span><select data-r="snap" title="격자 (G 로 켜기/끄기)"><option value="0">끔</option><option value="0.25">0.25m</option><option value="0.5" selected>0.5m</option><option value="1">1m</option><option value="2">2m</option></select></span>
    <span class="grow"></span>
    <span class="grp"><span class="status" data-r="status"></span><button type="button" class="primary" data-r="save" title="저장 (⌘S)">저장</button></span>
    <span class="sep"></span>
    <span class="grp"><select data-r="playMode" title="시험 플레이 모드"></select>
      <label class="chk" title="빈자리를 봇으로 채운다"><input type="checkbox" data-r="playBots" checked> 봇</label>
      <label class="chk" title="지금 보고 있는 곳(화면 가운데)에서 태어난다"><input type="checkbox" data-r="playHere"> 여기서 시작</label>
      <button type="button" class="primary" data-r="play" title="저장하지 않아도 지금 모습 그대로 화면 안에서 플레이 (⌘P)">▶ 플레이</button></span>`);
  const inspector = html('div', '');
  const r = name => overlay.querySelector(`[data-r="${name}"]`) || tools.querySelector(`[data-r="${name}"]`) || toolbar.querySelector(`[data-r="${name}"]`);
  for (const m of Object.values(MODES)) r('playMode').appendChild(new Option(m.name, m.id));

  // ───────── 3D ─────────
  const scene = new THREE.Scene();
  const world = buildWorld(scene, renderer);
  scene.fog.density = 0.0015; // 위에서 내려다보므로 안개를 옅게
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, canvas);
  controls.disconnect(); // 이 문서가 화면에 나올 때만 연결
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
  controls.zoomToCursor = true;
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.screenSpacePanning = false;

  const pickGroup = new THREE.Group(), markGroup = new THREE.Group(), selGroup = new THREE.Group(), helpGroup = new THREE.Group();
  scene.add(pickGroup, markGroup, selGroup, helpGroup);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const edgeGeo = new THREE.EdgesGeometry(unitBox);
  const selMat = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true });
  const selMirrorMat = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true, opacity: 0.35 });

  // ───────── 상태 ─────────
  let sel = null;   // { kind: 'obj', i } | { kind: 'spawn', team, i } | { kind: 'zone', i } | null(맵 설정)
  let tool = null;  // { kind: 'obj', type } | { kind: 'spawn', team } | { kind: 'zone' } | null
  let snap = JSON.stringify(map);
  const undoStack = [], redoStack = [];
  let lastErrors = [];
  // 팔레트(그리기 설정): 새로 그리는 물체에 쓴다
  const brush = { mat: 'concrete', wallH: 2.8, wallT: 0.35, boxH: 1.2, tint: '', roof: true, sym: false, scatter: 'crate', spacing: 2.5 };
  // 프리팹: 물체 묶음 (content/prefabs.json, 팀과 git 으로 공유)
  let prefabs = await fetch('/content/prefabs.json', { cache: 'no-store' }).then(x => (x.ok ? x.json() : [])).catch(() => []);
  let gesture = null;     // 끌어서 그리는 중: { kind: 'draw'|'marquee', what, start, end } · 흩뿌리기: { kind: 'scatter', last, made }
  let lastWallEnd = null; // 벽을 이어 그릴 때 시작점이 여기에 붙는다
  const previewGroup = new THREE.Group(); scene.add(previewGroup);
  const previewMat = new THREE.MeshBasicMaterial({ color: 0xffb43a, transparent: true, opacity: 0.35, depthWrite: false });
  const previewLine = new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false });

  function drawHelpers() {
    for (const c of [...helpGroup.children]) { helpGroup.remove(c); if (c.geometry) c.geometry.dispose(); }
    const size = map.half * 2;
    const g1 = new THREE.GridHelper(size, Math.round(size), 0x000000, 0x000000); g1.material.opacity = 0.08; g1.material.transparent = true; g1.position.y = 0.02;
    const g5 = new THREE.GridHelper(size, Math.round(size / 5), 0x000000, 0x000000); g5.material.opacity = 0.2; g5.material.transparent = true; g5.position.y = 0.03;
    const h = map.half, pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => new THREE.Vector3(x, 0.05, z));
    helpGroup.add(g1, g5, new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb43a })));
  }

  // 맵 전체를 다시 그린다 (박스 수백 개라 매번 새로 만들어도 충분히 빠르다)
  let rebuildQueued = false;
  function rebuild() { if (!rebuildQueued) { rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuildNow(); }); } }
  function rebuildNow() {
    world.setMap(buildLayout(map));
    pickGroup.clear();
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
    drawMarkers(); drawSelection(); validate(); updateStatus();
  }

  function drawMarkers() {
    for (const c of [...markGroup.children]) { markGroup.remove(c); if (c.geometry) c.geometry.dispose(); }
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
    selGroup.clear();
    if (!sel) return;
    if (sel.kind === 'obj' || sel.kind === 'multi') {
      const ids = new Set(sel.kind === 'multi' ? sel.list : [sel.i]);
      for (const m of pickGroup.children) {
        if (!ids.has(m.userData.i)) continue;
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
  function commit() {
    const now = JSON.stringify(map);
    if (now === snap) return;
    undoStack.push(snap); if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0; snap = now;
    updateStatus(); ctx.changed();
  }
  function restore(text) {
    map = JSON.parse(text); snap = text;
    if (sel && !selected()) sel = null;
    rebuildNow(); drawHelpers(); renderPanel(); ctx.changed();
  }
  const undo = () => { if (undoStack.length) { redoStack.push(snap); restore(undoStack.pop()); } };
  const redo = () => { if (redoStack.length) { undoStack.push(snap); restore(redoStack.pop()); } };

  // 선택한 것의 실제 데이터 (여러 개면 물체 목록)
  function selected() {
    if (!sel) return null;
    if (sel.kind === 'obj') return map.objects[sel.i] || null;
    if (sel.kind === 'multi') { const l = sel.list.map(i => map.objects[i]); return l.every(Boolean) ? l : null; }
    if (sel.kind === 'zone') return (map.zones || [])[sel.i] || null;
    if (sel.kind === 'spawn') { const list = sel.team < 0 ? map.spawns.ffa : (map.spawns.team || [])[sel.team]; return (list && list[sel.i]) || null; }
    return null;
  }
  const clone = v => JSON.parse(JSON.stringify(v));
  const anchorOf = o => OBJECT_TYPES[o.type].anchor(o);
  // 여러 개를 고른 상태로 (하나면 그냥 그 물체, 없으면 선택 없음)
  function selectList(list) {
    list = [...new Set(list)].sort((x, y) => x - y);
    sel = !list.length ? null : list.length === 1 ? { kind: 'obj', i: list[0] } : { kind: 'multi', list };
    drawSelection(); renderPanel();
  }
  const selIndices = () => (!sel ? [] : sel.kind === 'obj' ? [sel.i] : sel.kind === 'multi' ? sel.list : []);
  function spawnList(team) {
    if (team < 0) return map.spawns.ffa;
    if (!map.spawns.team) map.spawns.team = [[], []];
    return map.spawns.team[team];
  }

  // 물체 하나 옮기기: orig(옮기기 시작할 때의 복사본) 에서 (dx, dz) 만큼
  function moveObj(o, orig, dx, dz) {
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
  // 선택한 것 옮기기 (orig = 옮기기 시작할 때의 selected() 복사본)
  function moveTo(orig, dx, dz) {
    if (sel.kind === 'spawn') { spawnList(sel.team)[sel.i] = [r2(orig[0] + dx), r2(orig[1] + dz)]; return; }
    if (sel.kind === 'multi') { sel.list.forEach((i, k) => moveObj(map.objects[i], orig[k], dx, dz)); return; }
    moveObj(selected(), orig, dx, dz);
  }

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
      const zid = 'ABCDEFGH'.split('').find(c => !ids.has(c)) || `Z${map.zones.length}`;
      map.zones.push({ id: zid, name: `거점 ${zid}`, x, z, r: 6 }); sel = { kind: 'zone', i: map.zones.length - 1 };
    }
    rebuildNow(); commit(); renderPanel();
  }
  // 물체 여러 개 추가 (그리기·흩뿌리기·프리팹·붙여넣기). 추가한 것을 고른다
  function addObjects(list) {
    const from = map.objects.length;
    map.objects.push(...list);
    rebuildNow(); selectList(list.map((_, k) => from + k)); commit();
  }
  function removeSelected() {
    if (!sel) return;
    if (sel.kind === 'obj' || sel.kind === 'multi') for (const i of [...selIndices()].sort((x, y) => y - x)) map.objects.splice(i, 1);
    else if (sel.kind === 'zone') map.zones.splice(sel.i, 1);
    else if (sel.kind === 'spawn') spawnList(sel.team).splice(sel.i, 1);
    sel = null; rebuildNow(); commit(); renderPanel();
  }
  function duplicateSelected() {
    const idx = selIndices();
    if (!idx.length) return;
    addObjects(idx.map(i => { const c = clone(map.objects[i]); moveObj(c, clone(c), 2, 2); return c; }));
  }
  // 90° 회전: 하나면 제자리에서, 여러 개면 묶음 가운데를 축으로 (배치까지 같이 돈다)
  function rotateSelected() {
    const idx = selIndices();
    if (!idx.length) return;
    const objs = idx.map(i => map.objects[i]), anchors = objs.map(anchorOf);
    const cx = anchors.reduce((s2, a) => s2 + a[0], 0) / anchors.length, cz = anchors.reduce((s2, a) => s2 + a[1], 0) / anchors.length;
    objs.forEach((o, k) => {
      if (objs.length > 1) { const [ax, az] = anchors[k]; moveObj(o, clone(o), r2(cx - (az - cz) - ax), r2(cz + (ax - cx) - az)); } // build.js 의 회전과 같은 방향
      const rot = ((o.rot || 0) + 90) % 360;
      if (rot) o.rot = rot; else delete o.rot;
    });
    rebuildNow(); commit(); renderPanel();
  }

  // ───────── 마우스 ─────────
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let snapStep = 0.5, lastSnap = 0.5, cursor = null;
  function aim(e) {
    const b = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  const snapV = v => (snapStep ? Math.round(v / snapStep) * snapStep : r2(v));
  function groundPoint(e) { aim(e); return ray.ray.intersectPlane(ground, hit) ? [snapV(hit.x), snapV(hit.z)] : null; }
  function pick(e) {
    aim(e);
    const m = ray.intersectObjects(markGroup.children, false)[0] || ray.intersectObjects(pickGroup.children, false)[0];
    return m ? m.object.userData : null;
  }

  const look = new THREE.Euler(0, 0, 0, 'YXZ');
  let fly = null, flySpeed = 20, orbiting = false;
  function startFly() { fly = { dist: Math.max(5, camera.position.distanceTo(controls.target)) }; controls.enabled = false; look.setFromQuaternion(camera.quaternion, 'YXZ'); }
  function endFly() {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(fwd, fly.dist);
    fly = null; controls.enabled = true; controls.update();
  }
  function orbitBy(dYaw, dPitch) {
    const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
    s.theta += dYaw; s.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, s.phi + dPitch));
    camera.position.copy(controls.target).add(off.setFromSpherical(s));
    camera.lookAt(controls.target);
  }

  // ───────── 그리기 도구 ─────────
  const symOpt = () => (brush.sym ? { sym: true } : {});
  // 끈 두 점 → 만들 물체 (그리기 설정 반영). 너무 작으면 null
  function drawnObject(what, a, b) {
    if (what === 'wall') { // 벽: 더 많이 끈 방향(동서/남북)으로 곧게
      const dx = b[0] - a[0], dz = b[1] - a[1];
      if (Math.hypot(dx, dz) < 0.5) return null;
      const base = { type: 'wall', h: brush.wallH, t: brush.wallT, mat: brush.mat, ops: [], ...symOpt() };
      return Math.abs(dx) >= Math.abs(dz) ? { ...base, axis: 'x', at: a[1], from: Math.min(a[0], b[0]), to: Math.max(a[0], b[0]) }
        : { ...base, axis: 'z', at: a[0], from: Math.min(a[1], b[1]), to: Math.max(a[1], b[1]) };
    }
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    const w = r2(x1 - x0), d = r2(z1 - z0), cx = r2((x0 + x1) / 2), cz = r2((z0 + z1) / 2);
    if (what === 'box') return w < 0.2 || d < 0.2 ? null : { type: 'box', x: cx, y: 0, z: cz, w, h: brush.boxH, d, mat: brush.mat, ...(brush.tint ? { tint: brush.tint } : {}), ...symOpt() };
    if (what === 'building') return w < 3 || d < 3 ? null : { type: 'building', x: cx, z: cz, w, d, h: Math.max(2.5, brush.wallH), mat: brush.mat, roof: brush.roof, ops: { n: [], s: [{ at: cx, w: 1.6, type: 'door' }], e: [], w: [] }, ...symOpt() };
    return null;
  }
  // 그리는 중인 모양을 반투명으로 (영역 선택은 테두리)
  function showPreview() {
    previewGroup.clear();
    if (!gesture) return;
    if (gesture.kind === 'marquee') {
      const [a, b] = [gesture.start, gesture.end], y = 0.12;
      const pts = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map(([x, z]) => new THREE.Vector3(x, y, z));
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), previewLine); loop.renderOrder = 12;
      previewGroup.add(loop); return;
    }
    const o = gesture.kind === 'draw' && drawnObject(gesture.what, gesture.start, gesture.end);
    if (!o) return;
    for (const b of expandObject(o).boxes) {
      const m = new THREE.Mesh(unitBox, previewMat); m.scale.set(b.w, b.h, b.d); m.position.set(b.x, b.y + b.h / 2, b.z); previewGroup.add(m);
    }
    const len = o.type === 'wall' ? r2(o.to - o.from) : null;
    r('hint').textContent = o.type === 'wall' ? `벽 ${len}m · 높이 ${o.h}m` : `${OBJECT_SCHEMAS[o.type].label} ${o.w} × ${o.d}m`;
  }
  // 흩뿌리기: 끄는 길을 따라 일정 간격으로 (크기·방향은 조금씩 다르게)
  const SCATTER = { crate: '상자', barrel: '드럼통', tree: '나무', sandbags: '모래주머니', barrier: '콘크리트 방벽' };
  const TINTS = ['#7a2a1e', '#35506b', '#4a5a32', '#596066'];
  function scatterAt(p) {
    const rnd = (a, b) => r2(a + Math.random() * (b - a)), axis = Math.random() < 0.5 ? 'x' : 'z', [x, z] = p;
    const o = { crate: { type: 'crate', x, z, s: rnd(0.9, 1.4) }, barrel: { type: 'barrel', x, z, tint: TINTS[(Math.random() * TINTS.length) | 0] },
      tree: { type: 'tree', x, z, s: rnd(0.8, 1.3) }, sandbags: { type: 'sandbags', x, z, len: rnd(3, 5), axis }, barrier: { type: 'barrier', x, z, axis } }[brush.scatter];
    map.objects.push({ ...o, ...symOpt() }); gesture.made.push(map.objects.length - 1); rebuild();
  }
  function finishGesture() {
    const g = gesture; gesture = null; previewGroup.clear(); setTool(tool); // 안내 문구 되돌리기
    if (g.kind === 'scatter') { if (g.made.length) { rebuildNow(); selectList(g.made); commit(); } return; }
    if (g.kind === 'marquee') { // 영역 안에 기준점이 있는 물체를 고른다 (Shift = 더하기)
      const x0 = Math.min(g.start[0], g.end[0]), x1 = Math.max(g.start[0], g.end[0]), z0 = Math.min(g.start[1], g.end[1]), z1 = Math.max(g.start[1], g.end[1]);
      const hit = map.objects.map((o, i) => [anchorOf(o), i]).filter(([[x, z]]) => x >= x0 && x <= x1 && z >= z0 && z <= z1).map(([, i]) => i);
      selectList(g.add ? [...selIndices(), ...hit] : hit);
      if (hit.length) ctx.log(`${selIndices().length}개 골랐습니다`);
      return;
    }
    const o = drawnObject(g.what, g.start, g.end);
    if (!o) return;
    if (o.type === 'wall') lastWallEnd = o.axis === 'x' ? [g.end[0], g.start[1]] : [g.start[0], g.end[1]]; // 다음 벽은 여기서 이어 그릴 수 있다
    addObjects([o]);
  }

  // ───────── 프리팹 ─────────
  async function saveAsPrefab() {
    const idx = selIndices();
    if (!idx.length) return;
    const v = await formDialog({
      title: '프리팹으로 저장', ok: '저장',
      lead: `고른 물체 ${idx.length}개를 묶어 팔레트에 저장합니다. 어느 맵에서든 클릭 한 번으로 찍을 수 있습니다 (content/prefabs.json — git 으로 팀과 공유).`,
      fields: [{ key: 'id', label: 'id', required: true, pattern: '^[a-z][a-z0-9_]*$', hint: '영문 소문자로 시작, 소문자·숫자·_', placeholder: '예: checkpoint' },
        { key: 'name', label: '이름', required: true, placeholder: '예: 검문소' }],
      validate: x => (prefabs.some(p => p.id === x.id) ? `id "${x.id}" 는 이미 있습니다` : null),
    });
    if (!v) return;
    const objs = idx.map(i => clone(map.objects[i])), an = objs.map(anchorOf);
    const cx = snapV(an.reduce((a, p) => a + p[0], 0) / an.length), cz = snapV(an.reduce((a, p) => a + p[1], 0) / an.length);
    const rel = objs.map(o => { const c = clone(o); moveObj(c, clone(o), -cx, -cz); delete c.sym; return c; }); // 가운데를 (0, 0) 으로, 대칭은 찍을 때 정한다
    if (await savePrefabs([...prefabs, { id: v.id, name: v.name, objects: rel }])) ctx.log(`프리팹 저장: ${v.name} (${v.id}, 물체 ${rel.length}개) — 팔레트의 "프리팹" 에서 찍을 수 있습니다`, 'ok');
  }
  async function savePrefabs(next) {
    const res = await fetch('/api/content/prefabs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
    if (!out.ok) { ctx.log(`프리팹 저장 실패: ${(out.errors || []).join(' / ')}`, 'error'); ctx.flash('프리팹 저장 실패'); return false; }
    prefabs = next; renderPrefabs(); return true;
  }
  function stampPrefab(id, x, z) {
    const pf = prefabs.find(p => p.id === id);
    if (pf) addObjects(pf.objects.map(o => { const c = clone(o); moveObj(c, clone(o), x, z); return { ...c, ...symOpt() }; }));
  }

  let drag = null;
  const listeners = [
    ['pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2) { startFly(); return; }
      if (e.button !== 0) return;
      if (e.altKey) { orbiting = true; controls.enabled = false; return; }
      const p = groundPoint(e);
      if (tool) {
        if (!p) return;
        if (tool.kind === 'draw') { // 끌어서 그리기. 벽은 앞 벽 끝 근처에서 시작하면 거기에 붙는다
          const a = tool.what === 'wall' && lastWallEnd && Math.hypot(p[0] - lastWallEnd[0], p[1] - lastWallEnd[1]) < 1.2 ? lastWallEnd : p;
          gesture = { kind: 'draw', what: tool.what, start: a, end: a }; showPreview(); return;
        }
        if (tool.kind === 'marquee') { gesture = { kind: 'marquee', start: p, end: p, add: e.shiftKey }; showPreview(); return; }
        if (tool.kind === 'scatter') { gesture = { kind: 'scatter', last: p, made: [] }; scatterAt(p); return; }
        if (tool.kind === 'prefab') { stampPrefab(tool.id, p[0], p[1]); if (!e.shiftKey) setTool(null); return; }
        place(p[0], p[1]); if (!e.shiftKey) setTool(null); return; // Shift 를 누르고 있으면 계속 놓기
      }
      const u = pick(e);
      if (e.shiftKey && u && u.kind === 'obj') { const cur = selIndices(); selectList(cur.includes(u.i) ? cur.filter(i => i !== u.i) : [...cur, u.i]); return; } // Shift+클릭 = 더하기/빼기
      if (sel && sel.kind === 'multi' && u && u.kind === 'obj' && sel.list.includes(u.i)) { if (p) drag = { start: p, orig: clone(selected()), mirror: !!u.mirror, moved: false }; return; } // 고른 묶음 끌기
      sel = u ? (u.kind === 'spawn' ? { kind: 'spawn', team: u.team, i: u.i } : { kind: u.kind, i: u.i }) : null;
      drawSelection(); renderPanel();
      if (u && p) drag = { start: p, orig: JSON.parse(JSON.stringify(selected())), mirror: !!u.mirror, moved: false };
    }],
    ['pointermove', e => {
      if (fly) { look.y -= e.movementX * 0.0028; look.x = Math.max(-1.5, Math.min(1.5, look.x - e.movementY * 0.0028)); camera.quaternion.setFromEuler(look); return; }
      if (orbiting) { orbitBy(-e.movementX * 0.006, -e.movementY * 0.006); return; }
      const p = groundPoint(e);
      cursor = p; showCoords();
      if (gesture) {
        if (!p) return;
        if (gesture.kind === 'scatter') { if (Math.hypot(p[0] - gesture.last[0], p[1] - gesture.last[1]) >= brush.spacing) { gesture.last = p; scatterAt(p); } return; }
        gesture.end = p; showPreview(); return;
      }
      if (!drag) { if (!tool) canvas.style.cursor = pick(e) ? 'pointer' : 'default'; return; }
      if (!p) return;
      let dx = p[0] - drag.start[0], dz = p[1] - drag.start[1];
      if (drag.mirror) { dx = -dx; dz = -dz; } // 대칭 복사본을 끌면 원본은 반대로 움직인다
      if (!dx && !dz && !drag.moved) return;
      drag.moved = true;
      moveTo(drag.orig, dx, dz); rebuild();
    }],
    ['pointerup', e => {
      if (e.button === 2 && fly) { endFly(); return; }
      if (orbiting) { orbiting = false; controls.enabled = true; controls.update(); return; }
      if (gesture) { finishGesture(); return; }
      if (drag && drag.moved) { commit(); renderPanel(); }
      drag = null;
    }],
    ['wheel', e => {
      if (!fly) return;
      e.preventDefault();
      flySpeed = Math.min(200, Math.max(2, flySpeed * (e.deltaY < 0 ? 1.25 : 0.8)));
      showCoords(`비행 속도 ${flySpeed.toFixed(0)} m/s`);
    }, { passive: false }],
    ['dblclick', () => focusSelected()],
    ['contextmenu', e => e.preventDefault()],
  ];

  // ───────── 키보드 (스튜디오가 넘겨준다) ─────────
  const held = new Set();
  let clipboard = null;
  function onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;
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
      case 'Escape': gesture = null; previewGroup.clear(); lastWallEnd = null; setTool(null); sel = null; drawSelection(); renderPanel(); break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); nudge(e.code, e.shiftKey); break;
    }
  }

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Vector3();
  function moveCamera(dt) {
    const k = c => (held.has(c) ? 1 : 0);
    const fast = k('ShiftLeft') || k('ShiftRight') ? 3 : 1;
    const fwd = k('KeyW') - k('KeyS'), side = k('KeyD') - k('KeyA'), updown = k('KeyE') - k('KeyQ');
    camera.getWorldDirection(_f);
    if (fly) {
      _r.crossVectors(_f, camera.up).normalize();
      _m.set(0, 0, 0).addScaledVector(_f, fwd).addScaledVector(_r, side).addScaledVector(camera.up, updown);
      if (_m.lengthSq()) camera.position.addScaledVector(_m.normalize(), flySpeed * fast * dt);
      return;
    }
    if (fwd || side) {
      _f.y = 0; _f.normalize(); _r.set(-_f.z, 0, _f.x);
      const dist = camera.position.distanceTo(controls.target);
      _m.set(0, 0, 0).addScaledVector(_f, fwd).addScaledVector(_r, side).normalize().multiplyScalar(Math.max(10, dist * 0.9) * fast * dt);
      camera.position.add(_m); controls.target.add(_m);
    }
    if (updown) orbitBy(-updown * 1.5 * fast * dt, 0);
  }

  function nudge(code, big) {
    const o = selected();
    if (!o) return;
    camera.getWorldDirection(_f); _f.y = 0;
    const alongX = Math.abs(_f.x) > Math.abs(_f.z);
    const fx = alongX ? Math.sign(_f.x) : 0, fz = alongX ? 0 : Math.sign(_f.z);
    const rx = -fz, rz = fx;
    const step = (snapStep || 0.1) * (big ? 4 : 1);
    const [u, s] = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[code];
    moveTo(JSON.parse(JSON.stringify(o)), r2((fx * u + rx * s) * step), r2((fz * u + rz * s) * step));
    rebuildNow(); commit(); renderPanel();
  }
  function copySelected() {
    const idx = selIndices();
    if (!idx.length) return;
    clipboard = idx.map(i => clone(map.objects[i]));
    ctx.flash(`${idx.length}개 복사했습니다 — ⌘V 로 마우스 위치에 붙여넣기`);
  }
  function paste() { // 묶음 가운데가 마우스 위치에 오도록
    if (!clipboard) return;
    const an = clipboard.map(anchorOf), ax = an.reduce((a, p) => a + p[0], 0) / an.length, az = an.reduce((a, p) => a + p[1], 0) / an.length;
    const [tx, tz] = cursor || [ax + 2, az + 2], dx = r2(snapV(tx) - snapV(ax)), dz = r2(snapV(tz) - snapV(az));
    addObjects(clipboard.map(o => { const c = clone(o); moveObj(c, clone(o), dx, dz); return c; }));
  }
  function setSnap(v) { snapStep = v; if (v) lastSnap = v; r('snap').value = String(v); showCoords(); }
  function showCoords(extra) {
    const c = cursor ? `x ${cursor[0].toFixed(1)} · z ${cursor[1].toFixed(1)}` : '';
    r('coords').textContent = [c, `격자 ${snapStep ? snapStep + 'm' : '끔'} (G)`, extra || (fly ? `비행 속도 ${flySpeed.toFixed(0)} m/s (휠)` : '')].filter(Boolean).join('  ·  ');
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

  // ───────── 도구 패널 / 속성 / 검사 ─────────
  const toolKey = t => ({ obj: `obj:${t.type}`, spawn: `spawn:${t.team}`, zone: 'zone', draw: `draw:${t.what}`, marquee: 'marquee', scatter: 'scatter', prefab: `prefab:${t.id}` }[t.kind]);
  const HINT = {
    obj: '바닥을 클릭해 놓기 · Shift+클릭 = 계속 놓기 · Esc = 취소', spawn: '바닥을 클릭해 놓기 · Shift+클릭 = 계속 놓기', zone: '바닥을 클릭해 놓기',
    'draw:wall': '바닥을 끌어 벽 그리기 (곧게 동서/남북) · 앞 벽 끝에서 시작하면 이어진다 · Esc = 그만',
    'draw:box': '바닥을 끌어 사각형 박스 그리기 (높이·재질은 그리기 설정) · Esc = 그만',
    'draw:building': '바닥을 끌어 건물 그리기 (3m 이상, 남쪽 벽에 문) · Esc = 그만',
    scatter: '바닥을 끌면 지나간 길에 일정 간격으로 흩뿌린다 · Esc = 그만',
    marquee: '끌어서 영역 안의 물체를 고르기 · Shift = 더하기 · 고른 뒤 끌기/방향키/R/⌘D/Del',
    prefab: '바닥을 클릭해 프리팹 찍기 · Shift+클릭 = 계속 찍기',
  };
  function setTool(t) {
    tool = t;
    for (const b of r('palette').querySelectorAll('.tile')) b.classList.toggle('on', !!t && b.dataset.tool === toolKey(t));
    canvas.style.cursor = t ? 'crosshair' : 'default';
    r('hint').textContent = t ? HINT[toolKey(t)] || HINT[t.kind] || '' : '';
    if (!t || t.kind !== 'draw') lastWallEnd = null;
  }
  // 도구 상자: 묶음별 타일 (묶음 제목을 누르면 접힌다)
  const ICON = { building: '⌂', wall: '▬', box: '■', container: '▤', crate: '▣', sandbags: '≋', barrier: '▭', barrel: '◍', tower: '♜', tree: '♣' };
  const GROUPS = [['구조물', ['building', 'wall', 'box']], ['엄폐물', ['container', 'crate', 'sandbags', 'barrier', 'barrel']], ['자연 · 기타', ['tree', 'tower']]];
  // 도구 상자: 그리기 → 그리기 설정(팔레트) → 하나씩 놓기 → 프리팹 → 스폰 → 모드
  const pal = r('palette');
  function tileGroup(title, items, open = true) {
    const h = html('div', `tbx-h${open ? '' : ' shut'}`); h.textContent = title; h.addEventListener('click', () => h.classList.toggle('shut'));
    const tiles = html('div', 'tiles');
    for (const [label, icon, t, color, tip] of items) {
      const b = html('button', 'tile'); b.type = 'button'; b.dataset.tool = toolKey(t); b.title = tip || `${label} 놓기 — 바닥을 클릭`;
      const ic = html('span', 'ic'); ic.textContent = icon; if (color) ic.style.color = color;
      b.append(ic, document.createTextNode(label));
      b.addEventListener('click', () => setTool(tool && toolKey(tool) === toolKey(t) ? null : t));
      tiles.appendChild(b);
    }
    pal.append(h, tiles);
    return tiles;
  }
  tileGroup('그리기', [
    ['벽', '✎', { kind: 'draw', what: 'wall' }, '#ffb43a', '벽 그리기 — 바닥을 끌기'], ['박스', '▭', { kind: 'draw', what: 'box' }, '#ffb43a', '사각형 박스 그리기 — 바닥을 끌기'],
    ['건물', '⌂', { kind: 'draw', what: 'building' }, '#ffb43a', '건물 그리기 — 바닥을 끌기'], ['흩뿌리기', '✿', { kind: 'scatter' }, '#ffb43a', '흩뿌리기 — 끄는 길을 따라'],
    ['영역 선택', '⬚', { kind: 'marquee' }, '#ffd23a', '영역 선택 — 끌어서 여러 개 고르기'],
  ]);
  // 그리기 설정 (팔레트)
  (function brushPanel() {
    const h = html('div', 'tbx-h'); h.textContent = '그리기 설정'; h.addEventListener('click', () => h.classList.toggle('shut'));
    const box = html('div', 'brush');
    const row = (label, input) => { const l = html('label', 'kv'); l.style.gridTemplateColumns = '64px 1fr'; l.append(document.createTextNode(label), input); box.appendChild(l); return input; };
    const num = (key, min, max, step) => { const i = html('input'); i.type = 'number'; i.min = min; i.max = max; i.step = step; i.value = brush[key]; i.dataset.b = key; i.addEventListener('input', () => { const v = Number(i.value); if (Number.isFinite(v) && v >= min && v <= max) brush[key] = v; }); return i; };
    const mat = html('select'); for (const m of MATERIALS) mat.appendChild(new Option(m, m)); mat.value = brush.mat; mat.dataset.b = 'mat';
    mat.addEventListener('change', () => { brush.mat = mat.value; });
    row('재질', mat); row('벽 높이', num('wallH', 0.5, 20, 0.1)); row('벽 두께', num('wallT', 0.1, 3, 0.05)); row('박스 높이', num('boxH', 0.2, 20, 0.1));
    const colorWrap = html('span', 'in'), color = html('input'), useColor = html('input');
    color.type = 'color'; color.value = '#888888'; useColor.type = 'checkbox'; useColor.title = '박스에 색 입히기';
    const syncColor = () => { brush.tint = useColor.checked ? color.value : ''; };
    color.addEventListener('input', () => { useColor.checked = true; syncColor(); }); useColor.addEventListener('change', syncColor);
    colorWrap.append(useColor, color); row('박스 색', colorWrap);
    const sc = html('select'); for (const [k, v] of Object.entries(SCATTER)) sc.appendChild(new Option(v, k)); sc.value = brush.scatter; sc.dataset.b = 'scatter';
    sc.addEventListener('change', () => { brush.scatter = sc.value; });
    row('흩뿌릴 것', sc); row('간격 (m)', num('spacing', 0.5, 20, 0.5));
    const tog = (label, key, tip) => { const l = html('label', 'tog'), c = html('input'); c.type = 'checkbox'; c.checked = brush[key]; c.dataset.b = key; c.addEventListener('change', () => { brush[key] = c.checked; }); l.title = tip; l.append(c, document.createTextNode(label)); box.appendChild(l); };
    tog('건물 지붕', 'roof', '건물 그리기에 지붕을 덮는다'); tog('반대편에도 (대칭)', 'sym', '그리는 것마다 맵 중심 반대편에도 하나 더');
    pal.append(h, box);
  })();
  for (const [title, types] of GROUPS) tileGroup(title, types.filter(t => OBJECT_SCHEMAS[t]).map(t => [OBJECT_SCHEMAS[t].label, ICON[t] || '■', { kind: 'obj', type: t }]), false);
  // 프리팹 (저장한 물체 묶음)
  const prefabHead = html('div', 'tbx-h'); prefabHead.textContent = '프리팹'; prefabHead.addEventListener('click', () => prefabHead.classList.toggle('shut'));
  const prefabBox = html('div'); pal.append(prefabHead, prefabBox);
  function renderPrefabs() {
    prefabBox.replaceChildren();
    if (!prefabs.length) { prefabBox.appendChild(Object.assign(html('p', 'note'), { textContent: '아직 없습니다. 물체를 여러 개 고르고(영역 선택) 오른쪽에서 "프리팹으로 저장".' })); return; }
    const tiles = html('div', 'tiles');
    for (const pf of prefabs) {
      const t = { kind: 'prefab', id: pf.id };
      const b = html('button', `tile${tool && toolKey(tool) === toolKey(t) ? ' on' : ''}`); b.type = 'button'; b.dataset.tool = toolKey(t); b.title = `${pf.name} (물체 ${pf.objects.length}개) — 바닥을 클릭해 찍기 · 우클릭 = 삭제`;
      b.append(Object.assign(html('span', 'ic'), { textContent: '❖' }), document.createTextNode(pf.name));
      b.addEventListener('click', () => setTool(tool && toolKey(tool) === toolKey(t) ? null : t));
      b.addEventListener('contextmenu', async ev => { ev.preventDefault(); if (confirm(`프리팹 "${pf.name}" 을 지울까요? (이미 찍은 물체는 그대로)`)) { if (await savePrefabs(prefabs.filter(x => x.id !== pf.id))) ctx.log(`프리팹 삭제: ${pf.name}`); } });
      tiles.appendChild(b);
    }
    prefabBox.appendChild(tiles);
  }
  renderPrefabs();
  tileGroup('스폰 지점', [['개인전', '●', { kind: 'spawn', team: -1 }, '#e9ecef'], ['0팀', '●', { kind: 'spawn', team: 0 }, '#5aa9ff'], ['1팀', '●', { kind: 'spawn', team: 1 }, '#ff4b3a']]);
  tileGroup('모드', [['거점', '◎', { kind: 'zone' }, '#ffb43a']]);
  pal.appendChild(Object.assign(html('p', 'note'), { textContent: '조작법은 ? (F1)' }));

  function renderPanel() {
    inspector.replaceChildren();
    const h = { onInput: () => rebuild(), onCommit: () => { commit(); renderPanel(); } };
    const title = t => inspector.appendChild(Object.assign(document.createElement('h2'), { textContent: t }));
    const btns = list => {
      const d = document.createElement('div'); d.className = 'btns';
      for (const [label, fn, cls] of list) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); d.appendChild(b); }
      inspector.appendChild(d);
    };
    const o = selected();
    if (!o) {
      title(`맵 설정 · ${map.id}`);
      buildForm(inspector, MAP_FIELDS, map, { ...h, onInput: () => { rebuild(); drawHelpers(); } });
      const n = map.objects.length, sp = map.spawns.ffa.length, tm = (map.spawns.team || []).map(l => l.length).join(' / ') || '없음';
      inspector.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: `물체 ${n}개 · 개인전 스폰 ${sp}곳 · 팀 스폰 ${tm} · 거점 ${(map.zones || []).length}개` }));
      inspector.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: '물체를 클릭하면 여기서 고칠 수 있습니다.' }));
      return;
    }
    if (sel.kind === 'multi') { // 여러 개
      title(`물체 ${o.length}개 선택`);
      const count = {}; for (const x of o) count[x.type] = (count[x.type] || 0) + 1;
      inspector.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: Object.entries(count).map(([t, n]) => `${OBJECT_SCHEMAS[t].label} ${n}`).join(' · ') }));
      inspector.appendChild(Object.assign(document.createElement('p'), { className: 'note', textContent: '고른 것 중 하나를 끌면 함께 움직입니다. 방향키 · R(묶음째 회전) · ⌘D · ⌘C/⌘V · Del 도 함께. Shift+클릭으로 더하기/빼기.' }));
      const allSym = o.every(x => x.sym);
      btns([['회전 (R)', rotateSelected], ['복제 (⌘D)', duplicateSelected], ['❖ 프리팹으로 저장', saveAsPrefab, 'primary'],
        [allSym ? '대칭 끄기' : '대칭 켜기', () => { for (const x of o) { if (allSym) delete x.sym; else x.sym = true; } rebuildNow(); commit(); renderPanel(); }], ['삭제 (Del)', removeSelected, 'danger']]);
      return;
    }
    if (sel.kind === 'obj') {
      title(`${OBJECT_SCHEMAS[o.type].label} #${sel.i}`);
      buildForm(inspector, objectSpec(o.type), o, { ...h, skip: ['type'] });
      btns([['회전 (R)', rotateSelected], ['복제 (⌘D)', duplicateSelected], ['❖ 프리팹으로 저장', saveAsPrefab], ['삭제 (Del)', removeSelected, 'danger']]);
    } else if (sel.kind === 'zone') {
      title(`거점 ${o.id}`);
      buildForm(inspector, ZONE, o, h);
      btns([['삭제 (Del)', removeSelected, 'danger']]);
    } else {
      title(`${TEAM_NAME[sel.team]} #${sel.i}`);
      const holder = { p: o };
      buildForm(inspector, { fields: { p: { kind: 'point', label: '위치 [x, z]' } } }, holder, { ...h, onInput: () => { spawnList(sel.team)[sel.i] = holder.p; rebuild(); } });
      btns([['삭제 (Del)', removeSelected, 'danger']]);
    }
  }

  function validate() {
    lastErrors = checkMap(map);
    const box = r('errors');
    box.replaceChildren(...lastErrors.slice(0, 8).map(t => Object.assign(document.createElement('div'), { textContent: t })));
    if (lastErrors.length > 8) box.appendChild(Object.assign(document.createElement('div'), { textContent: `… 외 ${lastErrors.length - 8}건` }));
    box.hidden = !lastErrors.length;
    r('save').disabled = !!lastErrors.length;
    r('play').disabled = !!lastErrors.length;
  }
  function updateStatus() {
    const d = isDirty();
    r('status').textContent = d ? (saved ? '● 저장 안 됨' : '● 새 맵 · 저장 안 됨') : '✓ 저장됨';
    r('status').className = `status${d ? ' dirty' : ''}`;
  }

  // ───────── 저장 / 시험 플레이 ─────────
  async function save() {
    if (lastErrors.length) { ctx.flash('검사 오류가 있어 저장할 수 없습니다'); ctx.log(`저장 실패 (${map.id}): ${lastErrors[0]}`, 'error'); return false; }
    const res = await fetch(`/api/maps/${map.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(map) });
    const out = await res.json().catch(() => ({ ok: false, errors: ['서버 응답 오류'] }));
    if (!out.ok) { ctx.flash('저장 실패'); ctx.log(`저장 실패 (${map.id}): ${(out.errors || []).join(' / ')}`, 'error'); return false; }
    saved = JSON.stringify(map); updateStatus();
    if (out.isNew) await ctx.refreshAssets();
    ctx.log(`저장: content/maps/${map.id}.json${out.isNew ? ' (새 맵)' : ''}`, 'ok'); ctx.flash('저장했습니다');
    ctx.changed();
    return true;
  }
  // 저장하지 않아도 지금 모습 그대로: 서버 메모리에 임시 맵(draft)을 올리고 화면 안에서 게임을 연다
  async function play() {
    if (lastErrors.length) { ctx.flash('검사 오류가 있어 플레이할 수 없습니다'); return; }
    const res = await fetch(`/api/drafts/${map.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(map) });
    const out = await res.json().catch(() => ({ ok: false }));
    if (!out.ok) { ctx.log(`플레이 실패: ${(out.errors || ['서버 응답 오류']).join(' / ')}`, 'error'); return; }
    const p = new URLSearchParams({ auto: '스튜디오', embed: '1', mode: r('playMode').value, draft: out.id, bots: r('playBots').checked ? '1' : '0' });
    if (r('playHere').checked) p.set('at', `${r2(controls.target.x)},${r2(controls.target.z)}`);
    ctx.play(`/?${p}`);
  }

  r('undo').addEventListener('click', undo);
  r('redo').addEventListener('click', redo);
  r('top').addEventListener('click', topView);
  r('all').addEventListener('click', overview);
  r('snap').addEventListener('change', () => setSnap(Number(r('snap').value)));
  r('save').addEventListener('click', () => save());
  r('play').addEventListener('click', () => play());

  rebuildNow(); drawHelpers(); renderPanel(); overview(); showCoords();

  return {
    kind: 'map', key: `map:${map.id}`, id: map.id, title: map.name && map.name !== map.id ? `${map.name} (${map.id})` : map.id, icon: '▦', is3D: true,
    overlay, tools, toolbar, inspector,
    activate() { controls.connect(); for (const [t, fn, o] of listeners) canvas.addEventListener(t, fn, o); renderer.toneMappingExposure = 0.62; canvas.style.cursor = tool ? 'crosshair' : 'default'; },
    deactivate() { controls.disconnect(); for (const [t, fn, o] of listeners) canvas.removeEventListener(t, fn, o); held.clear(); drag = null; if (fly) endFly(); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    frame(dt) { moveCamera(dt); if (controls.enabled) controls.update(); renderer.render(scene, camera); },
    isDirty, save, play, onKeyDown, onKeyUp: e => held.delete(e.code), onBlur: () => held.clear(),
    dispose() { controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    api: {
      get map() { return map; }, get sel() { return sel; }, get errors() { return lastErrors; }, isDirty, save, play, undo, redo, setTool, place,
      select: s => { sel = s; drawSelection(); renderPanel(); },
      moveTo: (dx, dz) => { moveTo(JSON.parse(JSON.stringify(selected())), dx, dz); rebuildNow(); commit(); renderPanel(); },
      removeSelected, rotateSelected, duplicateSelected, rebuildNow, camera, controls, get snap() { return snapStep; }, get clipboard() { return clipboard; },
      brush, get prefabs() { return prefabs; }, selectList, saveAsPrefab, get tool() { return tool; },
    },
  };
}
