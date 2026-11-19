// 점령전 거점 (3D): 바닥 원·진행 원호·반투명 기둥 + 화면 위 거점 표식(벽 너머에서도 방향과 거리를 알 수 있게).
// 거점 상태는 서버의 dom 사건(game.dom)을 그대로 그린다. 거점 개수·위치는 맵 데이터.
import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { me, game } from './state.js';
import { $, MODE_CFG } from './util.js';

export const COLORS = { a: 0x5aa9ff, e: 0xff4b3a, n: 0xe9ecef };
const teamKey = t => (t < 0 ? 'n' : t === me.team ? 'a' : 'e');
const marks = $('zmarks');
let items = [], builtFor = '';

function build() {
  for (const it of items) { scene.remove(it.group); it.mark.remove(); }
  items = game.zones.map(z => {
    const mk = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const ringMat = mk(COLORS.n), fillMat = mk(COLORS.n), wallMat = mk(COLORS.n), progMat = mk(COLORS.n);
    fillMat.opacity = 0.07; wallMat.opacity = 0.09;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 96), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 96), fillMat); fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), wallMat); wall.position.y = 0.5;
    const prog = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.9, 96, 1, Math.PI / 2, 0.0001), progMat); prog.rotation.x = -Math.PI / 2; prog.position.y = 0.04;
    for (const m of [ring, fill, wall, prog]) m.renderOrder = 2;
    group.add(ring, fill, wall, prog);
    group.position.set(z.x, z.y || 0, z.z); group.scale.set(z.r, 3.2, z.r);
    scene.add(group);
    const mark = document.createElement('div'); mark.className = 'zm'; mark.innerHTML = `<b>${z.id}</b><span></span>`; marks.append(mark);
    return { z, group, ringMat, fillMat, wallMat, prog, mark, lastP: -1 };
  });
}
const _v = new THREE.Vector3();
export function updateObjective() {
  const on = game.joined && MODE_CFG.rules === 'domination' && game.zones.length;
  const key = on ? JSON.stringify(game.zones) : '';
  if (key !== builtFor) { builtFor = key; if (on) build(); else { for (const it of items) { scene.remove(it.group); it.mark.remove(); } items = []; } }
  if (!on) return;
  const t = performance.now() / 1000;
  items.forEach((it, i) => {
    const st = game.dom ? game.dom.pts[i] : [-1, -1, 0, 0];
    const [o, team, p, c] = st, col = COLORS[c ? 'n' : teamKey(o)];
    it.ringMat.color.setHex(col); it.fillMat.color.setHex(col); it.wallMat.color.setHex(col);
    it.wallMat.opacity = c ? 0.06 + 0.1 * (0.5 + 0.5 * Math.sin(t * 8)) : 0.09;
    if (p !== it.lastP) { it.lastP = p; it.prog.geometry.dispose(); it.prog.geometry = new THREE.RingGeometry(0.8, 0.9, 96, 1, Math.PI / 2, Math.max(0.0001, p * Math.PI * 2)); }
    it.prog.material.color.setHex(COLORS[teamKey(team)]); it.prog.visible = p > 0;
    // 화면 위 표식
    _v.set(it.z.x, (it.z.y || 0) + 2.4, it.z.z).project(camera);
    const vis = _v.z < 1 && me.alive;
    it.mark.style.display = vis ? 'block' : 'none';
    if (vis) {
      const x = Math.max(24, Math.min(innerWidth - 24, (_v.x * 0.5 + 0.5) * innerWidth)), y = Math.max(60, Math.min(innerHeight - 90, (-_v.y * 0.5 + 0.5) * innerHeight));
      it.mark.style.transform = `translate(${x}px, ${y}px)`;
      it.mark.className = `zm ${teamKey(o)}${c ? ' c' : ''}`;
      it.mark.children[1].textContent = `${Math.round(Math.hypot(me.pos.x - it.z.x, me.pos.z - it.z.z))}m`;
    }
  });
}
