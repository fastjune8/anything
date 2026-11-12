import * as THREE from 'three';
import { MAX_HP, RESPAWN_MS, ROOM_MAX } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { rayWorld, rayBox, normalOf } from '/shared/collision.js';
import { buildWorld } from './world.js';
import { buildGun, buildSoldier } from './guns.js';
import { Sfx } from './audio.js';

const $ = id => document.getElementById(id);
const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const UP = new V3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const params = new URLSearchParams(location.search);
const NOLOCK = params.has('nolock'); // 테스트용: 포인터 락 없이 진행

// ───────── 렌더러 / 장면 ─────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.autoClear = false;

const BASE_FOV = 74;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 1500);
camera.rotation.order = 'YXZ';
const world = buildWorld(scene, renderer);
const colliders = world.colliders;

const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.6;
vmScene.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a4234, 1.2));
const vmSun = new THREE.DirectionalLight(0xfff0d8, 2.6);
vmScene.add(vmSun);
const vm = new THREE.Group();
vmScene.add(vm);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = vmCam.aspect = w / h;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const sfx = new Sfx();

// ───────── 텍스처 (이펙트) ─────────
function radialTex(stops, size = 64, spikes = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  if (spikes) {
    g.globalCompositeOperation = 'lighter';
    g.translate(h, h);
    for (let i = 0; i < spikes; i++) {
      g.rotate(Math.PI * 2 / spikes + 0.3);
      const lg = g.createLinearGradient(0, 0, h, 0);
      lg.addColorStop(0, 'rgba(255,240,200,0.9)'); lg.addColorStop(1, 'rgba(255,160,40,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -h * 0.09); g.lineTo(h, 0); g.lineTo(0, h * 0.09); g.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}
const softTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
const flashTex = radialTex([[0, 'rgba(255,250,225,1)'], [0.25, 'rgba(255,200,90,0.8)'], [0.6, 'rgba(255,120,20,0.2)'], [1, 'rgba(255,90,0,0)']], 128, 5);
flashTex.colorSpace = THREE.SRGBColorSpace;

// ───────── 1인칭 무기 ─────────
const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
const guns = WEAPONS.map(w => {
  const g = buildGun(w.id, true);
  g.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  g.flash.position.set(0, 0.005, g.muzzleZ - 0.05);
  g.flash.visible = false;
  g.group.add(g.flash);
  g.group.visible = false;
  vm.add(g.group);
  return g;
});

// ───────── 플레이어 상태 ─────────
const STAND_H = 1.75, CROUCH_H = 1.2, RADIUS = 0.35, STEP = 0.45, GRAVITY = 19, JUMP_V = 6.4;
const PITCH_MAX = 88 * DEG;
const me = {
  id: -1, name: '', pos: new V3(0, 0, -54), vel: new V3(), yaw: Math.PI, pitch: 0,
  onGround: true, crouch: false, h: STAND_H, hp: MAX_HP, alive: true, stepOff: 0, deadT: 0,
};
const inv = WEAPONS.map(w => ({ ammo: w.mag, reserve: w.reserve }));
let cur = 0, prevWeapon = 6, drawT = 0, cooldown = 0, bloom = 0, adsT = 0, sprintT = 0;
let reload = null, kickP = 0, kickY = 0, vmKick = 0, flashT = 0, bobPhase = 0, swayX = 0, swayY = 0;
let stepDist = 0, sprinting = false;
let joined = false, matchState = 'idle', respawnAt = 0, endAt = 0, matchEndsAt = 0, goalKills = 20;
const roster = new Map(); // id → { id, name, bot, k, d } (나 포함 방 전체)
let sens = Number(localStorage.getItem('fd_sens')) || 1;

const keys = new Set();
let fireHeld = false, fireFresh = false, adsHeld = false, mdx = 0, mdy = 0;
const adsInput = () => adsHeld || keys.has('KeyT'); // 우클릭 또는 T키

// ───────── 다른 플레이어(사람/봇) ─────────
// 3인칭 모델은 방 최대 인원만큼 미리 만들어 두고, 들어오는 사람에게 하나씩 배정한다.
const RIG_COLORS = [[0x6a6048, 0x3a3d2c], [0x4a5a6a, 0x2c333d], [0x6a4a48, 0x3d2c2c], [0x4a6a52, 0x2c3d33],
  [0x6a6a48, 0x3d3d2c], [0x5a4a6a, 0x332c3d], [0x48666a, 0x2c3d3d], [0x6a5448, 0x3d332c]];
function makeRig(i) {
  const [uniform, vest] = RIG_COLORS[i % RIG_COLORS.length];
  const soldier = buildSoldier({ uniform, vest });
  soldier.root.visible = false;
  scene.add(soldier.root);
  const guns = WEAPONS.map(w => {
    const g = buildGun(w.id, false); g.group.visible = false; soldier.gunSlot.add(g.group);
    g.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  });
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  flash.scale.setScalar(0.7); flash.visible = false; scene.add(flash);
  return { soldier, guns, flash, flashT: 0, used: false };
}
const rigs = Array.from({ length: ROOM_MAX }, (_, i) => makeRig(i));
const remotes = new Map(); // id → 원격 플레이어

function addRemote(info) {
  let r = remotes.get(info.id);
  if (!r) {
    const rig = rigs.find(x => !x.used);
    if (!rig) return null;
    rig.used = true;
    r = {
      id: info.id, rig, name: '', bot: false, alive: false, hasPos: false,
      pos: new V3(), tpos: new V3(), yaw: 0, tyaw: 0, pitch: 0, tpitch: 0, crouch: 0, crouchT: 0,
      weapon: 0, deadT: 0, walk: 0, stepDist: 0,
    };
    remotes.set(info.id, r);
  }
  r.name = info.name; r.bot = !!info.bot; r.alive = !!info.alive;
  return r;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  r.rig.used = false; r.rig.soldier.root.visible = false; r.rig.flash.visible = false;
  remotes.delete(id);
}
function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); roster.clear(); }

const muzzleLight = new THREE.PointLight(0xffb060, 0, 16, 2);
scene.add(muzzleLight);

// ───────── 이펙트 풀 ─────────
const tracers = [];
const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(tracerGeo, tracerMat); m.visible = false; m.frustumCulled = false; scene.add(m);
  tracers.push({ m, a: new V3(), d: new V3(), len: 0, head: 0, on: false });
}
let tracerI = 0;
function addTracer(a, b) {
  const t = tracers[tracerI = (tracerI + 1) % tracers.length];
  t.a.copy(a); t.d.copy(b).sub(a); t.len = t.d.length();
  if (t.len < 1.5) return;
  t.d.divideScalar(t.len); t.head = Math.min(3, t.len); t.on = true;
}
const _tp = new V3();
function updateTracers(dt) {
  for (const t of tracers) {
    if (!t.on) continue;
    const TL = 9;
    const tail = Math.max(0, t.head - TL), head = Math.min(t.len, t.head);
    if (tail >= t.len) { t.on = false; t.m.visible = false; continue; }
    const seg = Math.max(0.05, head - tail);
    t.m.visible = true;
    t.m.position.copy(t.a).addScaledVector(t.d, tail + seg / 2);
    t.m.lookAt(_tp.copy(t.m.position).add(t.d));
    t.m.scale.set(0.022, 0.022, seg);
    t.head += 420 * dt;
  }
}

const decals = [];
const decalGeo = new THREE.CircleGeometry(0.045, 8);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
for (let i = 0; i < 120; i++) { const m = new THREE.Mesh(decalGeo, decalMat); m.visible = false; scene.add(m); decals.push(m); }
let decalI = 0;

const parts = [];
for (let i = 0; i < 160; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, transparent: true, depthWrite: false }));
  s.visible = false; scene.add(s);
  parts.push({ s, v: new V3(), life: 0, max: 1, size: 0.1, grow: 0, grav: 0, op: 1 });
}
let partI = 0;
function puff(pos, vel, color, size, grow, life, grav, op) {
  const p = parts[partI = (partI + 1) % parts.length];
  p.s.position.copy(pos); p.v.copy(vel); p.s.material.color.setHex(color);
  p.size = size; p.grow = grow; p.life = p.max = life; p.grav = grav; p.op = op; p.s.visible = true;
}
function updateParts(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    p.v.y -= p.grav * dt; p.v.multiplyScalar(1 - 2.2 * dt);
    p.s.position.addScaledVector(p.v, dt);
    const k = 1 - p.life / p.max;
    p.s.scale.setScalar(p.size + p.grow * k);
    p.s.material.opacity = p.op * (1 - k);
  }
}
const _n = new V3(), _v = new V3();
function impact(point, n) {
  if (n === 6) { // 피격
    for (let i = 0; i < 6; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(2.2);
      puff(point, _v, 0x6a0808, 0.05, 0.22, 0.35, 5, 0.85);
    }
    return;
  }
  if (n < 0) return;
  _n.fromArray(normalOf(n));
  const d = decals[decalI = (decalI + 1) % decals.length];
  d.position.copy(point).addScaledVector(_n, 0.012);
  d.lookAt(_v.copy(d.position).add(_n));
  d.scale.setScalar(0.7 + Math.random() * 0.7);
  d.visible = true;
  const ground = n === 2 && point.y < 0.02;
  for (let i = 0; i < 5; i++) {
    _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6).addScaledVector(_n, 1.6 + Math.random() * 1.5);
    puff(point, _v, ground ? 0x8a7c62 : 0xa39e94, 0.07, 0.5 + Math.random() * 0.4, 0.5 + Math.random() * 0.35, 1.5, 0.55);
  }
}

// ───────── 충돌 ─────────
function overlapTop(x, y, z, h) {
  let top = -Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ && y + h > c.minY && y < c.maxY - 0.001) {
      if (c.maxY > top) top = c.maxY;
    }
  }
  return top;
}
function supportBelow(x, y, z) {
  let s = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ && c.maxY <= y + 0.001 && c.maxY > s) s = c.maxY;
  }
  return s;
}
const colH = () => (me.crouch ? CROUCH_H : STAND_H);
function moveAxis(axis, delta) {
  if (!delta) return;
  me.pos[axis] += delta;
  const h = colH();
  const top = overlapTop(me.pos.x, me.pos.y, me.pos.z, h);
  if (top === -Infinity) return;
  const rise = top - me.pos.y;
  if (me.onGround && rise <= STEP && overlapTop(me.pos.x, top, me.pos.z, h) === -Infinity) {
    me.pos.y = top; me.stepOff -= rise; return;
  }
  me.pos[axis] -= delta; me.vel[axis] = 0;
}

function updateMovement(dt, active) {
  const w = WEAPONS[cur];
  const can = active && me.alive && matchState !== 'ended';
  let fwd = 0, side = 0;
  if (can) {
    fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  }
  // 앉기
  const wantCrouch = can && keys.has('KeyC');
  if (wantCrouch) me.crouch = true;
  else if (me.crouch && overlapTop(me.pos.x, me.pos.y, me.pos.z, STAND_H) === -Infinity) me.crouch = false;
  me.h = lerp(me.h, me.crouch ? CROUCH_H : STAND_H, 1 - Math.exp(-dt * 14));

  sprinting = can && keys.has('ShiftLeft') && fwd > 0 && me.onGround && !me.crouch && !adsInput() && !fireHeld && !reload;
  let speed = me.crouch ? 2.3 : sprinting ? 6.9 : 4.6;
  speed *= w.move * (1 - 0.4 * adsT);

  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx *= speed / wl; wz *= speed / wl; }
  const acc = 1 - Math.exp(-dt * (me.onGround ? 13 : 2.2));
  me.vel.x = lerp(me.vel.x, wx, acc); me.vel.z = lerp(me.vel.z, wz, acc);

  const wasGround = me.onGround;
  if (can && keys.has('Space') && me.onGround) { me.vel.y = JUMP_V; me.onGround = false; }

  const px = me.pos.x, pz = me.pos.z;
  moveAxis('x', me.vel.x * dt);
  moveAxis('z', me.vel.z * dt);

  me.vel.y -= GRAVITY * dt;
  const ny = me.pos.y + me.vel.y * dt;
  if (me.vel.y <= 0) {
    const sup = supportBelow(me.pos.x, me.pos.y, me.pos.z);
    if (ny <= sup) {
      if (!me.onGround && me.vel.y < -6) sfx.land(Math.min(1, -me.vel.y / 10));
      me.pos.y = sup; me.vel.y = 0; me.onGround = true;
    } else if (wasGround && me.onGround && me.pos.y - sup <= STEP) {
      me.stepOff += me.pos.y - sup; me.pos.y = sup; me.vel.y = 0;
    } else { me.pos.y = ny; me.onGround = false; }
  } else {
    if (overlapTop(me.pos.x, ny, me.pos.z, colH()) !== -Infinity) me.vel.y = 0; else me.pos.y = ny;
    me.onGround = false;
  }
  me.stepOff *= Math.exp(-dt * 14);

  const moved = Math.hypot(me.pos.x - px, me.pos.z - pz);
  if (me.onGround && moved > 0.0005) {
    stepDist += moved; bobPhase += moved * (sprinting ? 2.6 : 3.1);
    if (stepDist > (sprinting ? 2.5 : me.crouch ? 1.6 : 2.0)) { stepDist = 0; sfx.step(me.crouch ? 0.35 : sprinting ? 1 : 0.7); }
  }
}

// ───────── 사격 ─────────
const _o = new V3(), _d = new V3(), _f = new V3(), _r = new V3(), _u = new V3(), _mz = new V3();
const hbox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
function remoteHit(o, d, maxT) {
  let best = null;
  for (const r of remotes.values()) {
    if (!r.alive || !r.hasPos) continue;
    const h = hitRemote(r, o, d, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) best = { t: h.t, part: h.part, id: r.id };
  }
  return best;
}
function hitRemote(e, o, d, maxT) {
  const c = e.crouch, p = e.pos;
  const legTop = lerp(0.86, 0.43, c), torsoTop = lerp(1.47, 1.0, c), headY = lerp(1.61, 1.14, c);
  let best = null;
  const set = (hw, y0, y1) => { hbox.minX = p.x - hw; hbox.maxX = p.x + hw; hbox.minZ = p.z - hw; hbox.maxZ = p.z + hw; hbox.minY = p.y + y0; hbox.maxY = p.y + y1; };
  set(0.2, 0, legTop);
  let h = rayBox(o, d, hbox, maxT);
  if (h) best = { t: h.t, part: 'leg' };
  set(0.25, legTop, torsoTop);
  h = rayBox(o, d, hbox, best ? best.t : maxT);
  if (h) best = { t: h.t, part: 'body' };
  // 머리 (구)
  const ox = o.x - p.x, oy = o.y - (p.y + headY), oz = o.z - p.z, r = 0.15;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < (best ? best.t : maxT)) best = { t, part: 'head' };
  }
  return best;
}

function hSpeed() { return Math.hypot(me.vel.x, me.vel.z); }
function currentSpread() {
  const w = WEAPONS[cur];
  return lerp(w.hip, w.ads, adsT) * (me.crouch ? 0.75 : 1)
    + hSpeed() * 0.25 * (1 - 0.7 * adsT) + (me.onGround ? 0 : 3) + bloom * (1 - 0.5 * adsT);
}

function muzzleWorld(out) {
  const k = adsT;
  return out.set(lerp(0.13, 0, k), lerp(-0.11, -0.04, k), -0.75).applyQuaternion(camera.quaternion).add(camera.position);
}

function fire() {
  const w = WEAPONS[cur], st = inv[cur];
  st.ammo--; cooldown = 60 / w.rpm; fireFresh = false;
  camera.getWorldDirection(_f);
  _r.crossVectors(_f, UP).normalize(); _u.crossVectors(_r, _f);
  _o.copy(camera.position);
  const tanS = Math.tan(currentSpread() * DEG);
  const ends = [], hits = [];
  muzzleWorld(_mz);
  for (let i = 0; i < w.pellets; i++) {
    const rr = tanS * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    _d.copy(_f).addScaledVector(_r, rr * Math.cos(th)).addScaledVector(_u, rr * Math.sin(th)).normalize();
    const wh = rayWorld(_o, _d, colliders);
    const eh = remoteHit(_o, _d, wh.t);
    let t = wh.t, n = wh.n;
    if (eh) { t = eh.t; n = 6; hits.push([eh.part, Math.round(t * 10) / 10, eh.id]); }
    const end = _o.clone().addScaledVector(_d, t);
    impact(end, n);
    addTracer(_mz, end);
    ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2), n]);
  }
  net.send({ t: 'shot', w: cur, o: [+_mz.x.toFixed(2), +_mz.y.toFixed(2), +_mz.z.toFixed(2)], e: ends });
  if (hits.length) {
    net.send({ t: 'hit', w: cur, hits });
    showHit(hits.some(h => h[0] === 'head'));
  }
  // 반동
  const mul = (1 - 0.3 * adsT) * (me.crouch ? 0.8 : 1);
  const rv = w.recoilV * DEG * mul;
  me.pitch = Math.min(PITCH_MAX, me.pitch + rv * 0.45); kickP += rv * 0.55;
  const rh = (Math.random() * 2 - 1) * w.recoilH * DEG * mul;
  me.yaw += rh * 0.5; kickY += rh * 0.5;
  bloom = Math.min(w.bloomMax, bloom + w.bloom);
  vmKick = 1; flashT = 0.045;
  guns[cur].flash.rotation.z = Math.random() * Math.PI;
  guns[cur].flash.scale.setScalar((w.pellets > 1 || w.scope ? 1.5 : 1) * (0.8 + Math.random() * 0.5) * (1 - 0.5 * adsT));
  muzzleLight.position.copy(_mz); muzzleLight.intensity = 60;
  sfx.shot(w);
  if (w.bolt) sfx.mech('bolt', 1, 0, 0.5);
  if (w.shell) sfx.mech('pump', 1, 0, 0.28);
}

function startReload() {
  const w = WEAPONS[cur], st = inv[cur];
  if (reload || drawT > 0 || st.ammo >= w.mag || st.reserve <= 0 || !me.alive) return;
  reload = { t: 0, total: w.shell ? 0.45 : w.reload, shell: !!w.shell, ev: 0, first: true };
  net.send({ t: 'rl', w: cur });
}

function switchTo(i) {
  if (i === cur || i < 0 || i >= WEAPONS.length || !me.alive) return;
  prevWeapon = cur; cur = i; reload = null; drawT = WEAPONS[i].draw; adsT = 0; bloom = 0; fireFresh = false; cooldown = 0;
  sfx.mech('draw');
  showGun();
}
function showGun() { guns.forEach((g, i) => { g.group.visible = i === cur; if (g.mag) g.mag.position.copy(g.magRest); }); }
showGun();

const RELOAD_EV = [[0.15, 'magout'], [0.62, 'magin'], [0.88, 'bolt']];
function updateWeapon(dt, active) {
  const w = WEAPONS[cur], st = inv[cur];
  const can = active && me.alive && matchState !== 'ended';
  cooldown = Math.max(0, cooldown - dt);
  drawT = Math.max(0, drawT - dt);
  bloom = Math.max(0, bloom - dt * (w.bloomMax || 1) * 3.2);

  if (reload) {
    reload.t += dt;
    if (reload.shell) {
      if (reload.t >= reload.total) {
        st.ammo++; st.reserve--; sfx.mech('shell');
        if (st.ammo < w.mag && st.reserve > 0) { reload.t = 0; reload.total = w.reload; reload.first = false; }
        else { reload = null; sfx.mech('pump', 0.8, 0, 0.18); cooldown = Math.max(cooldown, 0.45); }
      }
    } else {
      const f = reload.t / reload.total;
      while (reload.ev < RELOAD_EV.length && f >= RELOAD_EV[reload.ev][0]) sfx.mech(RELOAD_EV[reload.ev++][1]);
      if (f >= 1) {
        const n = Math.min(w.mag - st.ammo, st.reserve);
        st.ammo += n; st.reserve -= n; reload = null;
      }
    }
  }

  const wantAds = can && adsInput() && !reload && drawT <= 0 && !sprinting;
  adsT = clamp(adsT + (wantAds ? dt : -dt) / w.adsTime, 0, 1);
  sprintT = lerp(sprintT, sprinting ? 1 : 0, 1 - Math.exp(-dt * 10));

  if (can && (w.auto ? fireHeld : fireFresh) && drawT <= 0 && cooldown <= 0) {
    if (reload && reload.shell && st.ammo > 0) { reload = null; cooldown = 0.25; }
    else if (!reload) {
      if (st.ammo > 0) fire();
      else {
        if (fireFresh) sfx.mech('dry');
        fireFresh = false;
        startReload();
      }
    }
  }
  if (!w.auto && !fireHeld) fireFresh = false;

  // 반동 복귀
  const rec = Math.exp(-dt * 9);
  kickP *= rec; kickY *= rec;
  vmKick *= Math.exp(-dt * 16);

  flashT -= dt;
  guns[cur].flash.visible = flashT > 0;
  muzzleLight.intensity *= Math.exp(-dt * 40);
  if (muzzleLight.intensity < 0.05) muzzleLight.intensity = 0;
}

// ───────── 뷰모델 포즈 ─────────
const _hip = new V3(), _ads = new V3();
function updateViewmodel(dt) {
  const w = WEAPONS[cur], g = guns[cur];
  const k = smooth(0, 1, adsT);
  _hip.fromArray(g.hip); _ads.set(0, -g.sightY, g.adsZ);
  const p = vm.position.copy(_hip).lerp(_ads, k);
  let rx = 0, ry = 0, rz = 0;

  const sp = Math.min(1, hSpeed() / 4.6), bob = (1 - 0.88 * k) * sp * (me.onGround ? 1 : 0);
  p.x += Math.cos(bobPhase) * 0.009 * bob; p.y -= Math.abs(Math.sin(bobPhase)) * 0.011 * bob;

  swayX = lerp(swayX, clamp(-mdx * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  swayY = lerp(swayY, clamp(-mdy * 0.0016, -0.06, 0.06), 1 - Math.exp(-dt * 10));
  const sw = 1 - 0.75 * k;
  ry += swayX * sw; rx += swayY * sw; p.x += swayX * 0.12 * sw; p.y -= swayY * 0.12 * sw;

  const kk = vmKick * (1 - 0.45 * k) * Math.min(2.2, 0.6 + w.recoilV * 0.45);
  p.z += kk * 0.035; rx += kk * 0.045; p.y += kk * 0.004;

  // 볼트 / 펌프 동작
  if ((w.bolt || w.shell) && cooldown > 0 && !reload) {
    const c = 1 - cooldown / (60 / w.rpm);
    const a = Math.sin(Math.PI * smooth(0.25, 0.85, c));
    rz += a * 0.22 * (1 - 0.6 * k); p.y -= a * 0.02 * (1 - 0.6 * k); rx -= a * 0.05;
  }

  if (reload) {
    let down, magDrop = 0;
    if (reload.shell) {
      const f = reload.t / reload.total;
      down = reload.first ? smooth(0, 0.8, f) : 1;
      p.z += Math.sin(Math.PI * f) * 0.015 * (reload.first ? 0 : 1);
    } else {
      const f = reload.t / reload.total;
      down = smooth(0, 0.14, f) * (1 - smooth(0.86, 1, f));
      magDrop = smooth(0.15, 0.28, f) * (1 - smooth(0.5, 0.62, f));
      rz += Math.sin(f * Math.PI * 3) * 0.05 * down;
    }
    p.y -= 0.075 * down; p.x -= 0.03 * down; rz += 0.42 * down; rx += 0.32 * down; ry += 0.15 * down;
    if (g.mag) g.mag.position.set(g.magRest.x, g.magRest.y - 0.3 * magDrop, g.magRest.z);
  } else if (g.mag) g.mag.position.copy(g.magRest);

  if (drawT > 0) { const d = drawT / w.draw; p.y -= d * d * 0.28; rx -= d * d * 0.9; }
  p.x -= 0.05 * sprintT; p.y -= 0.03 * sprintT; ry += 0.55 * sprintT; rx -= 0.22 * sprintT;
  if (!me.onGround) p.y += clamp(me.vel.y * 0.004, -0.03, 0.03);

  vm.rotation.set(rx, ry, rz);
  const scoped = !!w.scope && adsT > 0.9;
  vm.visible = me.alive && !scoped;
  setDisplay(scopeEl, scoped && me.alive);

  // 뷰모델 조명을 월드 태양 방향에 맞춤
  vmSun.position.copy(world.sunDir).applyQuaternion(_q.copy(camera.quaternion).invert());
}
const _q = new THREE.Quaternion();

// ───────── 적 갱신 ─────────
function angLerp(a, b, t) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 18);
  for (const e of remotes.values()) {
    const rig = e.rig, s = rig.soldier;
    s.root.visible = e.hasPos;
    if (!e.hasPos) continue;
    const px = e.pos.x, pz = e.pos.z;
    if (e.pos.distanceToSquared(e.tpos) > 36) e.pos.copy(e.tpos);
    else e.pos.lerp(e.tpos, k);
    e.yaw = angLerp(e.yaw, e.tyaw, k);
    e.pitch = lerp(e.pitch, e.tpitch, k);
    e.crouch = lerp(e.crouch, e.crouchT, 1 - Math.exp(-dt * 12));
    const moved = Math.hypot(e.pos.x - px, e.pos.z - pz);
    const c = e.crouch;
    s.root.position.copy(e.pos);
    s.root.rotation.y = e.yaw;
    const hipY = lerp(0.86, 0.45, c);
    s.upper.position.y = hipY;
    if (e.alive) {
      e.deadT = 0;
      s.root.rotation.x = 0;
      e.walk += moved * 3.4;
      const amp = Math.min(0.7, moved / Math.max(dt, 0.001) * 0.14);
      s.legs.forEach((leg, i) => {
        leg.position.y = hipY; leg.scale.y = lerp(1, 0.52, c);
        leg.rotation.x = Math.sin(e.walk + i * Math.PI) * amp - c * 0.5 * (i ? 1 : -1.6);
      });
      s.aim.rotation.x = e.pitch;
      s.upper.rotation.x = -e.pitch * 0.25 - c * 0.18;
      if (moved > 0.001 && e.pos.y === e.tpos.y) {
        e.stepDist += moved;
        if (e.stepDist > 2.1) { e.stepDist = 0; const a = audioAt(e.pos); sfx.step(0.9 * a.att * (1 - 0.6 * c), a.pan); }
      }
    } else {
      e.deadT = Math.min(1, e.deadT + dt * 2.6);
      const t = smooth(0, 1, e.deadT);
      s.root.rotation.x = t * Math.PI / 2;
      s.root.position.y = e.pos.y + t * 0.14;
      s.aim.rotation.x = lerp(s.aim.rotation.x, 0.9, k);
    }
    rig.guns.forEach((g, i) => { g.group.visible = i === e.weapon; });
    rig.flashT -= dt;
    rig.flash.visible = rig.flashT > 0;
  }
}

function audioAt(pos) {
  const dx = pos.x - me.pos.x, dz = pos.z - me.pos.z, dist = Math.hypot(dx, dz, pos.y - me.pos.y);
  const right = dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw);
  return { dist, pan: dist > 0.5 ? clamp(right / dist, -1, 1) * 0.85 : 0, att: 1 / (1 + dist / 9) };
}

// ───────── HUD ─────────
const hudEl = $('hud'), crossEl = $('cross'), scopeEl = $('scope'), hitEl = $('hitm'), vigEl = $('vig'), dirEl = $('dmgdir');
const crossParts = { l: crossEl.querySelector('.l'), r: crossEl.querySelector('.r'), t: crossEl.querySelector('.t'), b: crossEl.querySelector('.b') };
const cache = new Map();
function setText(el, v) { if (cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } }
function setDisplay(el, on, mode = 'block') { const v = on ? mode : 'none'; if (el.style.display !== v) el.style.display = v; }
function setClass(el, name, on) { if (el.classList.contains(name) !== on) el.classList.toggle(name, on); }

const slotsEl = $('slots');
const slotEls = WEAPONS.map((w, i) => { const d = document.createElement('div'); d.innerHTML = `<span>${i + 1}</span>${w.name}`; slotsEl.appendChild(d); return d; });

let hitT = 0, vigT = 0, dirT = 0, dirFrom = null;
function showHit(head) { hitT = 0.22; setClass(hitEl, 'head', head); sfx.hitmarker(head); }

function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d);
  setTimeout(() => d.remove(), 5200);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function updateHud(dt, active) {
  const w = WEAPONS[cur], st = inv[cur];
  // 조준선
  const gap = Math.max(4, Math.tan(currentSpread() * DEG) / Math.tan(camera.fov * DEG / 2) * innerHeight / 2);
  crossParts.l.style.left = `${-gap - 9}px`; crossParts.r.style.left = `${gap}px`;
  crossParts.t.style.top = `${-gap - 9}px`; crossParts.b.style.top = `${gap}px`;
  crossEl.style.opacity = (!me.alive || adsT > 0.35 || sprintT > 0.6 || matchState === 'ended') ? 0 : 1;

  hitT -= dt; hitEl.style.opacity = clamp(hitT / 0.12, 0, 1);
  vigT = Math.max(0, vigT - dt * 1.2);
  vigEl.style.opacity = Math.max(vigT, me.alive ? clamp((45 - me.hp) / 60, 0, 0.6) : 0);
  dirT -= dt;
  if (dirT > 0 && dirFrom) {
    const dx = dirFrom.x - me.pos.x, dz = dirFrom.z - me.pos.z;
    const f = -Math.sin(me.yaw) * dx - Math.cos(me.yaw) * dz, r = Math.cos(me.yaw) * dx - Math.sin(me.yaw) * dz;
    dirEl.style.transform = `rotate(${Math.atan2(r, f)}rad)`;
    dirEl.style.opacity = clamp(dirT / 0.5, 0, 1);
  } else dirEl.style.opacity = 0;

  setText($('hpV'), String(Math.max(0, Math.ceil(me.hp))));
  const hb = $('hpB'); hb.style.width = `${clamp(me.hp, 0, 100)}%`;
  hb.style.background = me.hp <= 30 ? 'var(--danger)' : me.hp <= 60 ? 'var(--accent)' : 'var(--ui)';

  setText($('amC'), String(st.ammo)); setText($('amR'), `/ ${st.reserve}`);
  setClass($('amC'), 'low', st.ammo <= Math.ceil(w.mag * 0.25));
  setText($('wN'), w.name);
  setText($('wC'), `${w.cls} · ${w.auto ? '연사' : w.bolt ? '볼트액션' : w.shell ? '펌프액션' : '단발'}`);
  slotEls.forEach((el, i) => { setClass(el, 'on', i === cur); setClass(el, 'empty', inv[i].ammo + inv[i].reserve === 0); });

  let hint = '';
  if (me.alive && !reload) {
    if (st.ammo === 0 && st.reserve === 0) hint = '탄약 없음 — 다른 무기로 교체하세요';
    else if (st.ammo === 0) hint = '[R] 재장전';
    else if (st.ammo <= Math.ceil(w.mag * 0.25) && st.reserve > 0) hint = '탄약 부족 · [R] 재장전';
  }
  const hintEl = $('hint'); setText(hintEl, hint || cache.get(hintEl) || ''); hintEl.style.opacity = hint ? 1 : 0;

  const rb = $('rbar');
  setDisplay(rb, !!reload && me.alive);
  if (reload) rb.firstElementChild.style.width = `${clamp(reload.t / reload.total, 0, 1) * 100}%`;

  updateScoreboard();
  setDisplay($('dead'), !me.alive && matchState === 'playing', 'flex');
  if (!me.alive) setText($('deadT'), `${Math.max(0, (respawnAt - performance.now()) / 1000).toFixed(1)}초 후 재투입`);
  setDisplay($('endscr'), matchState === 'ended', 'flex');
  if (matchState === 'ended') setText($('endR'), `${Math.max(0, Math.ceil((endAt - performance.now()) / 1000))}초 후 다음 경기 시작`);
}

function banner(html) { const b = $('banner'); b.innerHTML = html || ''; setDisplay(b, !!html); }

// ───────── 순위표 ─────────
const byRank = (a, b) => b.k - a.k || a.d - b.d;
function updateScoreboard() {
  const left = Math.max(0, matchEndsAt - performance.now());
  setText($('timer'), matchState === 'ended' ? '종료' : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`);
  const list = [...roster.values()].sort(byRank);
  const rows = list.slice(0, 5);
  const mine = roster.get(me.id);
  if (mine && !rows.includes(mine)) rows.push(mine);
  const html = rows.map(p => `<div class="${p.id === me.id ? 'me' : ''}"><span class="nm">${list.indexOf(p) + 1}. ${esc(p.name)}</span><span class="mono">${p.k}</span></div>`).join('');
  const lb = $('lb');
  if (cache.get(lb) !== html) { cache.set(lb, html); lb.innerHTML = html; }
}
function showEnd(winnerId) {
  const list = [...roster.values()].sort(byRank);
  const win = winnerId === me.id, t = $('endT');
  t.textContent = win ? '승리' : '경기 종료'; t.className = win ? 'win' : 'lose';
  const mine = roster.get(me.id) || { k: 0, d: 0 };
  $('endS').textContent = `우승 ${nameOf(winnerId)}  ·  내 순위 ${list.findIndex(p => p.id === me.id) + 1}위 (${mine.k}킬 ${mine.d}데스)`;
  $('endBoard').innerHTML = list.slice(0, 6).map((p, i) =>
    `<div class="${p.id === me.id ? 'me' : ''}"><span>${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="mono">${p.k} / ${p.d}</span></div>`).join('');
}
const rosterSet = p => roster.set(p.id, { id: p.id, name: p.name, bot: !!p.bot, k: p.k | 0, d: p.d | 0 });
const nameOf = id => (roster.get(id) || {}).name || '?';
function applyScores(sc) { for (const [id, k, d] of sc) { const p = roster.get(id); if (p) { p.k = k; p.d = d; } } }

// ───────── 네트워크 ─────────
const net = {
  ws: null,
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
};

function resetLoadout() { WEAPONS.forEach((w, i) => { inv[i].ammo = w.mag; inv[i].reserve = w.reserve; }); reload = null; cooldown = 0; bloom = 0; }
function placeMe(p) {
  me.pos.set(p[0], p[1], p[2]); me.vel.set(0, 0, 0);
  me.yaw = Math.atan2(p[0], p[2]) || 0; me.pitch = 0; kickP = kickY = 0;
  me.hp = MAX_HP; me.alive = true; me.crouch = false; me.onGround = true; me.stepOff = 0; me.deadT = 0;
  resetLoadout(); drawT = WEAPONS[cur].draw; showGun();
}

function connect(name) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  net.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    const was = joined; joined = false; net.ws = null;
    clearRemotes(); matchState = 'idle';
    if (document.pointerLockElement) document.exitPointerLock();
    setDisplay($('pause'), false); setDisplay($('menu'), true, 'flex'); hudEl.classList.remove('on');
    $('join').disabled = false;
    if (!fullMsg) $('msg').textContent = was ? '서버와의 연결이 끊어졌습니다.' : '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.';
  };
}
let fullMsg = false;

function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      joined = true; me.id = m.id; fullMsg = false;
      clearRemotes();
      goalKills = m.goal; matchState = m.state; matchEndsAt = performance.now() + m.left; endAt = performance.now() + 10000;
      for (const p of m.players) { rosterSet(p); if (p.id !== m.id) addRemote(p); }
      setText($('goal'), `${goalKills}킬 선승`);
      setDisplay($('menu'), false); hudEl.classList.add('on');
      if (matchState === 'ended') showEnd(-1);
      if (!NOLOCK) setDisplay($('pause'), true, 'flex');
      break;
    }
    case 'pj':
      rosterSet(m.player); addRemote(m.player);
      if (!m.player.bot) feed(`<span class="w">${esc(m.player.name)} 입장</span>`);
      break;
    case 'pl': {
      const p = roster.get(m.id);
      if (p && !p.bot) feed(`<span class="w">${esc(p.name)} 퇴장</span>`);
      roster.delete(m.id); removeRemote(m.id);
      break;
    }
    case 'start':
      matchState = 'playing'; goalKills = m.goal; matchEndsAt = performance.now() + m.left;
      roster.clear();
      for (const p of m.players) { rosterSet(p); if (p.id !== me.id) addRemote(p); }
      setText($('goal'), `${goalKills}킬 선승`);
      feed('<span class="w">새 경기 시작</span>');
      break;
    case 'spawn':
      if (m.id === me.id) placeMe(m.p);
      else {
        const r = remotes.get(m.id);
        if (r) { r.alive = true; r.hasPos = true; r.deadT = 0; r.tpos.fromArray(m.p); r.pos.fromArray(m.p); }
      }
      break;
    case 's': {
      const r = remotes.get(m.id);
      if (!r) break;
      r.tpos.fromArray(m.p); r.tyaw = m.y; r.tpitch = m.x; r.crouchT = m.c ? 1 : 0; r.weapon = m.w | 0;
      if (!r.hasPos) { r.hasPos = true; r.pos.copy(r.tpos); }
      break;
    }
    case 'shot': {
      const w = WEAPONS[m.w]; if (!w) break;
      const o = new V3().fromArray(m.o), a = audioAt(o);
      sfx.shot(w, a.dist, a.pan);
      if (w.bolt) sfx.mech('bolt', a.att, a.pan, 0.5);
      const r = remotes.get(m.id);
      if (r) { r.rig.flash.position.copy(o); r.rig.flashT = 0.05; }
      for (const e of m.e || []) {
        const end = new V3(e[0], e[1], e[2]);
        addTracer(o, end);
        if (e[3] !== 6) { impact(end, e[3]); const ia = audioAt(end); if (ia.dist < 12) sfx.impact(ia.dist, ia.pan); }
      }
      break;
    }
    case 'rl': {
      const r = remotes.get(m.id);
      if (!r) break;
      const a = audioAt(r.pos); sfx.mech('magout', a.att, a.pan, 0.2); sfx.mech('magin', a.att, a.pan, 1.2);
      break;
    }
    case 'dmg':
      if (m.to === me.id) {
        const src = remotes.get(m.from);
        me.hp = m.hp; vigT = Math.min(1, 0.45 + m.dmg / 80); dirT = 1.4; dirFrom = src ? src.pos : null;
        kickP += (Math.random() - 0.3) * 0.02; kickY += (Math.random() - 0.5) * 0.02;
        sfx.hurt();
        _v.copy(me.pos); _v.y += 1.2; impact(_v, -1);
      } else {
        const r = remotes.get(m.to);
        if (r) { _v.copy(r.pos); _v.y += lerp(1.25, 0.8, r.crouch); impact(_v, 6); }
      }
      break;
    case 'hp': me.hp = m.hp; break;
    case 'chat': addChatLine(String(m.name), String(m.text), m.id === me.id); break;
    case 'kill': {
      applyScores(m.sc);
      const mine = m.killer === me.id, iDie = m.victim === me.id, w = WEAPONS[m.w];
      const kn = nameOf(m.killer), vn = nameOf(m.victim);
      feed(`<span class="${mine ? 'a' : 'e'}">${esc(kn)}</span><span class="w">[${w ? w.name : '?'}]</span><span class="${iDie ? 'a' : 'e'}">${esc(vn)}</span>${m.head ? '<span class="hs">헤드샷</span>' : ''}`);
      if (mine) sfx.kill();
      if (iDie) {
        me.alive = false; me.hp = 0; reload = null; respawnAt = performance.now() + RESPAWN_MS;
        setText($('deadBy'), `${kn} 의 ${w ? w.name : ''}${m.head ? ' · 헤드샷' : ''}`);
      } else {
        const r = remotes.get(m.victim);
        if (r) r.alive = false;
      }
      break;
    }
    case 'end':
      applyScores(m.sc);
      matchState = 'ended'; endAt = performance.now() + (m.restart || 10000);
      showEnd(m.winner);
      break;
  }
}

let sendAcc = 0;
function sendState(dt) {
  sendAcc += dt;
  if (!joined || sendAcc < 0.05) return;
  sendAcc = 0;
  net.send({
    t: 's', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)],
    y: +me.yaw.toFixed(3), x: +(me.pitch + kickP).toFixed(3), c: me.crouch ? 1 : 0, w: cur,
  });
}

// ───────── 입력 ─────────
// ───────── 채팅 ─────────
// 채팅창이 열려 있는 동안에는 isActive() 가 false → 이동/사격/무기교체 입력이 모두 꺼진다.
let chatOpen = false;
const chatEl = $('chat'), chatIn = $('chatIn'), chatLog = $('chatLog');
function openChat() {
  chatOpen = true; keys.clear(); fireHeld = adsHeld = fireFresh = false;
  chatEl.classList.add('open'); chatIn.value = ''; chatIn.focus();
}
function closeChat() { chatOpen = false; chatEl.classList.remove('open'); chatIn.blur(); }
function sendChat() {
  const text = chatIn.value.trim();
  if (text) net.send({ t: 'chat', text });
  closeChat();
}
function addChatLine(name, text, mine) {
  // textContent 계열만 사용해서 HTML 이 주입될 수 없게 한다
  const line = document.createElement('div'), who = document.createElement('b');
  who.textContent = name; if (mine) who.className = 'me';
  line.append(who, document.createTextNode(` ${text}`));
  chatLog.append(line);
  while (chatLog.children.length > 8) chatLog.firstChild.remove();
  setTimeout(() => line.remove(), 10500);
}
chatIn.addEventListener('keydown', e => {
  e.stopPropagation(); // 게임 단축키로 전달되지 않게
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); } // 한글 조합 중 Enter 는 제외
  else if (e.key === 'Escape') closeChat();
});

const isActive = () => joined && !chatOpen && (NOLOCK || document.pointerLockElement === canvas);
addEventListener('keydown', e => {
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && isActive()) { e.preventDefault(); openChat(); }
});
function lock() { sfx.init(); const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); }

document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  if (joined) setDisplay($('pause'), !on, 'flex');
  if (!on) { keys.clear(); fireHeld = adsHeld = fireFresh = false; if (chatOpen) closeChat(); }
});
$('pause').addEventListener('click', e => { if (!e.target.closest('.opt')) lock(); });
canvas.addEventListener('click', () => { if (joined && !isActive()) lock(); });

addEventListener('keydown', e => {
  if (!isActive()) return;
  if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyQ', 'KeyT'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  else if (e.code === 'KeyQ') switchTo(prevWeapon);
  else if (/^Digit[1-9]$/.test(e.code)) switchTo(Number(e.code.slice(5)) - 1);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); fireHeld = adsHeld = false; });
addEventListener('mousedown', e => {
  if (!isActive()) return;
  if (e.button === 0) { fireHeld = true; fireFresh = true; }
  else if (e.button === 2) adsHeld = true;
});
addEventListener('mouseup', e => { if (e.button === 0) fireHeld = false; else if (e.button === 2) adsHeld = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || !me.alive || chatOpen) return;
  // 일부 브라우저에서 간헐적으로 튀는 값 방지
  const dx = clamp(e.movementX, -400, 400), dy = clamp(e.movementY, -400, 400);
  const k = 0.0022 * sens * Math.tan(camera.fov * DEG / 2) / Math.tan(BASE_FOV * DEG / 2);
  me.yaw -= dx * k;
  me.pitch = clamp(me.pitch - dy * k, -PITCH_MAX, PITCH_MAX);
  mdx += dx; mdy += dy;
});
let wheelAt = 0;
addEventListener('wheel', e => {
  if (!isActive()) return;
  const now = performance.now(); if (now - wheelAt < 120) return; wheelAt = now;
  switchTo((cur + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
}, { passive: true });

// 메뉴
const nameEl = $('name');
nameEl.value = localStorage.getItem('fd_name') || '';
function join() {
  const name = nameEl.value.trim().slice(0, 14) || `병사${Math.floor(Math.random() * 900 + 100)}`;
  me.name = name; localStorage.setItem('fd_name', name);
  $('msg').textContent = ''; $('join').disabled = true; fullMsg = false;
  sfx.init();
  connect(name);
}
$('join').addEventListener('click', join);
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

const sensEl = $('sens'), volEl = $('vol');
sensEl.value = sens; $('sensV').textContent = sens.toFixed(2);
sensEl.addEventListener('input', () => { sens = Number(sensEl.value); $('sensV').textContent = sens.toFixed(2); localStorage.setItem('fd_sens', sens); });
const savedVol = localStorage.getItem('fd_vol');
if (savedVol !== null) { volEl.value = savedVol; sfx.volume = Number(savedVol); }
$('volV').textContent = Number(volEl.value).toFixed(2);
volEl.addEventListener('input', () => { const v = Number(volEl.value); sfx.setVolume(v); $('volV').textContent = v.toFixed(2); localStorage.setItem('fd_vol', v); });

// ───────── 메인 루프 ─────────
let last = performance.now(), menuAngle = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const active = isActive();

  if (joined) {
    updateMovement(dt, active);
    updateWeapon(dt, active);
    const w = WEAPONS[cur];
    const fov = lerp(BASE_FOV, w.adsFov, smooth(0, 1, adsT)) + sprintT * 4;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    let eye = me.h - 0.13, roll = 0;
    if (!me.alive) { me.deadT = Math.min(1, me.deadT + dt * 2.2); const e = smooth(0, 1, me.deadT); eye = lerp(eye, 0.3, e); roll = e * 0.6; }
    camera.position.set(me.pos.x, me.pos.y + eye + me.stepOff, me.pos.z);
    camera.rotation.set(clamp(me.pitch + kickP, -PITCH_MAX, PITCH_MAX), me.yaw + kickY, roll);
    camera.updateMatrixWorld();
    updateViewmodel(dt);
    sendState(dt);
  } else {
    // 메뉴 배경: 전장을 천천히 선회
    menuAngle += dt * 0.05;
    camera.position.set(Math.sin(menuAngle) * 48, 16, Math.cos(menuAngle) * 48);
    camera.lookAt(0, 2, 0);
    vm.visible = false;
  }
  mdx = mdy = 0;

  updateRemotes(dt);
  updateTracers(dt);
  updateParts(dt);
  if (joined) updateHud(dt, active);

  renderer.clear();
  renderer.render(scene, camera);
  if (vm.visible) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}
requestAnimationFrame(frame);

// 라이브(prod)가 아닌 서버에서는 화면 아래에 환경 이름을 표시해 헷갈리지 않게 한다
fetch('/status').then(r => r.json()).then(st => {
  if (st.env === 'prod') return;
  const t = $('envtag'); t.textContent = `${String(st.env).toUpperCase()} · v${st.version}`; t.style.display = 'block';
}).catch(() => {});

// 디버그 / 자동 테스트 훅
window.__g = { me, remotes, roster, inv, net, remoteHit, get cur() { return cur; }, get state() { return matchState; }, switchTo, startReload,
  input(o) { if ('fire' in o) { fireHeld = o.fire; if (o.fire) fireFresh = true; } if ('ads' in o) adsHeld = o.ads; if (o.key) keys.add(o.key); if (o.keyUp) keys.delete(o.keyUp); } };
if (params.get('auto')) { nameEl.value = params.get('auto'); join(); }
