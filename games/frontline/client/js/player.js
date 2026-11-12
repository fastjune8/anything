// 내 캐릭터 이동과 충돌 (벽, 계단 오르기, 점프, 앉기)
import { WEAPONS } from '/shared/weapons.js';
import { colliders } from './scene.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, adsInput, STAND_H, CROUCH_H, RADIUS, STEP, GRAVITY, JUMP_V } from './state.js';
import { lerp } from './util.js';

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

export function updateMovement(dt, active) {
  const w = WEAPONS[wp.cur];
  const can = active && me.alive && game.matchState !== 'ended';
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

  wp.sprinting = can && inp.keys.has('ShiftLeft') && fwd > 0 && me.onGround && !me.crouch && !adsInput() && !inp.fireHeld && !wp.reload;
  let speed = me.crouch ? 2.3 : wp.sprinting ? 6.9 : 4.6;
  speed *= w.move * (1 - 0.4 * wp.adsT);

  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx *= speed / wl; wz *= speed / wl; }
  const acc = 1 - Math.exp(-dt * (me.onGround ? 13 : 2.2));
  me.vel.x = lerp(me.vel.x, wx, acc); me.vel.z = lerp(me.vel.z, wz, acc);

  const wasGround = me.onGround;
  if (can && inp.keys.has('Space') && me.onGround) { me.vel.y = JUMP_V; me.onGround = false; }

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
