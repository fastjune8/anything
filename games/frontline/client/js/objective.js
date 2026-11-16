// 점령전 거점 표시: 바닥의 원·빛기둥(3D), 화면 위 거점 표식(벽 너머에서도 방향을 알 수 있게), HUD 의 거점 상태.
// 거점 상태는 서버가 보내는 'zone' 메시지(game.zone)를 그대로 그린다.
import * as THREE from 'three';
import { getMap } from '/shared/maps/index.js';
import { scene, camera, currentMap } from './scene.js';
import { me, game } from './state.js';
import { $, MODE_CFG } from './util.js';
import { setText, setDisplay, setClass } from './dom.js';

export const COLORS = { ally: 0x5aa9ff, enemy: 0xff4b3a, none: 0xe9ecef };
export const CSS = { ally: '#5aa9ff', enemy: '#ff4b3a', none: '#e9ecef' };
// 팀 번호 → 'ally' | 'enemy' | 'none'
export const sideOfTeam = t => (t === 0 || t === 1 ? (t === me.team ? 'ally' : 'enemy') : 'none');

// 지금 거점 (점령전이 아니면 null)
export function currentZone() {
  if (MODE_CFG.rules !== 'zone' || !currentMap) return null;
  const zones = getMap(currentMap).zones || [];
  return zones[0] || { id: 'A', name: '거점', x: 0, z: 0, r: 6 };
}

// ── 3D: 바닥 원 + 반투명 기둥 ──
const group = new THREE.Group(); group.visible = false; scene.add(group);
const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.none, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const fillMat = new THREE.MeshBasicMaterial({ color: COLORS.none, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
const wallMat = new THREE.MeshBasicMaterial({ color: COLORS.none, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 96), fillMat); fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02;
const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), wallMat); wall.position.y = 0.5;
const prog = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.9, 96, 1, Math.PI / 2, 0), ringMat.clone()); prog.rotation.x = -Math.PI / 2; prog.position.y = 0.04;
for (const m of [ring, fill, wall, prog]) m.renderOrder = 2;
group.add(ring, fill, wall, prog);
let shownFor = '', lastP = -1;

const markEl = $('zmark');
const _v = new THREE.Vector3();

export function updateObjective(dt) {
  const zn = game.joined ? currentZone() : null;
  group.visible = !!zn;
  setDisplay($('zonebox'), !!zn); setDisplay(markEl, false);
  if (!zn) return;
  const key = `${currentMap}:${zn.x},${zn.z},${zn.r}`;
  if (shownFor !== key) { shownFor = key; group.position.set(zn.x, 0, zn.z); group.scale.set(zn.r, 3.2, zn.r); }

  const s = game.zone || { o: -1, ct: -1, p: 0, c: 0 };
  const side = s.c ? 'none' : sideOfTeam(s.o), color = COLORS[side];
  const t = performance.now() / 1000;
  ringMat.color.setHex(color); fillMat.color.setHex(color); wallMat.color.setHex(color);
  wallMat.opacity = s.c ? 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(t * 8)) : 0.1; // 교전 중이면 깜빡인다
  if (s.p !== lastP) { // 점령 게이지: 바닥 안쪽 원호
    lastP = s.p;
    prog.geometry.dispose();
    prog.geometry = new THREE.RingGeometry(0.8, 0.9, 96, 1, Math.PI / 2, Math.max(0.0001, s.p * Math.PI * 2));
  }
  prog.material.color.setHex(COLORS[sideOfTeam(s.ct)]);
  prog.visible = s.p > 0;

  // ── HUD: 거점 상태 ──
  const inside = me.alive && Math.hypot(me.pos.x - zn.x, me.pos.z - zn.z) <= zn.r && me.pos.y < 4;
  const status = s.c ? '교전 중 — 적을 몰아내세요'
    : s.p > 0 ? (sideOfTeam(s.ct) === 'ally' ? `점령 중 ${Math.round(s.p * 100)}%` : `적이 점령 중 ${Math.round(s.p * 100)}%`)
      : side === 'ally' ? '아군 거점 — 지키세요' : side === 'enemy' ? '적 거점 — 빼앗으세요' : '중립 — 먼저 차지하세요';
  setText($('zoneName'), zn.name || `거점 ${zn.id}`);
  setText($('zoneState'), status);
  const box = $('zonebox');
  box.style.setProperty('--zc', CSS[side]);
  box.style.setProperty('--pc', CSS[sideOfTeam(s.ct)]);
  box.style.setProperty('--zp', `${Math.round(s.p * 100)}%`);
  setClass(box, 'contested', !!s.c); setClass(box, 'inside', inside);

  // ── 화면 위 거점 표식 (안에 있을 때는 숨김) ──
  if (inside || !me.alive) return;
  _v.set(zn.x, 2.2, zn.z).project(camera);
  const behind = _v.z > 1;
  let x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight;
  if (behind) { x = innerWidth - x; y = innerHeight - 40; } // 뒤에 있으면 화면 아래 가장자리로
  x = Math.min(innerWidth - 30, Math.max(30, x)); y = Math.min(innerHeight - 40, Math.max(70, y));
  markEl.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%)`;
  markEl.style.setProperty('--zc', CSS[side]);
  setText(markEl.firstElementChild, zn.id);
  setText(markEl.lastElementChild, `${Math.round(Math.hypot(me.pos.x - zn.x, me.pos.z - zn.z))}m`);
  setDisplay(markEl, true, 'flex');
}
