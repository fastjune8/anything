// 캐릭터 이동 물리 (순수 함수, THREE·DOM 의존 없음): 걷기·달리기·앉기·점프·계단·충돌, 넘어가기/오르기, 대쉬(스킬).
// 지금은 브라우저(client/js/player.js)가 쓰고, 나중에 서버가 같은 함수로 이동을 계산한다 (서버 권한 이동, M1).
//   stepMovement(상태, 입력, 충돌 박스, dt) → 상태를 바꾸고, 소리·연출용 사건(events)을 돌려준다.
import { rampTop } from './collision.js';
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
  return { pos, vel, yaw: 0, onGround: true, crouch: false, h: STAND_H, stepOff: 0, vault: null, vaultLock: false, airT: 0, dashT: 0, dashCd: 0, dashV: null, stunT: 0, slideT: 0, kickCd: 0 };
}
// 입력. fwd/side: -1~1, speedMul: 무기 무게·정조준 등으로 줄어드는 배율, sprint: 달리기를 원함(정조준·사격·재장전 중이 아님)
// 스킬: airSprint = 공중에서도 달리는 속도 유지(질주), dash = 대쉬 키를 이번에 눌렀음 + dashSkill = { cd, dist, dur } (서버는 고른 스킬의 값을 넣는다)
//       kick = 이번에 밀려나기 무기를 쐈음 + kickSkill = { force, gap(다음 밀려나기까지 최소 간격) }, pitch = 그때 위아래 시선
export const NO_INPUT = Object.freeze({ fwd: 0, side: 0, jump: false, crouch: false, sprint: false, speedMul: 1, airSprint: false, dash: false, dashSkill: null, pitch: 0, kick: false, kickSkill: null });
const STUNNED = Object.freeze({ ...NO_INPUT });

// 밀어내기에 맞음 (서버가 부른다): 수평 방향 (dx, dz) 으로 force m/s 날아가며 stun 초 동안 넘어진다 (이동·사격 불가)
export function knockBack(s, dx, dz, force, stun) {
  const l = Math.hypot(dx, dz) || 1;
  s.vel.x = dx / l * force; s.vel.z = dz / l * force; s.vel.y = Math.max(s.vel.y, 2.5);
  s.onGround = false; s.vault = null; s.dashT = 0;
  s.stunT = stun; s.slideT = stun;
}
// 밀려나기: 조준(yaw, pitch)과 반대 방향으로 force 만큼 속도를 더한다
function kick(s, i, ev) {
  const sk = i.kickSkill, cp = Math.cos(i.pitch || 0);
  s.vel.x += Math.sin(s.yaw) * cp * sk.force; s.vel.z += Math.cos(s.yaw) * cp * sk.force; s.vel.y -= Math.sin(i.pitch || 0) * sk.force;
  if (s.vel.y > 0.5) s.onGround = false;
  s.slideT = 0.35; s.kickCd = sk.gap;
  ev.kick = true;
}

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

// 대쉬: 누른 순간 움직이는 방향(없으면 앞)으로 정해진 시간 동안 빠르게. 끝나면 달리는 속도로 이어 간다
function startDash(s, i, ev) {
  const sk = i.dashSkill;
  if (!sk || s.dashCd > 0 || s.vault) return;
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  let dx = -sy * i.fwd + cy * i.side, dz = -cy * i.fwd - sy * i.side;
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) { dx = -sy; dz = -cy; } else { dx /= l; dz /= l; }
  const sp = sk.dist / sk.dur;
  s.dashV = { x: dx * sp, z: dz * sp }; s.dashT = sk.dur; s.dashCd = sk.cd;
  ev.dash = true;
}

// 한 단계 진행. 반환 사건: { sprinting, moved(땅 위에서 움직인 거리), landed(착지 세기 0~1), vaultStart, vaultDone }
export function stepMovement(s, i, cs, dt) {
  const ev = { sprinting: false, moved: 0, landed: 0, vaultStart: false, vaultDone: false, dash: false, kick: false, stunned: false };
  if (!i.jump) s.vaultLock = false;
  s.dashCd = Math.max(0, (s.dashCd || 0) - dt);
  s.kickCd = Math.max(0, (s.kickCd || 0) - dt); s.slideT = Math.max(0, (s.slideT || 0) - dt);
  if (s.stunT > 0) { s.stunT = Math.max(0, s.stunT - dt); i = STUNNED; ev.stunned = true; } // 넘어져 있는 동안은 아무것도 못 한다
  if (s.vault) { updateVault(s, cs, dt, ev); return ev; }
  if (i.dash) startDash(s, i, ev);
  if (i.kick && i.kickSkill && s.kickCd <= 0) kick(s, i, ev);
  const fwd = i.fwd, side = i.side;
  // 앉기
  if (i.crouch) s.crouch = true;
  else if (s.crouch && overlapTop(cs, s.pos.x, s.pos.y, s.pos.z, STAND_H) === -Infinity) s.crouch = false;
  s.h = lerp(s.h, s.crouch ? CROUCH_H : STAND_H, 1 - Math.exp(-dt * 14));

  ev.sprinting = i.sprint && fwd > 0 && !s.crouch && (s.onGround || i.airSprint); // 질주 스킬: 공중에서도 달리는 속도
  let speed = s.crouch ? SPEED.crouch : ev.sprinting ? SPEED.sprint : SPEED.walk;
  speed *= i.speedMul;

  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx *= speed / wl; wz *= speed / wl; }
  if (s.dashT > 0) { // 대쉬 중: 정해진 속도로 곧게
    const k = Math.min(dt, s.dashT); s.dashT -= dt;
    s.vel.x = s.dashV.x * (k / dt); s.vel.z = s.dashV.z * (k / dt);
    if (s.dashT <= 0) { const l = Math.hypot(s.dashV.x, s.dashV.z) || 1; s.vel.x = s.dashV.x / l * SPEED.sprint; s.vel.z = s.dashV.z / l * SPEED.sprint; s.dashT = 0; } // 끝나면 달리는 속도로
  } else {
    const acc = 1 - Math.exp(-dt * (!s.onGround ? 2.2 : s.slideT > 0 ? 3 : 13)); // 밀려나는 중에는 땅에서도 미끄러진다
    s.vel.x = lerp(s.vel.x, wx, acc); s.vel.z = lerp(s.vel.z, wz, acc);
  }

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
  const out = { sprinting: false, moved: 0, landed: 0, vaultStart: false, vaultDone: false, dash: false, kick: false };
  for (let k = 0; k < n; k++) {
    const ev = stepMovement(s, i, cs, h);
    out.sprinting = ev.sprinting; out.moved += ev.moved; out.landed = Math.max(out.landed, ev.landed);
    out.vaultStart ||= ev.vaultStart; out.vaultDone ||= ev.vaultDone; out.dash ||= ev.dash; out.kick ||= ev.kick;
  }
  return out;
}
