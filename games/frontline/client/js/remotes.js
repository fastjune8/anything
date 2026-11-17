// 다른 플레이어(사람/봇): 3인칭 모델, 위치 보간/애니메이션, 명중 판정
import * as THREE from 'three';
import { MAX_HP, LEAN_ANGLE } from '/shared/constants.js';
import { MAX_PLAYERS } from '/shared/modes.js';
import { WEAPONS } from '/shared/weapons.js';
import { hitPose, leanShift } from '/shared/hitbox.js';
import { buildGun, buildSoldier, setGunParts } from './guns.js';
import { scene, camera } from './scene.js';
import { flashTex } from './textures.js';
import { sfx, audioAt } from './sfx.js';
import { isAlly } from './state.js';
import { V3, MODE_CFG, lerp, smooth, angLerp } from './util.js';

// 3인칭 모델은 방 최대 인원만큼 미리 만들어 두고, 들어오는 사람에게 하나씩 배정한다.
const RIG_COLORS = [[0x6a6048, 0x3a3d2c], [0x4a5a6a, 0x2c333d], [0x6a4a48, 0x3d2c2c], [0x4a6a52, 0x2c3d33],
  [0x6a6a48, 0x3d3d2c], [0x5a4a6a, 0x332c3d], [0x48666a, 0x2c3d3d], [0x6a5448, 0x3d332c]];
const TAG_W = 160, TAG_H = 36;      // 이름표 캔버스 크기
const TEAM_MODE = () => MODE_CFG.teams > 0;
const TAG_RANGE = 90;                // 이 거리(m) 밖에서는 이름표를 숨긴다
const TEAM_COLORS = { ally: [0x3f5f8a, 0x243650], foe: [0x8a3d35, 0x4f231f] };
function makeRig(i) {
  const [uniform, vest] = RIG_COLORS[i % RIG_COLORS.length];
  const soldier = buildSoldier({ uniform, vest });
  soldier.root.visible = false;
  scene.add(soldier.root);
  const guns = WEAPONS.map(w => {
    const g = buildGun(w.id, false, {}, false); g.group.visible = false; // 작게 보이므로 질감 셰이더 없이 soldier.gunSlot.add(g.group);
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
  return { soldier, guns, flash, flashT: 0, used: false, bar, tagCanvas, tagTex, tagKey: '' };
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

export function addRemote(info) {
  let r = remotes.get(info.id);
  if (!r) {
    const rig = rigs.find(x => !x.used);
    if (!rig) return null;
    rig.used = true;
    r = {
      id: info.id, rig, name: '', bot: false, alive: false, hasPos: false,
      pos: new V3(), tpos: new V3(), yaw: 0, tyaw: 0, pitch: 0, tpitch: 0, crouch: 0, crouchT: 0,
      weapon: 0, deadT: 0, walk: 0, stepDist: 0, lean: 0, tlean: 0,
      team: -1, shotAt: -1e9, hp: MAX_HP, invUntil: 0, // invUntil: 스폰 무적이 끝나는 시각 (performance.now 기준)
    };
    remotes.set(info.id, r);
  }
  r.name = info.name; r.bot = !!info.bot; r.alive = !!info.alive;
  // 들고 온 무기의 파츠를 모델에 반영한다 (봇이나 정보가 없으면 기본 상태)
  const lo = new Map(Array.isArray(info.lo) ? info.lo : []);
  r.rig.guns.forEach((g, i) => setGunParts(g, lo.get(i) || {}));
  if (typeof info.hp === 'number') r.hp = info.hp;
  if (MODE_CFG.teams) { // 팀전: 아군은 파란 계열, 적군은 붉은 계열 군복
    r.team = info.team;
    const [uniform, vest] = isAlly(r.team) ? TEAM_COLORS.ally : TEAM_COLORS.foe;
    r.rig.soldier.mats.uniform.color.setHex(uniform); r.rig.soldier.mats.vest.color.setHex(vest);
    r.rig.tagKey = ''; // 이름표 색도 다시 그린다
  }
  return r;
}
export function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  r.rig.used = false; r.rig.soldier.root.visible = false; r.rig.flash.visible = false; r.rig.bar.visible = false; r.rig.tagKey = '';
  remotes.delete(id);
}
export function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

// ───── 명중 판정 ─────
// 광선(o, d)이 maxT 안에서 맞히는 가장 가까운 플레이어: { t, part: 'head'|'body'|'leg', id } 또는 null
export function remoteHit(o, d, maxT) {
  let best = null;
  for (const r of remotes.values()) {
    if (!r.alive || !r.hasPos || r.invUntil > performance.now() || isAlly(r.team)) continue; // 무적 중인 상대와 아군은 맞지 않는다
    const h = hitRemote(r, o, d, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) best = { t: h.t, part: h.part, id: r.id, n: r.n | 0 }; // n: 내가 보고 있던 상대 위치의 서버 시각 번호 (랙 보정)
  }
  return best;
}
// 판정 모양은 서버(랙 보정 검증)와 같은 것을 쓴다 (shared/hitbox.js)
function hitRemote(e, o, d, maxT) {
  return hitPose({ x: e.pos.x, y: e.pos.y, z: e.pos.z, crouch: e.crouch, yaw: e.yaw, lean: e.lean }, o, d, maxT);
}

// ───── 매 프레임 갱신 ─────
export function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 18);
  for (const e of remotes.values()) {
    const rig = e.rig, s = rig.soldier;
    const protectedNow = e.alive && e.invUntil > performance.now();
    s.root.visible = e.hasPos && !(protectedNow && Math.floor(performance.now() / 120) % 2); // 무적 중에는 깜빡인다
    const dist = e.pos.distanceTo(camera.position);
    rig.bar.visible = e.hasPos && e.alive && dist < TAG_RANGE;
    if (!e.hasPos) continue;
    const px = e.pos.x, pz = e.pos.z;
    if (e.pos.distanceToSquared(e.tpos) > 36) e.pos.copy(e.tpos);
    else e.pos.lerp(e.tpos, k);
    e.yaw = angLerp(e.yaw, e.tyaw, k);
    e.pitch = lerp(e.pitch, e.tpitch, k);
    e.crouch = lerp(e.crouch, e.crouchT, 1 - Math.exp(-dt * 12));
    e.lean = e.alive ? lerp(e.lean, e.tlean, 1 - Math.exp(-dt * 14)) : 0;
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
      s.upper.rotation.z = -e.lean * LEAN_ANGLE; // 기울이기 (오른쪽 = +)
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
    // 이름표: 머리 바로 위. 멀어질수록 크게 그려서 멀리서도 읽을 수 있다 (가까이서는 원래 크기)
    const tagLean = leanShift(e.lean, lerp(0.86, 0.45, c), lerp(1.85, 1.4, c)).side;
    rig.bar.position.set(e.pos.x + Math.cos(e.yaw) * tagLean, e.pos.y + lerp(1.85, 1.4, c), e.pos.z - Math.sin(e.yaw) * tagLean);
    const f = Math.min(3.4, Math.max(1, dist / 14)), w = 0.75 * f;
    rig.bar.scale.set(w, w * TAG_H / TAG_W, 1);
    const key = `${e.name}|${e.hp}|${isAlly(e.team)}`;
    if (rig.tagKey !== key) { drawTag(rig, e.name, e.hp, isAlly(e.team)); rig.tagKey = key; }
    rig.guns.forEach((g, i) => { g.group.visible = i === e.weapon; });
    rig.flashT -= dt;
    rig.flash.visible = rig.flashT > 0;
  }
}
