// 듀얼 쿠나이 그리기 (브라우저): 날아가는·박힌·돌아오는 쿠나이, 손목에서 이어지는 줄, 핀 노드, 와이어 선분들, 영역, 감지 표시
//   내 것: 예측 상태(me.ps — shared/sim/kunai.js · thread.js)를 그대로 그린다
//   다른 사람: 서버가 상태가 바뀔 때만 보내는 'ku' 사건으로 그린다 (비행은 시작점·속도로 이어 그린다)
//   판정(직접 명중·와이어 감지·영역 진입·끊기·돌진 공격)은 서버가 한다 — 여기는 그림과 소리만. 그림 두께는 판정 범위와 상관없다
import * as THREE from 'three';
import { KS, KUNAI, THREAD, nodePos, areaValid } from '/shared/sim/kunai.js';
import { supportBelow } from '/shared/sim/movement.js';
import { scene, camera, colliders } from './scene.js';
import { remotes } from './remotes.js';
import { me, wp, game, isAlly } from './state.js';
import { sfx, audioAt } from './sfx.js';
import { impact } from './fx.js';
import { banner } from './hud.js';
import { V3 } from './util.js';

// ───── 모양 ─────
const steel = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.9, roughness: 0.3 });
const edge = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 1, roughness: 0.18 });
const wrap = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0, roughness: 0.9 });
const bladeGeo = new THREE.OctahedronGeometry(1, 0); bladeGeo.scale(0.026, 0.007, 0.1);
const edgeGeo = new THREE.OctahedronGeometry(1, 0); edgeGeo.scale(0.018, 0.0085, 0.085);
const gripGeo = new THREE.CylinderGeometry(0.011, 0.012, 0.11, 8); gripGeo.rotateX(Math.PI / 2);
const ringGeo = new THREE.TorusGeometry(0.02, 0.0045, 6, 14);
// 끝이 +z 를 본다 (lookAt 으로 날아가는 방향에 맞춘다)
function kunaiMesh() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(bladeGeo, steel); b.position.z = 0.09; g.add(b);
  const e = new THREE.Mesh(edgeGeo, edge); e.position.z = 0.1; g.add(e);
  const h = new THREE.Mesh(gripGeo, wrap); h.position.z = -0.045; g.add(h);
  const r = new THREE.Mesh(ringGeo, steel); r.position.z = -0.12; r.rotation.y = Math.PI / 2; g.add(r);
  g.visible = false; scene.add(g);
  return g;
}
// 핀 노드: 짧은 금속 말뚝 + 빛나는 고리 (박힌 면에서 튀어나온다)
const pinGeo = new THREE.CylinderGeometry(0.012, 0.004, 0.16, 6); pinGeo.rotateX(Math.PI / 2); pinGeo.translate(0, 0, 0.04);
const pinRingGeo = new THREE.TorusGeometry(0.035, 0.007, 6, 16);
const glowMat = {
  a: new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  e: new THREE.MeshBasicMaterial({ color: 0xffa060, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
};
function pinMesh() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(pinGeo, steel));
  const ring = new THREE.Mesh(pinRingGeo, glowMat.a); ring.position.z = 0.1; g.add(ring); g.ring = ring;
  g.visible = false; scene.add(g);
  return g;
}
// 줄: 얇은 상자를 늘여서 (선 굵기가 브라우저마다 다른 문제 없이)
const lineGeo = new THREE.BoxGeometry(1, 1, 1);
const tetherMat = new THREE.MeshBasicMaterial({ color: 0xc9d2d8, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
function lineMesh(mat) { const m = new THREE.Mesh(lineGeo, mat); m.visible = false; m.frustumCulled = false; scene.add(m); return m; }
const _d = new V3(), _m = new V3();
function placeLine(m, a, b, thick) {
  _d.subVectors(b, a); const len = _d.length();
  if (len < 0.05) { m.visible = false; return; }
  m.visible = true;
  m.position.copy(a).addScaledVector(_d, 0.5);
  m.lookAt(_m.copy(m.position).add(_d));
  m.scale.set(thick, thick, len);
}
// 영역: 바닥에 옅게 깔리는 다각형 (설치자와 같은 편에게만)
const areaMat = new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const areaEdgeMat = new THREE.LineBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.45 });

// 한 사람(나 또는 다른 사람)의 그림 묶음. 와이어 선분은 최대 THREAD.maxSeg 개라 미리 만들어 다시 쓴다
function newView() {
  const segs = Array.from({ length: THREAD.maxSeg }, () => ({ core: lineMesh(glowMat.a), glow: lineMesh(glowMat.a) }));
  return { k: [kunaiMesh(), kunaiMesh()], tether: [lineMesh(tetherMat), lineMesh(tetherMat)], pins: [pinMesh(), pinMesh()], segs, area: null, areaKey: '', flash: 0, fade: [] };
}
function areaParts(v) { return v.area ? [v.area.fill, v.area.edge] : []; }
function viewMeshes(v) { return [...v.k, ...v.tether, ...v.pins, ...v.segs.flatMap(s => [s.core, s.glow]), ...areaParts(v)]; }
function hideView(v) { for (const m of viewMeshes(v)) m.visible = false; }
function dropView(v) { for (const m of viewMeshes(v)) scene.remove(m); if (v.area) { v.area.fill.geometry.dispose(); v.area.edge.geometry.dispose(); } }

const mine = newView();
const others = new Map(); // id → { view, k: [{ s, p, v, at, cur, dir }], pn: [V3|null], w: [[a, b]], ar }
const reveals = []; // 와이어·영역에 걸린 적의 위치 (미니맵)

// ───── 손 위치 ─────
function myHand(h, out) { return out.set(h ? 0.2 : -0.2, -0.2, -0.45).applyQuaternion(camera.quaternion).add(camera.position); }
function remoteHand(r, h, out) {
  const side = h ? 0.24 : -0.24, rx = Math.cos(r.yaw), rz = -Math.sin(r.yaw), up = 1.25 - 0.4 * Math.min(1, r.crouch || 0);
  return out.set(r.pos.x + rx * side, r.pos.y + up, r.pos.z + rz * side);
}
const reveal = (p, t) => reveals.push({ x: p[0], z: p[2], until: performance.now() / 1000 + t });

// ───── 사건 (net.js) ─────
export function onKunaiEvent(e) {
  switch (e.e) {
    case 'ku': {
      if (e.id === me.id) return;
      let o = others.get(e.id);
      if (!e.k) { if (o) { hideView(o.view); o.k = null; o.w = []; o.ar = 0; } return; }
      if (!o) { o = { view: newView(), k: null, pn: [null, null], w: [], ar: 0 }; others.set(e.id, o); }
      const r = remotes.get(e.id), now = performance.now();
      o.k = e.k.map((a, h) => {
        const prev = o.k && o.k[h];
        const s = a[0], p = new V3(a[1], a[2], a[3]), v = new V3(a[4], a[5], a[6]);
        if (r && s === KS.FLY && (!prev || prev.s !== KS.FLY)) { const au = audioAt(r.pos); sfx.whoosh(au.pan); }
        if (r && s === KS.ANCHOR && prev && prev.s === KS.FLY) { const au = audioAt(p); sfx.mech('magin', au.att * 0.6, au.pan); }
        const cur = s === KS.RETURN && prev && prev.cur ? prev.cur.clone() : p.clone(); // 돌아오는 중이면 지금 그려진 자리에서 이어서
        return { s, p, v, at: now, cur, dir: v.lengthSq() > 0.01 ? v.clone().normalize() : (prev && prev.dir) || new V3(0, 0, -1) };
      });
      o.pn = (e.pn || [0, 0]).map(p => (p ? new V3(p[0], p[1], p[2]) : null));
      if (e.w && e.w.length > o.w.length && r) { const au = audioAt(r.pos); sfx.mech('bolt', au.att * 0.6, au.pan); }
      o.w = e.w || []; o.ar = e.ar || 0;
      return;
    }
    case 'kuh': { // 쿠나이가 사람에게 박혔다
      const p = new V3().fromArray(e.p), a = audioAt(p);
      sfx.impact(a.dist, a.pan);
      if (e.kill && e.id === me.id) sfx.mech('draw', 0.7);
      return;
    }
    case 'wtrip': reveal(e.p, e.t || KUNAI.wire.reveal); banner('와이어 감지 — 적 위치 표시', 'c'); sfx.mech('bolt', 0.9); return; // 내 와이어에 적이 걸렸다
    case 'aenter': reveal(e.p, e.t || THREAD.area.reveal); banner('영역 진입 감지 — 적 위치 표시', 'c'); sfx.mech('bolt', 0.9); sfx.mech('draw', 0.5); return; // 내 영역에 적이 들어왔다
    case 'aexit': reveal(e.p, 1); return; // 나갔다: 나간 자리만 잠깐
    case 'wslow': banner('와이어에 걸렸다 — 잠깐 느려짐', 'e'); sfx.mech('dry', 1); return;
    case 'wfx': { // 와이어가 울렸다 (모두에게 보이는 짧은 번쩍임)
      const v = e.id === me.id ? mine : others.get(e.id) && others.get(e.id).view;
      if (v) v.flash = 0.35;
      const p = new V3().fromArray(e.p), a = audioAt(p); sfx.mech('bolt', a.att * 0.7, a.pan);
      return;
    }
    case 'wcut': {
      const p = new V3().fromArray(e.p), a = audioAt(p);
      sfx.mech('magout', a.att, a.pan);
      if (e.id === me.id) banner('와이어가 끊겼다', 'e');
      return;
    }
    case 'kdash': { // 기동 중 부딪힘 공격
      const p = new V3().fromArray(e.p), a = audioAt(p);
      impact(p, 6); sfx.impact(a.dist, a.pan); sfx.land(0.8);
      return;
    }
  }
}
export function clearKunai() {
  for (const o of others.values()) dropView(o.view);
  others.clear(); hideView(mine); reveals.length = 0;
}

// ───── 매 프레임 ─────
const _h = new V3(), _p = new V3(), _a = new V3(), _b = new V3(), _look = new V3(), _n = new V3();
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function showKunai(mesh, pos, dir) { mesh.visible = true; mesh.position.copy(pos); mesh.lookAt(_look.copy(pos).add(dir)); }
function showPin(mesh, pos, nIdx, ally) {
  mesh.visible = true; mesh.position.copy(pos);
  _n.fromArray(NORMALS[nIdx] || NORMALS[2]); mesh.lookAt(_look.copy(pos).add(_n));
  mesh.ring.material = ally ? glowMat.a : glowMat.e;
}
// 와이어 선분들: ends(i) = 노드 i 의 위치(V3) 또는 null
function drawSegs(view, list, ends, ally, dt) {
  view.flash = Math.max(0, view.flash - dt);
  const mat = ally ? glowMat.a : glowMat.e, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
  view.segs.forEach((sm, j) => {
    const w = list[j], a = w && ends(w[0], _a), b = w && ends(w[1], _b);
    if (!a || !b) { sm.core.visible = false; sm.glow.visible = false; return; }
    sm.core.material = mat; sm.glow.material = mat; sm.glow.renderOrder = 7;
    placeLine(sm.core, a, b, 0.012 + view.flash * 0.05);
    placeLine(sm.glow, a, b, 0.035 + 0.015 * pulse + view.flash * 0.12);
  });
}
// 영역 바닥 표시: 노드 순서가 바뀔 때만 모양을 새로 만든다
function drawArea(view, ids, ends, show) {
  const pts = show && ids ? ids.map(i => ends(i, new V3())) : null;
  if (!pts || pts.some(p => !p)) { if (view.area) { view.area.fill.visible = false; view.area.edge.visible = false; } return; }
  const key = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join('|');
  if (key !== view.areaKey) {
    view.areaKey = key;
    if (view.area) { scene.remove(view.area.fill, view.area.edge); view.area.fill.geometry.dispose(); view.area.edge.geometry.dispose(); }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const y = supportBelow(colliders, cx, Math.min(...pts.map(p => p.y)) + 0.2, cz) + 0.04; // 영역 가운데 아래의 바닥
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z)));
    const fg = new THREE.ShapeGeometry(shape); fg.rotateX(-Math.PI / 2); fg.translate(0, y, 0);
    const eg = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(p => new V3(p.x, y + 0.01, p.z)));
    view.area = { fill: new THREE.Mesh(fg, areaMat), edge: new THREE.Line(eg, areaEdgeMat) };
    view.area.fill.renderOrder = 4; scene.add(view.area.fill, view.area.edge);
  }
  view.area.fill.visible = true; view.area.edge.visible = true;
}

export function updateKunai(dt) {
  wp.kThrow[0] = Math.max(0, wp.kThrow[0] - dt * 5); wp.kThrow[1] = Math.max(0, wp.kThrow[1] - dt * 5); // 1인칭: 던진 손이 앞으로 나갔다 돌아온다 (viewmodel.js)
  // 내 것
  const ps = me.ps;
  if (!me.alive || !ps.ku) hideView(mine);
  else {
    for (let h = 0; h < 2; h++) {
      const k = ps.ku[h], mesh = mine.k[h], teth = mine.tether[h];
      if (k.s === KS.READY || k.s === KS.COOL) { mesh.visible = false; teth.visible = false; continue; }
      myHand(h, _h);
      _p.set(k.x, k.y, k.z);
      if (k.s === KS.FLY && k.d < 4) _p.lerp(_h, 1 - k.d / 4); // 막 던졌을 때는 눈이 아니라 손에서 나간 것처럼
      _a.set(k.vx, k.vy, k.vz);
      if (_a.lengthSq() < 0.01) _a.subVectors(_p, _h);
      showKunai(mesh, _p, _a.normalize());
      placeLine(teth, _h, _p, 0.006);
    }
    (ps.pins || []).forEach((p, s) => { if (p.on) showPin(mine.pins[s], _p.set(p.x, p.y, p.z), p.n, true); else mine.pins[s].visible = false; });
    const ends = (i, out) => { const n = nodePos(ps, i); return n ? out.set(n.x, n.y, n.z) : null; };
    drawSegs(mine, (ps.wires || []).map(w => [w.a, w.b]), ends, true, dt);
    drawArea(mine, ps.area && areaValid(ps) ? ps.area.n : null, ends, true);
  }
  // 다른 사람
  const now = performance.now();
  for (const [id, o] of others) {
    const r = remotes.get(id);
    if (!r) { dropView(o.view); others.delete(id); continue; }
    if (!o.k || !r.alive || !r.hasPos) { hideView(o.view); continue; }
    for (let h = 0; h < 2; h++) {
      const k = o.k[h], mesh = o.view.k[h], teth = o.view.tether[h];
      if (k.s === KS.READY || k.s === KS.COOL) { mesh.visible = false; teth.visible = false; continue; }
      remoteHand(r, h, _h);
      if (k.s === KS.FLY) {
        const t = (now - k.at) / 1000;
        if (t > 0.8) { mesh.visible = false; teth.visible = false; continue; } // 소식이 끊겼다
        k.cur.set(k.p.x + k.v.x * t, k.p.y + k.v.y * t - 0.5 * KUNAI.gravity * t * t, k.p.z + k.v.z * t);
      } else if (k.s === KS.RETURN) {
        _d.subVectors(_h, k.cur); const dist = _d.length(), step = KUNAI.returnSpeed * dt;
        if (dist <= step) { mesh.visible = false; teth.visible = false; k.s = KS.COOL; continue; }
        k.cur.addScaledVector(_d, step / dist); k.dir.copy(_d).normalize();
      } else k.cur.copy(k.p);
      showKunai(mesh, k.cur, k.dir);
      placeLine(teth, _h, k.cur, 0.006);
    }
    const ally = isAlly(r.team);
    o.pn.forEach((p, s) => { if (p) showPin(o.view.pins[s], p, 2, ally); else o.view.pins[s].visible = false; });
    const ends = (i, out) => (i < 2 ? (o.k[i].s === KS.ANCHOR ? out.copy(o.k[i].p) : null) : o.pn[i - 2] ? out.copy(o.pn[i - 2]) : null);
    drawSegs(o.view, o.w, ends, ally, dt);
    drawArea(o.view, o.ar || null, ends, ally); // 영역 바닥은 같은 편만 본다 (적은 와이어만)
  }
  // 위치 표시 기한
  const t = now / 1000;
  for (let i = reveals.length - 1; i >= 0; i--) if (reveals[i].until < t) reveals.splice(i, 1);
  game.kunaiReveals = reveals;
}
