// 다른 플레이어(사람/봇): 3인칭 모델, 위치 보간/애니메이션, 명중 판정
import * as THREE from 'three';
import { ROOM_MAX } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { rayBox } from '/shared/collision.js';
import { buildGun, buildSoldier } from './guns.js';
import { scene } from './scene.js';
import { flashTex } from './textures.js';
import { sfx, audioAt } from './sfx.js';
import { V3, lerp, smooth, angLerp } from './util.js';

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
      weapon: 0, deadT: 0, walk: 0, stepDist: 0,
    };
    remotes.set(info.id, r);
  }
  r.name = info.name; r.bot = !!info.bot; r.alive = !!info.alive;
  return r;
}
export function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  r.rig.used = false; r.rig.soldier.root.visible = false; r.rig.flash.visible = false;
  remotes.delete(id);
}
export function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

// ───── 명중 판정 ─────
// 광선(o, d)이 maxT 안에서 맞히는 가장 가까운 플레이어: { t, part: 'head'|'body'|'leg', id } 또는 null
const hbox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
export function remoteHit(o, d, maxT) {
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

// ───── 매 프레임 갱신 ─────
export function updateRemotes(dt) {
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
