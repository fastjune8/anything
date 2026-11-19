// 다른 플레이어(사람/봇): 스냅샷 보간, 3인칭 모델·애니메이션, 상태 연출(슬라이딩·넘어짐·투명·부활 보호·등장), 이름표
//   네트워크: 서버는 30Hz 로 위치를 보낸다. 받은 스냅샷을 버퍼에 쌓고, 서버 시각보다 0.1초 앞(clock.render)을 두 스냅샷 사이로 보간해 그린다
//   → 끊김 없이 부드럽고, 그 vt 를 입력에 붙여 보내면 서버가 같은 순간으로 되감아 판정한다 (오버워치·CS 와 같은 방식)
//   모델: 캐릭터 glb(charassets.js) + TPAnimator. 불러오지 못하면 상자 병사
import * as THREE from 'three';
import { MAX_HP } from '/shared/constants.js';
import { MAX_PLAYERS } from '/shared/modes.js';
import { WEAPONS } from '/shared/weapons.js';
import { PF } from '/shared/sim/config.js';
import { clock } from './clock.js';
import { buildGun, buildSoldier } from './guns.js';
import { TPAnimator, RIFLE_WEAPONS, newCharState } from './charanim.js';
import { scene, camera } from './scene.js';
import { flashTex } from './textures.js';
import { sfx, audioAt } from './sfx.js';
import { isAlly } from './state.js';
import { V3, MODE_CFG, lerp, smooth, angLerp } from './util.js';
import { dress, setOutfit, setTeamColor } from './outfit.js';
import { unpackOutfit } from '/shared/cosmetics.js';

// 3인칭 모델은 방 최대 인원만큼 미리 만들어 두고, 들어오는 사람에게 하나씩 배정한다.
const RIG_COLORS = [[0x6a6048, 0x3a3d2c], [0x4a5a6a, 0x2c333d], [0x6a4a48, 0x3d2c2c], [0x4a6a52, 0x2c3d33],
  [0x6a6a48, 0x3d3d2c], [0x5a4a6a, 0x332c3d], [0x48666a, 0x2c3d3d], [0x6a5448, 0x3d332c]];
const TAG_W = 160, TAG_H = 36;      // 이름표 캔버스 크기
const TEAM_MODE = () => MODE_CFG.teams > 0;
const TAG_RANGE = 90;                // 이 거리(m) 밖에서는 이름표를 숨긴다
const TEAM_COLORS = { ally: [0x3f5f8a, 0x243650], foe: [0x8a3d35, 0x4f231f] };
// 캐릭터 모델이 있으면 그것, 없으면 예전 상자 병사 (soldier 와 같은 모양의 객체: root, mats)
function makeBody(i) {
  const [uniform, vest] = RIG_COLORS[i % RIG_COLORS.length];
  const anim = TPAnimator.create();
  if (!anim) return { soldier: buildSoldier({ uniform, vest }), anim: null };
  const tint = { color: new THREE.Color() };
  return { soldier: { root: anim.root, mats: { uniform: tint.color, vest: new THREE.Color() } }, anim, tint };
}
// 팀/사람 색: 옷을 입었으면 옷의 team 색 칸, 아니면(옷 기능 이전) 캐릭터 재질 색을 기본 회색과 섞는다
function paintBody(rig, hex) {
  if (!rig.anim) return;
  if (rig.outfit) { setTeamColor(rig.outfit, hex); return; }
  for (const m of rig.anim.inst.mats) m.color.setHex(0xadadad).lerp(new THREE.Color(hex), 0.45);
}
function makeRig(i) {
  const { soldier, anim } = makeBody(i);
  soldier.root.visible = false;
  scene.add(soldier.root);
  const guns = WEAPONS.map(w => {
    const g = buildGun(w.id, false, {}, false); g.group.visible = false; // 작게 보이므로 질감 셰이더 없이
    if (!anim) soldier.gunSlot.add(g.group);
    g.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  });
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  flash.scale.setScalar(0.7); flash.visible = false; scene.add(flash);
  // 머리 위 이름표 + 체력바 (벽 뒤에서는 가려진다)
  const tagCanvas = document.createElement('canvas'); tagCanvas.width = TAG_W; tagCanvas.height = TAG_H;
  const tagTex = new THREE.CanvasTexture(tagCanvas); tagTex.colorSpace = THREE.SRGBColorSpace;
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthWrite: false, fog: false, toneMapped: false }));
  bar.center.set(0.5, 0); // 아래쪽을 기준으로 해서 크기가 커져도 머리를 가리지 않고 위로 자란다
  bar.visible = false; scene.add(bar);
  const rig = { soldier, anim, guns, flash, flashT: 0, used: false, bar, tagCanvas, tagTex, tagKey: '', cs: newCharState(), ck: 'null' };
  rig.outfit = anim ? dress(anim.inst, unpackOutfit(null), { view: 'tp' }) : null; // 기본 옷. 입장 정보(ck)를 받으면 바뀐 슬롯만 갈아입는다
  paintBody(rig, RIG_COLORS[i % RIG_COLORS.length][0]);
  return rig;
}
// 이름 + 체력바를 캔버스에 그린다. 이름/체력/팀이 바뀔 때만 다시 그린다.
function drawTag(rig, name, hp, ally) {
  const g = rig.tagCanvas.getContext('2d'), k = Math.max(0, Math.min(1, hp / MAX_HP));
  g.clearRect(0, 0, TAG_W, TAG_H);
  g.font = 'bold 17px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let label = name;
  while (label.length > 1 && g.measureText(label).width > TAG_W - 8) label = label.slice(0, -1); // 너무 길면 자른다
  if (label !== name) label += '…';
  g.lineWidth = 4; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(label, TAG_W / 2, 12);
  g.fillStyle = TEAM_MODE() ? (ally ? '#7fbcff' : '#ff8a7d') : '#ffffff'; g.fillText(label, TAG_W / 2, 12);
  g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(16, 25, TAG_W - 32, 9);
  g.fillStyle = ally ? '#5aa9ff' : k > 0.6 ? '#e9ecef' : k > 0.3 ? '#ffb43a' : '#ff4b3a';
  g.fillRect(17, 26, Math.round((TAG_W - 34) * k), 7);
  rig.tagTex.needsUpdate = true;
}
const rigs = Array.from({ length: MAX_PLAYERS }, (_, i) => makeRig(i));

export const remotes = new Map(); // id → 원격 플레이어

// 부활 보호 막 · 그래플 줄 (모두 공용 재질)
const bubbleGeo = new THREE.SphereGeometry(0.62, 18, 12);
const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
const ropeMat = new THREE.LineBasicMaterial({ color: 0x2a2a2a });
function extras(rig) {
  if (rig.bubble) return;
  rig.bubble = new THREE.Mesh(bubbleGeo, bubbleMat); rig.bubble.scale.set(1, 1.55, 1); rig.bubble.visible = false; scene.add(rig.bubble);
  const g = new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]);
  rig.rope = new THREE.Line(g, ropeMat); rig.rope.visible = false; rig.rope.frustumCulled = false; scene.add(rig.rope);
}

export function addRemote(info) {
  let r = remotes.get(info.id);
  if (!r) {
    const rig = rigs.find(x => !x.used);
    if (!rig) return null;
    rig.used = true; extras(rig);
    r = {
      id: info.id, rig, name: '', bot: false, alive: false, hasPos: false, buf: [],
      pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, crouch: 0, flags: 0, weapon: 0, hp: MAX_HP, team: -1,
      deadT: 0, stepDist: 0, adsT: 0, shots: 0, reload: null, slideK: 0, stunK: 0, introT: 0, hook: null, shotAt: -1e9,
    };
    remotes.set(info.id, r);
  }
  r.name = info.name; r.bot = !!info.bot; r.alive = !!info.alive; r.lvl = info.lvl || 0;
  r.lo = Array.isArray(info.lo) ? info.lo : null;
  const ck = JSON.stringify(info.ck ?? null);
  if (r.rig.outfit && r.rig.ck !== ck) { setOutfit(r.rig.outfit, unpackOutfit(info.ck)); r.rig.ck = ck; }
  if (typeof info.hp === 'number') r.hp = info.hp;
  r.team = info.team ?? -1;
  if (MODE_CFG.teams) {
    const [uniform, vest] = isAlly(r.team) ? TEAM_COLORS.ally : TEAM_COLORS.foe;
    if (r.rig.anim) paintBody(r.rig, uniform);
    else { r.rig.soldier.mats.uniform.color.setHex(uniform); r.rig.soldier.mats.vest.color.setHex(vest); }
  }
  r.rig.tagKey = '';
  return r;
}
export function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  const rig = r.rig;
  rig.used = false; rig.soldier.root.visible = false; rig.flash.visible = false; rig.bar.visible = false; rig.tagKey = '';
  rig.bubble.visible = false; rig.rope.visible = false;
  remotes.delete(id);
}
export function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

// ───── 스냅샷 ─────
// row = [id, x, y, z, yaw, pitch, flags, 무기번호, hp, 앉은 정도, vx, vy, vz]
export function onSnapshot(n, rows) {
  const seen = new Set();
  for (const a of rows) {
    const r = remotes.get(a[0]);
    if (!r) continue;
    seen.add(r.id);
    r.buf.push({ n, x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5], f: a[6], w: a[7], hp: a[8], c: a[9], vx: a[10], vy: a[11], vz: a[12] });
    if (r.buf.length > 30) r.buf.shift();
    if (!r.hasPos) { r.hasPos = true; r.pos.set(a[1], a[2], a[3]); r.yaw = a[4]; }
  }
}
export function remoteSpawn(id, p, yaw) {
  const r = remotes.get(id);
  if (!r) return;
  r.alive = true; r.hasPos = true; r.deadT = 0; r.hp = MAX_HP; r.buf.length = 0; r.pos.fromArray(p); r.yaw = yaw; r.reload = null; r.flags = PF.protect | PF.intro; r.introT = 0;
}
export function remoteDied(id) { const r = remotes.get(id); if (r) { r.alive = false; r.hp = 0; r.reload = null; r.hook = null; } }
export function remoteFired(r) { r.shots++; r.shotAt = performance.now(); r.flags &= ~PF.protect; }
export function remoteReload(r, wi) { const w = WEAPONS[wi]; if (!w || w.shell) return; r.reload = { start: performance.now(), total: w.reload, wi }; }
export function remoteHook(id, p) { const r = remotes.get(id); if (r) r.hook = new V3().fromArray(p); }
export const RIFLE_INDEX = new Set(WEAPONS.map((w, i) => (RIFLE_WEAPONS.has(w.id) ? i : -1)).filter(i => i >= 0));

// 두 스냅샷 사이를 잇는다 (없으면 마지막 것을 속도로 조금 앞서 본다)
function sample(r, rt) {
  const b = r.buf;
  if (!b.length) return null;
  let i = b.length - 1;
  while (i > 0 && b[i - 1].n > rt) i--;
  const B = b[i], A = i > 0 ? b[i - 1] : null;
  if (A && A.n <= rt && B.n > A.n) {
    const k = Math.min(1, (rt - A.n) / (B.n - A.n));
    return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, yaw: angLerp(A.yaw, B.yaw, k), pitch: A.pitch + (B.pitch - A.pitch) * k, c: A.c + (B.c - A.c) * k, vx: B.vx, vy: B.vy, vz: B.vz, f: k < 0.5 ? A.f : B.f, w: B.w, hp: B.hp };
  }
  const ex = Math.max(0, Math.min(3, rt - B.n)) / 60; // 마지막 이후: 최대 3 tick 까지만 앞서 본다
  return { x: B.x + B.vx * ex, y: B.y + B.vy * ex, z: B.z + B.vz * ex, yaw: B.yaw, pitch: B.pitch, c: B.c, vx: B.vx, vy: B.vy, vz: B.vz, f: B.f, w: B.w, hp: B.hp };
}

// ───── 내가 쏠 때 예측 판정용: 지금 화면에 보이는 적 ─────
export function liveTargets() {
  const out = [];
  for (const r of remotes.values()) {
    if (!r.alive || !r.hasPos || isAlly(r.team) || (r.flags & (PF.protect | PF.invuln))) continue;
    out.push({ id: r.id, x: r.pos.x, y: r.pos.y, z: r.pos.z, crouch: r.crouch });
  }
  return out;
}

// ───── 그리기 ─────
function animateBody(e, dt) {
  const rig = e.rig, s = rig.soldier, cs = rig.cs;
  const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  cs.fwd = -e.vel.x * sy - e.vel.z * cy; cs.side = e.vel.x * cy - e.vel.z * sy;
  cs.air = !!(e.flags & PF.air) && !(e.flags & PF.grapple); cs.vy = e.vel.y; cs.sprint = !!(e.flags & PF.sprint);
  e.adsT = lerp(e.adsT, e.flags & PF.ads ? 1 : 0, 1 - Math.exp(-dt * 12));
  cs.ads = e.adsT; cs.pitch = e.pitch; cs.alive = e.alive; cs.rifle = RIFLE_INDEX.has(e.weapon);
  const now = performance.now(), rf = e.reload ? (now - e.reload.start) / 1000 / e.reload.total : 0;
  if (e.reload && (rf >= 1 || e.reload.wi !== e.weapon || !e.alive)) e.reload = null;
  cs.reloadF = e.reload ? rf : null; cs.shots = e.shots;
  if (rig.anim) rig.anim.setGun(rig.guns[e.weapon] || null);
  // 몸 자세: 슬라이딩(뒤로 눕듯), 넘어짐, 앉기, 쓰러짐 — 클립 위에 몸 전체 변형으로
  e.slideK = lerp(e.slideK, e.flags & PF.slide ? 1 : 0, 1 - Math.exp(-dt * 14));
  e.stunK = lerp(e.stunK, e.flags & PF.stun ? 1 : 0, 1 - Math.exp(-dt * 16));
  const root = s.root;
  root.scale.set(1, lerp(1, 0.74, Math.min(1, e.crouch) * (1 - e.slideK)), 1);
  let rx = -0.75 * e.slideK + 1.1 * e.stunK, dy = -0.25 * e.slideK - 0.2 * e.stunK;
  if (!e.alive) {
    e.deadT = Math.min(1, e.deadT + dt * 2.6);
    const t = smooth(0, 1, e.deadT);
    rx = t * Math.PI / 2; dy = t * 0.14;
    cs.fwd = cs.side = 0; cs.ads = 0; cs.reloadF = null;
  } else e.deadT = 0;
  root.rotation.x = rx; root.position.y = e.pos.y + dy;
  if (e.introT < 1) { e.introT = Math.min(1, e.introT + dt / 0.7); const k = smooth(0, 1, e.introT); root.scale.multiplyScalar(lerp(0.4, 1, k)); }
  if (rig.anim) {
    const dist = e.pos.distanceTo(camera.position);
    e.animAcc = (e.animAcc || 0) + dt;
    const every = dist > 60 ? 1 / 15 : dist > 30 ? 1 / 30 : 0;
    if (root.visible && (e.animAcc >= every || !e.animInit)) { rig.anim.update(Math.min(e.animAcc, 0.1), cs); e.animAcc = 0; e.animInit = true; }
  } else rig.guns.forEach((g, i) => { g.group.visible = i === e.weapon; });
}
function finish(e, dt) {
  const rig = e.rig, c = e.crouch;
  const dist = e.pos.distanceTo(camera.position);
  rig.bar.position.set(e.pos.x, e.pos.y + lerp(rig.anim ? 1.72 : 1.85, 1.35, Math.min(1, c)), e.pos.z);
  const f = Math.min(3.4, Math.max(1, dist / 14)), w = 0.75 * f;
  rig.bar.scale.set(w, w * TAG_H / TAG_W, 1);
  const key = `${e.name}|${e.hp}|${isAlly(e.team)}`;
  if (rig.tagKey !== key) { drawTag(rig, e.name, e.hp, isAlly(e.team)); rig.tagKey = key; }
  rig.flashT -= dt; rig.flash.visible = rig.flashT > 0;
  // 부활 보호 막 (기획 5.3: 외형으로 보호 상태를 알 수 있게)
  const prot = e.alive && !!(e.flags & PF.protect);
  rig.bubble.visible = prot || (e.alive && !!(e.flags & PF.invuln));
  if (rig.bubble.visible) { rig.bubble.position.set(e.pos.x, e.pos.y + 0.95, e.pos.z); bubbleMat.opacity = 0.12 + 0.06 * Math.sin(performance.now() / 120); }
  // 그래플 줄
  rig.rope.visible = e.alive && !!(e.flags & PF.grapple) && !!e.hook;
  if (rig.rope.visible) { const p = rig.rope.geometry.attributes.position; p.setXYZ(0, e.pos.x, e.pos.y + 1.3, e.pos.z); p.setXYZ(1, e.hook.x, e.hook.y, e.hook.z); p.needsUpdate = true; }
}

export function updateRemotes(dt) {
  const rt = clock.render();
  for (const e of remotes.values()) {
    const rig = e.rig, s = rig.soldier;
    if (!e.hasPos) { s.root.visible = false; rig.bar.visible = false; continue; }
    const p = sample(e, rt);
    const px = e.pos.x, pz = e.pos.z;
    if (p && e.alive) {
      if (e.pos.distanceToSquared(new V3(p.x, p.y, p.z)) > 64) e.pos.set(p.x, p.y, p.z); // 순간이동·부활
      else e.pos.set(p.x, p.y, p.z);
      e.yaw = p.yaw; e.pitch = p.pitch; e.flags = p.f; e.weapon = p.w; e.hp = p.hp;
      e.vel.lerp(new V3(p.vx, p.vy, p.vz), 1 - Math.exp(-dt * 12));
      e.crouch = lerp(e.crouch, p.c, 1 - Math.exp(-dt * 14));
    }
    // 투명(스텔스): 적에게는 보이지 않는다 (가까우면 희미한 일렁임만)
    const stealth = e.alive && !!(e.flags & PF.stealth), ally = isAlly(e.team);
    const blink = e.alive && (e.flags & PF.protect) && Math.floor(performance.now() / 140) % 2;
    s.root.visible = !(stealth && !ally) && !blink;
    const dist = e.pos.distanceTo(camera.position);
    rig.bar.visible = e.alive && dist < TAG_RANGE && !(stealth && !ally);
    s.root.position.copy(e.pos); s.root.rotation.y = e.yaw;
    animateBody(e, dt);
    finish(e, dt);
    // 발소리
    const moved = Math.hypot(e.pos.x - px, e.pos.z - pz);
    if (e.alive && moved > 0.001 && !(e.flags & (PF.air | PF.crouch | PF.slide)) && !stealth) {
      e.stepDist += moved;
      if (e.stepDist > 2.1) { e.stepDist = 0; const a = audioAt(e.pos); sfx.step(0.9 * a.att, a.pan); }
    }
  }
}
