// 대쉬 이펙트 (스킬): 바람이 등을 밀어 주는 느낌
//   ① 바람 줄기 (몸 옆을 스쳐 가는 길쭉한 빛)  ② 발밑 먼지 + 바닥 바람 고리  ③ 화면 가장자리 속도선  ④ 시야각(FOV) 확장 + 옆으로 살짝 기울기
//   전부 풀링해서 쓰고, 이동 규칙(shared/movement.js)에는 손대지 않는다 — 보이는 것만 바꾼다.
import * as THREE from 'three';
import { scene, camera, canvas } from './scene.js';
import { softTex } from './textures.js';
import { me } from './state.js';
import { V3, clamp } from './util.js';

// 카메라가 쓰는 값 (main.js 가 읽는다): fov = 더해 줄 시야각(도), roll = 카메라 기울기(라디안)
export const dashView = { fov: 0, roll: 0 };

const WIND = 0xd6f0ff;           // 바람 색 (옅은 하늘색)
const FOV_KICK = 9;              // 대쉬 중 시야각이 넓어지는 정도
const ROLL_MAX = 0.04;           // 옆으로 대쉬할 때 기울기

// ───── 바람 줄기: 앞쪽이 밝고 뒤로 흐려지는 길쭉한 빛 ─────
function streakTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 128, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.65, 'rgba(255,255,255,0.45)'); lg.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = lg; g.fillRect(0, 0, 128, 16);
  g.globalCompositeOperation = 'destination-in'; // 위아래는 가늘게 사라지게
  const vg = g.createLinearGradient(0, 0, 0, 16);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.5, 'rgba(0,0,0,1)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = vg; g.fillRect(0, 0, 128, 16);
  return new THREE.CanvasTexture(c);
}
const streakGeo = new THREE.PlaneGeometry(1, 1);
const streakTex = streakTexture();
const streaks = [];
for (let i = 0; i < 40; i++) {
  const mat = new THREE.MeshBasicMaterial({ map: streakTex, color: WIND, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const m = new THREE.Mesh(streakGeo, mat);
  m.matrixAutoUpdate = false; m.visible = false; m.frustumCulled = false; scene.add(m);
  streaks.push({ m, d: new V3(), v: new V3(), len: 2, w: 0.05, age: 0, life: 0.4, peak: 0.5 });
}
let streakI = 0;
function streak(pos, dir, speed, len, w, life, peak) {
  const s = streaks[streakI = (streakI + 1) % streaks.length];
  s.m.position.copy(pos); s.d.copy(dir); s.v.copy(dir).multiplyScalar(speed);
  s.len = len; s.w = w; s.age = 0; s.life = life; s.peak = peak; s.m.visible = true;
}

// ───── 발밑 먼지 ─────
const dust = [];
for (let i = 0; i < 20; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xb9b2a4, transparent: true, depthWrite: false }));
  s.visible = false; scene.add(s);
  dust.push({ s, v: new V3(), age: 0, life: 0.5, size: 0.2, grow: 1 });
}
let dustI = 0;

// ───── 바닥에 퍼지는 바람 고리 ─────
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.68, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: WIND, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })
);
ring.visible = false; scene.add(ring);
let ringT = 9;

// ───── 화면 가장자리 속도선 (가운데는 비워서 조준을 가리지 않는다) ─────
const lines = document.createElement('div');
const L = (period, a) => `repeating-conic-gradient(from ${a}deg at 50% 50%, rgba(255,255,255,0) 0deg, rgba(255,255,255,0) ${period - 0.7}deg, rgba(225,244,255,0.7) ${period - 0.3}deg, rgba(255,255,255,0) ${period}deg)`;
const mask = 'radial-gradient(ellipse at center, transparent 42%, #000 88%)';
lines.style.cssText = `position:fixed;inset:0;pointer-events:none;opacity:0;background:${L(7.3, 0)},${L(11.1, 3)};-webkit-mask-image:${mask};mask-image:${mask}`;
canvas.after(lines); // HUD 보다 아래, 3D 화면보다 위

// ───── 상태 ─────
const dir = new V3(0, 0, -1), _p = new V3(), _r = new V3(), _u = new V3(0, 1, 0), _v = new V3(), _x = new V3(), _y = new V3(), _z = new V3();
let k = 0; // 0~1: 지금 대쉬 연출이 얼마나 세게 보이는가

// 대쉬를 시작한 순간 (player.js 가 부른다. me.dashV 는 이미 정해져 있다)
export function startDashFx() {
  if (!me.dashV) return;
  dir.set(me.dashV.x, 0, me.dashV.z).normalize();
  _r.crossVectors(dir, _u).normalize(); // 대쉬 방향의 오른쪽

  // 바람 줄기: 몸 뒤에서 앞까지 길 따라 흩뿌린다. 앞이 비게 반지름 0.7m 이상
  for (let i = 0; i < 16; i++) {
    const along = -1.5 + Math.random() * 6.5, ang = Math.random() * Math.PI * 2, rad = 0.7 + Math.random() * 1.5;
    _p.copy(me.pos).addScaledVector(dir, along).addScaledVector(_r, Math.cos(ang) * rad);
    _p.y += 1.0 + Math.sin(ang) * rad * 0.7;
    streak(_p, dir, 14 + Math.random() * 10, 1.6 + Math.random() * 2, 0.03 + Math.random() * 0.04, 0.3 + Math.random() * 0.15, 0.55);
  }
  // 땅에서 대쉬하면 발밑에서 먼지가 뒤로 밀려난다 + 바람 고리
  if (me.onGround) {
    for (let i = 0; i < 8; i++) {
      const d = dust[dustI = (dustI + 1) % dust.length];
      d.s.position.copy(me.pos).addScaledVector(dir, -0.2 + Math.random() * 0.4); d.s.position.y += 0.08;
      d.v.copy(dir).multiplyScalar(-(1.5 + Math.random() * 3.5)).addScaledVector(_r, (Math.random() - 0.5) * 2.4); d.v.y = 0.3 + Math.random() * 0.6;
      d.age = 0; d.life = 0.35 + Math.random() * 0.25; d.size = 0.22; d.grow = 0.9 + Math.random() * 0.7; d.s.visible = true;
    }
    ring.position.set(me.pos.x, me.pos.y + 0.03, me.pos.z); ringT = 0; ring.visible = true;
  }
}

export function updateDashFx(dt) {
  // 세기: 대쉬 중에는 빨리 올라가고, 끝나면 천천히 가라앉는다
  const on = me.alive && me.dashT > 0;
  k += ((on ? 1 : 0) - k) * (1 - Math.exp(-(on ? 28 : 7) * dt));
  if (k < 0.002) k = 0;

  if (on) { // 대쉬하는 동안 앞쪽에서 바람이 계속 스쳐 지나간다
    dir.set(me.dashV.x, 0, me.dashV.z).normalize();
    _r.crossVectors(dir, _u).normalize();
    for (let i = 0; i < 2; i++) {
      const ang = Math.random() * Math.PI * 2, rad = 0.8 + Math.random() * 1.2;
      _p.copy(me.pos).addScaledVector(dir, 2.5 + Math.random() * 3).addScaledVector(_r, Math.cos(ang) * rad);
      _p.y += 1.0 + Math.sin(ang) * rad * 0.7;
      streak(_p, dir, 10 + Math.random() * 8, 1.4 + Math.random() * 1.6, 0.03 + Math.random() * 0.03, 0.22 + Math.random() * 0.1, 0.45);
    }
  }

  // 카메라: 시야각이 확 넓어지고, 옆으로 대쉬하면 그쪽으로 살짝 기울어진다
  dashView.fov = FOV_KICK * k;
  const sideDot = dir.x * Math.cos(me.yaw) - dir.z * Math.sin(me.yaw); // 카메라 오른쪽과 대쉬 방향이 얼마나 같은가
  dashView.roll = -sideDot * ROLL_MAX * k;
  lines.style.opacity = String(clamp(k * 0.6, 0, 0.6));

  // 바람 줄기: 카메라 쪽으로 납작하게 눕혀 그린다
  for (const s of streaks) {
    if (!s.m.visible) continue;
    s.age += dt;
    if (s.age >= s.life) { s.m.visible = false; continue; }
    s.m.position.addScaledVector(s.v, dt);
    _x.copy(s.d).multiplyScalar(s.len);
    _z.copy(camera.position).sub(s.m.position); _z.addScaledVector(s.d, -_z.dot(s.d));
    if (_z.lengthSq() < 1e-6) _z.set(0, 1, 0);
    _z.normalize(); _y.crossVectors(_z, s.d).multiplyScalar(s.w);
    s.m.matrix.makeBasis(_x, _y, _z).setPosition(s.m.position);
    s.m.matrixWorldNeedsUpdate = true;
    const t = s.age / s.life;
    s.m.material.opacity = s.peak * Math.min(1, s.age / 0.04) * (1 - t) * (1 - t * 0.3);
  }
  for (const d of dust) {
    if (!d.s.visible) continue;
    d.age += dt;
    if (d.age >= d.life) { d.s.visible = false; continue; }
    d.v.multiplyScalar(1 - 3 * dt);
    d.s.position.addScaledVector(d.v, dt);
    const t = d.age / d.life;
    d.s.scale.setScalar(d.size + d.grow * t); d.s.material.opacity = 0.38 * (1 - t);
  }
  if (ring.visible) {
    ringT += dt;
    const t = ringT / 0.3;
    if (t >= 1) ring.visible = false;
    else { ring.scale.setScalar(0.4 + 2.8 * (1 - (1 - t) * (1 - t))); ring.material.opacity = 0.5 * (1 - t); }
  }
}
