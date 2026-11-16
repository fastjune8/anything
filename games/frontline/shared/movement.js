// 캐릭터 이동 물리 (순수 함수, THREE·DOM 의존 없음): 걷기·달리기·앉기·점프·계단·충돌, 넘어가기/오르기, 기울이기.
// 지금은 브라우저(client/js/player.js)가 쓰고, 나중에 서버가 같은 함수로 이동을 계산한다 (서버 권한 이동, M1).
//   stepMovement(상태, 입력, 충돌 박스, dt) → 상태를 바꾸고, 소리·연출용 사건(events)을 돌려준다.
import { LEAN_DIST } from './constants.js';
import { rayWorld, rampTop } from './collision.js';
import { findVault } from './vault.js';

export const BODY = { STAND_H: 1.75, CROUCH_H: 1.2, RADIUS: 0.35, STEP: 0.45, GRAVITY: 19, JUMP_V: 6.4 };
export const SPEED = { walk: 4.6, sprint: 6.9, crouch: 2.3 };
export const MAX_STEP_DT = 1 / 60; // 한 번에 계산하는 최대 시간 (화면이 느려도 이 간격으로 나눠 계산 → 게임 시간이 늦게 흐르지 않는다)

const { STAND_H, CROUCH_H, RADIUS, STEP, GRAVITY, JUMP_V } = BODY;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 새 상태. pos/vel 은 {x,y,z} 를 가진 객체면 된다 (브라우저는 THREE.Vector3 를 넘긴다)
export function newMoveState(pos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 }) {
  return { pos, vel, yaw: 0, onGround: true, crouch: false, h: STAND_H, stepOff: 0, lean: 0, leanOff: 0, vault: null, vaultLock: false, airT: 0 };
}
// 입력. fwd/side: -1~1, speedMul: 무기 무게·정조준 등으로 줄어드는 배율, sprint: 달리기를 원함(정조준·사격·재장전 중이 아님)
export const NO_INPUT = Object.freeze({ fwd: 0, side: 0, jump: false, crouch: false, sprint: false, leanL: false, leanR: false, speedMul: 1 });

// (x, z, 높이 h) 몸통이 겹치는 물체 중 가장 높은 윗면. 겹침이 없으면 -Infinity
// 경사로는 발밑 윗면 높이로 본다 → 걸어 들어가면 그만큼 "턱" 으로 올라선다 (조금씩이라 미끄럽게 오른다)
export function overlapTop(cs, x, y, z, h) {
  let top = -Infinity;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!(x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ && y + h > c.minY)) continue;
    const t = c.ramp ? rampTop(c, x, z, RADIUS) : c.maxY;
    if (y < t - 0.001 && t > top) top = t;
  }
  return top;
}
// 발 아래 받쳐 주는 가장 높은 바닥 높이 (경사로는 발밑 윗면)
export function supportBelow(cs, x, y, z) {
  let s = 0;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!(x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ)) continue;
    const t = c.ramp ? rampTop(c, x, z, RADIUS) : c.maxY;
    if (t <= y + 0.001 && t > s) s = t;
  }
  return s;
}
const colH = s => (s.crouch ? CROUCH_H : STAND_H);

// 한 축으로 이동. 낮은 턱은 올라서고, 아니면 막혀서 되돌린다
function moveAxis(s, cs, axis, delta) {
  if (!delta) return;
  s.pos[axis] += delta;
  const h = colH(s);
  const top = overlapTop(cs, s.pos.x, s.pos.y, s.pos.z, h);
  if (top === -Infinity) return;
  const rise = top - s.pos.y;
  if (s.onGround && rise <= STEP && overlapTop(cs, s.pos.x, top, s.pos.z, h) === -Infinity) {
    s.pos.y = top; s.stepOff -= rise; return;
  }
  s.pos[axis] -= delta; s.vel[axis] = 0;
}

// 앞(바라보는 방향)에 넘을 수 있는 구조물이 있으면 경로를 정해 시작한다. 반환: 시작했는가
function tryVault(s, cs) {
  const dir = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
  const v = findVault(cs, s.pos, dir, { radius: RADIUS, standH: STAND_H, crouchH: CROUCH_H, minH: s.onGround ? STEP : 0.1 });
  if (!v) return false;
  s.vault = { ...v, t: 0, dir };
  s.vel.x = s.vel.y = s.vel.z = 0; s.onGround = false; s.stepOff = 0;
  return true;
}
// 정해진 경로를 따라 움직인다 (이 동안은 충돌을 보지 않는다: 경로가 비어 있는 것은 findVault 가 확인했다)
function updateVault(s, cs, dt, ev) {
  const v = s.vault;
  v.t += dt;
  const k = Math.min(1, v.t / v.dur);
  const peak = v.top + 0.04;
  const hk = v.type === 'mantle' ? smooth(0.3, 1, k) : smooth(0.08, 0.95, k); // 오르기는 먼저 몸을 올린 뒤 앞으로
  s.pos.x = lerp(v.from[0], v.to[0], hk); s.pos.z = lerp(v.from[2], v.to[2], hk);
  s.pos.y = k < 0.5 ? lerp(v.from[1], peak, smooth(0, v.type === 'mantle' ? 0.45 : 0.35, k)) : lerp(peak, v.to[1], smooth(0.65, 1, k));
  // 지나가는 동안 몸을 숙인다 (창문처럼 위가 막힌 곳)
  const bodyH = Math.sin(Math.PI * k) > 0.25 ? v.duck : (v.crouch && k > 0.5 ? CROUCH_H : STAND_H);
  s.h = lerp(s.h, Math.min(bodyH, STAND_H), 1 - Math.exp(-dt * 18));
  if (k >= 1) {
    s.vault = null; s.vaultLock = true;
    s.pos.x = v.to[0]; s.pos.y = v.to[1]; s.pos.z = v.to[2];
    if (v.crouch) s.crouch = true;
    s.vel.x = v.dir.x * 2.2; s.vel.y = 0; s.vel.z = v.dir.z * 2.2; // 넘은 뒤 앞으로 이어서 움직이는 느낌
    s.onGround = supportBelow(cs, s.pos.x, s.pos.y, s.pos.z) >= s.pos.y - 0.01;
    ev.vaultDone = true;
  }
}

// 기울이기: 입력은 부드럽게 따라가고, 옆이 벽이면 머리가 벽을 뚫지 않도록 그만큼만 나간다
const _eye = { x: 0, y: 0, z: 0 }, _side = { x: 0, y: 0, z: 0 };
function updateLean(s, i, cs, dt) {
  const want = !s.vault ? (i.leanR ? 1 : 0) - (i.leanL ? 1 : 0) : 0;
  const step = dt * 6;
  s.lean = clamp(s.lean + clamp(want - s.lean, -step, step), -1, 1);
  let target = 0;
  if (Math.abs(s.lean) > 0.001) {
    const sg = Math.sign(s.lean);
    _eye.x = s.pos.x; _eye.y = s.pos.y + s.h - 0.13; _eye.z = s.pos.z;
    _side.x = Math.cos(s.yaw) * sg; _side.z = -Math.sin(s.yaw) * sg;
    const room = clamp(rayWorld(_eye, _side, cs, LEAN_DIST + 0.3).t - 0.3, 0, LEAN_DIST);
    target = s.lean * room;
  }
  s.leanOff = lerp(s.leanOff, target, 1 - Math.exp(-dt * 16));
}

// 한 단계 진행. 반환 사건: { sprinting, moved(땅 위에서 움직인 거리), landed(착지 세기 0~1), vaultStart, vaultDone }
export function stepMovement(s, i, cs, dt) {
  const ev = { sprinting: false, moved: 0, landed: 0, vaultStart: false, vaultDone: false };
  if (!i.jump) s.vaultLock = false;
  updateLean(s, i, cs, dt);
  if (s.vault) { updateVault(s, cs, dt, ev); return ev; }
  const fwd = i.fwd, side = i.side;
  // 앉기
  if (i.crouch) s.crouch = true;
  else if (s.crouch && overlapTop(cs, s.pos.x, s.pos.y, s.pos.z, STAND_H) === -Infinity) s.crouch = false;
  s.h = lerp(s.h, s.crouch ? CROUCH_H : STAND_H, 1 - Math.exp(-dt * 14));

  ev.sprinting = i.sprint && fwd > 0 && s.onGround && !s.crouch && !i.leanL && !i.leanR;
  let speed = s.crouch ? SPEED.crouch : ev.sprinting ? SPEED.sprint : SPEED.walk;
  speed *= i.speedMul * (1 - 0.3 * Math.abs(s.lean)); // 기울인 채로는 천천히

  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx *= speed / wl; wz *= speed / wl; }
  const acc = 1 - Math.exp(-dt * (s.onGround ? 13 : 2.2));
  s.vel.x = lerp(s.vel.x, wx, acc); s.vel.z = lerp(s.vel.z, wz, acc);

  const wasGround = s.onGround;
  // 점프 키: 앞에 낮은 구조물(창문·모래주머니·방벽·상자)이 있으면 넘어가거나 올라서고, 없으면 점프.
  // 점프한 직후 공중에서도 (뒤로 가는 중이 아니면) 넘을 곳을 찾는다.
  if (s.onGround) s.airT = 0; else s.airT += dt;
  const jumpKey = i.jump && !s.vaultLock;
  if (jumpKey && fwd >= 0 && (s.onGround || (s.airT < 0.6 && s.vel.y > -4)) && tryVault(s, cs)) { ev.vaultStart = true; return ev; }
  if (jumpKey && s.onGround) { s.vel.y = JUMP_V; s.onGround = false; }

  const px = s.pos.x, pz = s.pos.z;
  moveAxis(s, cs, 'x', s.vel.x * dt);
  moveAxis(s, cs, 'z', s.vel.z * dt);

  s.vel.y -= GRAVITY * dt;
  const ny = s.pos.y + s.vel.y * dt;
  if (s.vel.y <= 0) {
    const sup = supportBelow(cs, s.pos.x, s.pos.y, s.pos.z);
    if (ny <= sup) {
      if (!s.onGround && s.vel.y < -6) ev.landed = Math.min(1, -s.vel.y / 10);
      s.pos.y = sup; s.vel.y = 0; s.onGround = true;
    } else if (wasGround && s.onGround && s.pos.y - sup <= STEP) {
      s.stepOff += s.pos.y - sup; s.pos.y = sup; s.vel.y = 0;
    } else { s.pos.y = ny; s.onGround = false; }
  } else {
    if (overlapTop(cs, s.pos.x, ny, s.pos.z, colH(s)) !== -Infinity) s.vel.y = 0; else s.pos.y = ny;
    s.onGround = false;
  }
  s.stepOff *= Math.exp(-dt * 14);
  if (s.onGround) ev.moved = Math.hypot(s.pos.x - px, s.pos.z - pz);
  return ev;
}

// 프레임 시간이 길면 MAX_STEP_DT 이하로 나눠 여러 번 진행한다. 사건은 합쳐서 돌려준다
export function advanceMovement(s, i, cs, dt) {
  const n = Math.max(1, Math.ceil(dt / MAX_STEP_DT - 1e-9)), h = dt / n;
  const out = { sprinting: false, moved: 0, landed: 0, vaultStart: false, vaultDone: false };
  for (let k = 0; k < n; k++) {
    const ev = stepMovement(s, i, cs, h);
    out.sprinting = ev.sprinting; out.moved += ev.moved; out.landed = Math.max(out.landed, ev.landed);
    out.vaultStart ||= ev.vaultStart; out.vaultDone ||= ev.vaultDone;
  }
  return out;
}
