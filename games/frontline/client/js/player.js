// 내 캐릭터 이동과 충돌 (벽, 계단 오르기, 점프, 앉기), 낮은 구조물 넘어가기/오르기, 기울이기(Q/E)
import { LEAN_DIST } from '/shared/constants.js';
import { rayWorld } from '/shared/collision.js';
import { findVault } from '/shared/vault.js';
import { colliders } from './scene.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, eff, adsInput, STAND_H, CROUCH_H, RADIUS, STEP, GRAVITY, JUMP_V } from './state.js';
import { lerp, clamp, smooth } from './util.js';

// (x, z, 높이 h) 몸통이 겹치는 물체 중 가장 높은 윗면. 겹침이 없으면 -Infinity
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
// 발 아래 받쳐 주는 가장 높은 바닥 높이
function supportBelow(x, y, z) {
  let s = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ && c.maxY <= y + 0.001 && c.maxY > s) s = c.maxY;
  }
  return s;
}
const colH = () => (me.crouch ? CROUCH_H : STAND_H);

// 한 축으로 이동. 낮은 턱은 올라서고, 아니면 막혀서 되돌린다
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

// ───── 넘어가기 / 오르기 ─────
// 앞(바라보는 방향)에 넘을 수 있는 구조물이 있으면 그 경로를 정해 시작한다. 반환: 시작했는가
function tryVault() {
  const dir = { x: -Math.sin(me.yaw), z: -Math.cos(me.yaw) };
  const v = findVault(colliders, me.pos, dir, { radius: RADIUS, standH: STAND_H, crouchH: CROUCH_H, minH: me.onGround ? STEP : 0.1 });
  if (!v) return false;
  me.vault = { ...v, t: 0, dir };
  me.vel.set(0, 0, 0); me.onGround = false; me.stepOff = 0;
  wp.reload = null; // 손을 짚어야 하므로 재장전은 끊긴다
  sfx.step(0.8);
  return true;
}
// 정해진 경로를 따라 움직인다 (이 동안은 충돌을 보지 않는다: 경로가 비어 있는 것은 findVault 가 확인했다)
function updateVault(dt) {
  const v = me.vault;
  v.t += dt;
  const k = Math.min(1, v.t / v.dur);
  const peak = v.top + 0.04;
  const hk = v.type === 'mantle' ? smooth(0.3, 1, k) : smooth(0.08, 0.95, k); // 오르기는 먼저 몸을 올린 뒤 앞으로
  me.pos.x = lerp(v.from[0], v.to[0], hk); me.pos.z = lerp(v.from[2], v.to[2], hk);
  me.pos.y = k < 0.5 ? lerp(v.from[1], peak, smooth(0, v.type === 'mantle' ? 0.45 : 0.35, k)) : lerp(peak, v.to[1], smooth(0.65, 1, k));
  // 지나가는 동안 몸을 숙인다 (창문처럼 위가 막힌 곳)
  const bodyH = Math.sin(Math.PI * k) > 0.25 ? v.duck : (v.crouch && k > 0.5 ? CROUCH_H : STAND_H);
  me.h = lerp(me.h, Math.min(bodyH, STAND_H), 1 - Math.exp(-dt * 18));
  if (k >= 1) {
    me.vault = null; me.vaultLock = true;
    me.pos.set(v.to[0], v.to[1], v.to[2]);
    if (v.crouch) me.crouch = true;
    me.vel.set(v.dir.x * 2.2, 0, v.dir.z * 2.2); // 넘은 뒤 앞으로 이어서 움직이는 느낌
    me.onGround = supportBelow(me.pos.x, me.pos.y, me.pos.z) >= me.pos.y - 0.01;
    sfx.land(0.45);
  }
}

// ───── 기울이기 ─────
// 입력은 부드럽게 따라가고, 옆이 벽이면 머리가 벽을 뚫지 않도록 그만큼만 나간다.
const _eye = { x: 0, y: 0, z: 0 }, _side = { x: 0, y: 0, z: 0 };
function updateLean(dt, can) {
  const want = can && !me.vault ? (inp.keys.has('KeyE') ? 1 : 0) - (inp.keys.has('KeyQ') ? 1 : 0) : 0;
  const step = dt * 6;
  me.lean = clamp(me.lean + clamp(want - me.lean, -step, step), -1, 1);
  let target = 0;
  if (Math.abs(me.lean) > 0.001) {
    const s = Math.sign(me.lean);
    _eye.x = me.pos.x; _eye.y = me.pos.y + me.h - 0.13; _eye.z = me.pos.z;
    _side.x = Math.cos(me.yaw) * s; _side.z = -Math.sin(me.yaw) * s;
    const room = clamp(rayWorld(_eye, _side, colliders, LEAN_DIST + 0.3).t - 0.3, 0, LEAN_DIST);
    target = me.lean * room;
  }
  me.leanOff = lerp(me.leanOff, target, 1 - Math.exp(-dt * 16));
}

export function updateMovement(dt, active) {
  const w = eff[wp.cur];
  const can = active && me.alive && game.matchState !== 'ended';
  if (!inp.keys.has('Space')) me.vaultLock = false;
  updateLean(dt, can);
  if (me.vault) { updateVault(dt); return; }
  let fwd = 0, side = 0;
  if (can) {
    fwd = (inp.keys.has('KeyW') ? 1 : 0) - (inp.keys.has('KeyS') ? 1 : 0);
    side = (inp.keys.has('KeyD') ? 1 : 0) - (inp.keys.has('KeyA') ? 1 : 0);
  }
  // 앉기
  const wantCrouch = can && inp.keys.has('KeyC');
  if (wantCrouch) me.crouch = true;
  else if (me.crouch && overlapTop(me.pos.x, me.pos.y, me.pos.z, STAND_H) === -Infinity) me.crouch = false;
  me.h = lerp(me.h, me.crouch ? CROUCH_H : STAND_H, 1 - Math.exp(-dt * 14));

  const leaning = inp.keys.has('KeyQ') || inp.keys.has('KeyE');
  wp.sprinting = can && inp.keys.has('ShiftLeft') && fwd > 0 && me.onGround && !me.crouch && !adsInput() && !inp.fireHeld && !wp.reload && !leaning;
  let speed = me.crouch ? 2.3 : wp.sprinting ? 6.9 : 4.6;
  speed *= w.move * (1 - 0.4 * wp.adsT) * (1 - 0.3 * Math.abs(me.lean)); // 기울인 채로는 천천히

  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx *= speed / wl; wz *= speed / wl; }
  const acc = 1 - Math.exp(-dt * (me.onGround ? 13 : 2.2));
  me.vel.x = lerp(me.vel.x, wx, acc); me.vel.z = lerp(me.vel.z, wz, acc);

  const wasGround = me.onGround;
  // Space: 앞에 낮은 구조물(창문·모래주머니·방벽·상자)이 있으면 넘어가거나 올라서고, 없으면 점프.
  // 점프한 직후 공중에서도 (뒤로 가는 중이 아니면) 넘을 곳을 찾는다.
  if (me.onGround) me.airT = 0; else me.airT += dt;
  const jumpKey = can && inp.keys.has('Space') && !me.vaultLock;
  if (jumpKey && fwd >= 0 && (me.onGround || (me.airT < 0.6 && me.vel.y > -4)) && tryVault()) return;
  if (jumpKey && me.onGround) { me.vel.y = JUMP_V; me.onGround = false; }

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
    wp.stepDist += moved; wp.bobPhase += moved * (wp.sprinting ? 2.6 : 3.1);
    if (wp.stepDist > (wp.sprinting ? 2.5 : me.crouch ? 1.6 : 2.0)) { wp.stepDist = 0; sfx.step(me.crouch ? 0.35 : wp.sprinting ? 1 : 0.7); }
  }
}
