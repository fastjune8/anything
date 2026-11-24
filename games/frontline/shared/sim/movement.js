// 캐릭터 컨트롤러 (순수 함수, THREE·DOM 의존 없음). 서버 판정과 브라우저 예측이 같은 코드·같은 입력·같은 1/60초로 계산한다.
//   가속/마찰 모델 (지상 가속 + 마찰, 공중 가속은 방향만 바꾸고 속도는 늘지 않음), 점프 버퍼·코요테 타임,
//   슬라이딩 (달리던 속도 + 가속, 내리막 가속, 슬라이딩 점프는 속도 유지), 넘어가기/오르기 (shared/vault.js),
//   외부 힘 (밀려남: 마찰·조작이 줄어 미끄러짐), 넘어짐(조작 불가), 스킬 이동 (대쉬·구르기·돌진·갈고리) 을 한 상태 기계로 처리한다.
//   충돌은 축별 이동 + 턱 오르기 + 경사로, 빠른 이동은 잘게 나눠 벽을 뚫지 않는다.
import { rampTop } from '../collision.js';
import { findVault } from '../vault.js';
import { BODY, MOVE, lerp, clamp } from './config.js';

const { STAND_H, CROUCH_H, SLIDE_H, RADIUS, STEP } = BODY;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ───── 상태 ─────
export function newMove(x = 0, y = 0, z = 0, yaw = 0) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0,
    ground: true, h: STAND_H, crouch: false, stepOff: 0,
    slide: 0, slideCd: 0, slideAir: 0, // 슬라이딩 남은 시간 / 다음 슬라이딩까지 / 슬라이딩 중 공중에 있던 시간
    cHeld: false, jHeld: false,        // 지난 tick 에 앉기·점프 키를 누르고 있었나 (누른 순간 판단)
    airT: 0, coyote: 0, jumpBuf: 0, landT: 0, landVy: 0, airY0: y, // 막 착지한 뒤 남은 시간 / 떨어진 높이만큼의 속도 (착지 슬라이딩) / 땅을 떠난 높이
    kb: 0, stun: 0,                    // 밀려나는 중 / 넘어짐 남은 시간
    vault: null, vaultLock: false,
    mo: null,                          // 스킬 이동 { k: 'dash'|'roll'|'slash'|'grapple'|'kpull'|'ledge', t, dur, ... }
    sprinting: false, sprintOut: 1,    // 지금 달리는 중인가 / 달리기를 멈춘 뒤 지난 시간 (달리기 → 사격 전환)
  };
}
// 이동 상태를 다른 객체로 복사 (예측 되감기·스냅샷)
export const MOVE_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'ground', 'h', 'crouch', 'stepOff', 'slide', 'slideCd', 'slideAir', 'cHeld', 'jHeld', 'airT', 'coyote', 'jumpBuf', 'landT', 'landVy', 'airY0', 'kb', 'stun', 'vaultLock', 'sprinting', 'sprintOut'];
export function copyMove(dst, src) {
  for (const k of MOVE_KEYS) dst[k] = src[k];
  dst.vault = src.vault ? { ...src.vault, dir: { ...src.vault.dir } } : null;
  dst.mo = src.mo ? { ...src.mo } : null;
  return dst;
}

export const bodyH = s => (s.slide > 0 ? SLIDE_H : s.crouch || s.stun > 0 ? CROUCH_H : STAND_H);
export const eyeY = s => s.y + s.h - BODY.EYE + s.stepOff;
export const hSpeed = s => Math.hypot(s.vx, s.vz);

// ───── 충돌 ─────
// (x, y, z) 에서 높이 h 인 몸이 겹치는 물체 중 가장 높은 윗면. 없으면 -Infinity
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
// 발 아래 받쳐 주는 가장 높은 바닥 (지면 = 0)
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
const headroom = (cs, s, h) => overlapTop(cs, s.x, s.y, s.z, h) === -Infinity;

// 한 축 이동. 땅 위에서 낮은 턱은 올라서고, 아니면 막혀서 그 축 속도를 0 으로. 반환: 막혔나
function moveAxis(s, cs, axis, delta, h) {
  if (!delta) return false;
  s[axis] += delta;
  const top = overlapTop(cs, s.x, s.y, s.z, h);
  if (top === -Infinity) return false;
  const rise = top - s.y;
  if ((s.ground || s.slide > 0) && rise <= STEP && overlapTop(cs, s.x, top, s.z, h) === -Infinity) { s.y = top; s.stepOff -= rise; return false; }
  s[axis] -= delta;
  s[axis === 'x' ? 'vx' : 'vz'] = 0;
  return true;
}

// 줄에 끌려가는 이동 (그래플·쿠나이) 과 그 끝의 턱 넘기. 이 셋은 대쉬류가 아니다 (중력이 있고, 넉백에도 갈고리는 유지)
export const ROPE_MOTIONS = new Set(['grapple', 'kpull', 'ledge']);
// 줄 이동의 목표: 박힌 점(a, 면 번호 n)에서 몸 가운데가 가야 할 자리. 벽이면 벽에서 몸 반지름만큼 떨어져 점보다 조금 아래(손이 점에 닿게), 바닥이면 그 위
export function ropeTarget(a, n) {
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][n] || [0, 1, 0];
  const out = 0.5, down = N[1] > 0.5 ? -1.0 : N[1] < -0.5 ? 0.4 : 0.55; // 바닥: 1m 위, 천장: 아래로, 벽: 손이 점에 닿는 높이
  return { x: a.x + N[0] * out, y: a.y + N[1] * out - down, z: a.z + N[2] * out };
}
// 박힌 점이 벽(옆면)이고 그 벽 위가 2.2m 안에 올라설 수 있는 윗면이면 그 자리 (오버워치 위도우메이커처럼 끝에서 턱을 넘겨 준다). 없으면 null
export function findLedge(cs, a, n) {
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][n];
  if (!N || N[1] !== 0) return null;
  const ix = a.x - N[0] * 0.7, iz = a.z - N[2] * 0.7; // 벽 안쪽으로 조금 들어간 곳의 윗면
  const top = supportBelow(cs, ix, a.y + 2.2, iz);
  if (top < a.y - 0.4 || top > a.y + 2.2) return null;
  if (overlapTop(cs, ix, top, iz, STAND_H) !== -Infinity) return null; // 올라서면 머리가 막힌다
  return { x: ix, y: top, z: iz };
}

// ───── 외부 힘 ─────
// 밀어내기·반동 이동 등: 속도에 더하고, kbTime 동안 미끄러진다. 스킬 이동·넘어가기는 끊긴다 (군중 제어)
export function applyImpulse(s, ix, iy, iz, kbTime = 0.3) {
  s.vx += ix; s.vy += iy; s.vz += iz;
  if (s.vy > 0.5) { if (s.ground) s.airY0 = s.y; s.ground = false; s.coyote = 0; }
  s.kb = Math.max(s.kb, kbTime);
  if (s.mo && s.mo.k !== 'grapple') s.mo = null; // 갈고리는 맞아도 놓지 않는다 (쿠나이 기동은 넉백에 끊긴다)
  s.vault = null;
}
// 넘어뜨리기 (이동·사격·스킬 불가)
export function knockDown(s, t) { s.stun = Math.max(s.stun, t); s.slide = 0; s.mo = null; s.vault = null; }

// 스킬 이동 시작. dir = {x, z} 수평 방향(길이 1)
export function startMotion(s, k, p) {
  s.vault = null; s.slide = 0;
  if (k === 'grapple' || k === 'kpull') { // 줄 이동: 목표(몸 가운데가 갈 자리)로 곧장. 쿠나이는 목표를 매 tick shared/sim/kunai.js 가 다시 잡는다
    s.mo = { k, t: 0, dur: p.dur, tx: p.tx, ty: p.ty, tz: p.tz, max: p.max, snap: p.snap, steer: p.steer || 0, grav: p.grav ?? 0.12, arrive: p.arrive ?? 1.2, ledge: p.ledge || null, gone: false };
    // 처음부터 빠르게 (위도우메이커처럼 "탁" 하고 당겨진다): 지금 속도 중 목표 쪽 성분은 살리고, 시작 속도를 바로 준다
    const dx = p.tx - s.x, dy = p.ty - (s.y + 0.9), dz = p.tz - s.z, d = Math.hypot(dx, dy, dz) || 1;
    const along = Math.max(0, (s.vx * dx + s.vy * dy + s.vz * dz) / d), v0 = Math.max(along, p.max * (p.kick ?? 0.55));
    s.vx = dx / d * v0; s.vy = dy / d * v0 + (s.ground ? 1.2 : 0); s.vz = dz / d * v0;
    s.ground = false; s.coyote = 0;
    return;
  }
  const sp = p.dist / p.dur;
  s.mo = { k, t: 0, dur: p.dur, vx: p.dir.x * sp, vz: p.dir.z * sp, end: p.end ?? MOVE.walk };
  if (k !== 'roll') { s.vy = 0; }
}
// 이동 방향: 누른 방향(없으면 바라보는 앞)
export function wishDir(s, fwd, side) {
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  let dx = -sy * fwd + cy * side, dz = -cy * fwd - sy * side;
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return { x: -sy, z: -cy, none: true };
  return { x: dx / l, z: dz / l, none: false };
}

// ───── 넘어가기 ─────
function tryVault(s, cs) {
  const dir = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
  const v = findVault(cs, s, dir, { radius: RADIUS, standH: STAND_H, crouchH: CROUCH_H, minH: s.ground ? STEP : 0.1 });
  if (!v) return false;
  s.vault = { ...v, t: 0, dir };
  s.vx = s.vy = s.vz = 0; s.ground = false; s.stepOff = 0; s.slide = 0;
  return true;
}
function updateVault(s, cs, dt, ev) {
  const v = s.vault;
  v.t += dt;
  const k = Math.min(1, v.t / v.dur), peak = v.top + 0.04;
  const hk = v.type === 'mantle' ? smooth(0.3, 1, k) : smooth(0.08, 0.95, k);
  s.x = lerp(v.from[0], v.to[0], hk); s.z = lerp(v.from[2], v.to[2], hk);
  s.y = k < 0.5 ? lerp(v.from[1], peak, smooth(0, v.type === 'mantle' ? 0.45 : 0.35, k)) : lerp(peak, v.to[1], smooth(0.65, 1, k));
  const bh = Math.sin(Math.PI * k) > 0.25 ? v.duck : (v.crouch && k > 0.5 ? CROUCH_H : STAND_H);
  s.h = lerp(s.h, Math.min(bh, STAND_H), 1 - Math.exp(-dt * 18));
  if (k >= 1) {
    s.vault = null; s.vaultLock = true;
    s.x = v.to[0]; s.y = v.to[1]; s.z = v.to[2];
    if (v.crouch) s.crouch = true;
    s.vx = v.dir.x * 3; s.vy = 0; s.vz = v.dir.z * 3;
    s.ground = supportBelow(cs, s.x, s.y, s.z) >= s.y - 0.01;
    ev.vaultDone = true;
  }
}

// ───── 스킬 이동 ─────
// 반환: true 면 이번 tick 의 일반 가속을 건너뛴다
function updateMotion(s, i, dt, ev) {
  const m = s.mo;
  m.t += dt;
  if (m.k === 'ledge') { // 턱 넘기: 올라가는 동안 벽 쪽으로 계속 밀어 윗면에 올려놓는다 (중력은 그대로)
    s.vx = m.hx; s.vz = m.hz;
    if (m.t >= m.dur || (s.y >= m.ly - 0.02 && m.t > 0.12 && s.vy <= 0)) { s.mo = null; ev.ledgeDone = true; return false; }
    return true;
  }
  if (m.k === 'grapple' || m.k === 'kpull') {
    const dx = m.tx - s.x, dy = m.ty - (s.y + 0.9), dz = m.tz - s.z, d = Math.hypot(dx, dy, dz);
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const jumpOff = i.jumpPress && m.t > 0.06;
    // 턱 넘기: 박힌 곳 위에 올라설 자리가 있고 벽에 닿을 만큼 왔다
    if (m.ledge && !jumpOff) {
      const L = m.ledge, lx = L.x - s.x, lz = L.z - s.z, hd = Math.hypot(lx, lz);
      if ((hd < 2.3 || d < m.arrive) && s.y < L.y + 0.3 && s.y > L.y - 3.4) { // 벽 가까이 왔거나 목표에 닿았다
        const up = L.y + 0.55 - s.y, hs = 5; // 윗면보다 조금 높이 + 벽 쪽으로 밀어 올려놓는다
        s.vy = Math.sqrt(2 * MOVE.gravity * Math.max(0.5, up));
        s.mo = { k: 'ledge', t: 0, dur: 0.6, hx: lx / hd * hs, hz: lz / hd * hs, ly: L.y };
        s.vx = s.mo.hx; s.vz = s.mo.hz;
        ev.ledgePop = true; ev[m.k === 'kpull' ? 'kpullEnd' : 'grappleEnd'] = true;
        return true;
      }
    }
    const stuck = m.t > 0.2 && sp < 2.5;
    if (m.gone || d < m.arrive || m.t >= m.dur || stuck || jumpOff) {
      if (jumpOff) { s.vy = Math.max(s.vy, 0) * 0.5 + 6.8; } // 점프로 놓기: 위로 튀어 오르며 앞으로 가던 속도는 그대로
      else if (d < m.arrive && dy > -0.5) s.vy = Math.max(s.vy, 3.5); // 도착: 살짝 띄워 턱 위로 올라서기 쉽게 (속도는 가진 채 빠져나간다)
      s.mo = null; ev[m.k === 'kpull' ? 'kpullEnd' : 'grappleEnd'] = true; return false;
    }
    // 원하는 속도 = 목표 쪽으로 최고 속도 (+ 방향키로 옆으로 틀기). 지금 속도를 그쪽으로 빠르게 맞춘다 → 곧은 궤적, 빙빙 돌거나 튕기지 않는다
    let wx = dx / d * m.max, wy = dy / d * m.max, wz = dz / d * m.max;
    if (m.steer && (i.fwd || i.side)) { const wd = wishDir(s, i.fwd, i.side); wx += wd.x * m.steer; wz += wd.z * m.steer; }
    if (d < 4 && m.arrive < 2) { const k = 0.55 + 0.45 * d / 4; wx *= k; wy *= k; wz *= k; } // 벽·바닥 목표는 다 와 가면 조금 늦춘다 (처박히지 않게). 공중 목표(쿠나이 2개 가운데)는 그대로 지나간다
    const a = 1 - Math.exp(-m.snap * dt);
    s.vx += (wx - s.vx) * a; s.vy += (wy - s.vy) * a; s.vz += (wz - s.vz) * a;
    s.vy -= MOVE.gravity * m.grav * dt;
    s.ground = false;
    return true;
  }
  const k = Math.min(1, (m.dur - (m.t - dt)) / dt); // 마지막 tick 은 남은 시간만큼
  s.vx = m.vx * Math.max(0, k); s.vz = m.vz * Math.max(0, k);
  if (m.k !== 'roll') s.vy = 0;
  if (m.t >= m.dur) {
    const l = Math.hypot(m.vx, m.vz) || 1;
    s.vx = m.vx / l * m.end; s.vz = m.vz / l * m.end;
    s.mo = null; ev.motionEnd = m.k;
  }
  return true;
}

// ───── 가속 / 마찰 ─────
function friction(s, dt, f) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp < 1e-4) { s.vx = s.vz = 0; return; }
  const drop = Math.max(sp, MOVE.stopSpeed) * f * dt, ns = Math.max(0, sp - drop) / sp;
  s.vx *= ns; s.vz *= ns;
}
function accelerate(s, dx, dz, wish, accel, dt) {
  const cur = s.vx * dx + s.vz * dz, add = wish - cur;
  if (add <= 0) return;
  const a = Math.min(add, accel * wish * dt);
  s.vx += a * dx; s.vz += a * dz;
}

// 이동 입력: fwd/side -1~1, jump/crouch(누르고 있음), sprint(달리기를 원하고 할 수 있음), speedMul(무기·정조준),
//   airSprint(질주 스킬: 점프해도 달리는 속도 유지)
export const NO_MOVE = Object.freeze({ fwd: 0, side: 0, jump: false, crouch: false, sprint: false, speedMul: 1, airSprint: false });

// 한 tick 진행. 반환: 사건 (소리·연출·소음 탐지용)
export function stepMove(s, i, cs, dt) {
  const ev = { moved: 0, landed: 0, jumped: false, slideStart: false, slideEnd: false, vaultStart: false, vaultDone: false, motionEnd: null, grappleEnd: false, kpullEnd: false, ledgePop: false, ledgeDone: false };
  const jumpPress = i.jump && !s.jHeld, crouchPress = i.crouch && !s.cHeld;
  s.jHeld = i.jump; s.cHeld = i.crouch;
  if (!i.jump) s.vaultLock = false;
  s.slideCd = Math.max(0, s.slideCd - dt); s.kb = Math.max(0, s.kb - dt); s.landT = Math.max(0, s.landT - dt);
  s.jumpBuf = jumpPress ? MOVE.jumpBuffer : Math.max(0, s.jumpBuf - dt);
  if (s.stun > 0) { s.stun = Math.max(0, s.stun - dt); i = NO_MOVE; }
  if (s.vault) { updateVault(s, cs, dt, ev); s.sprinting = false; return ev; }

  const sp0 = hSpeed(s);
  const inMotion = s.mo ? updateMotion(s, { jumpPress, fwd: i.fwd, side: i.side }, dt, ev) : false;

  // 앉기 · 슬라이딩
  if (!inMotion) {
    if (s.slide > 0) {
      s.slide -= dt;
      if (!s.ground) s.slideAir += dt; else s.slideAir = 0;
      if (!i.crouch || s.slide <= 0 || sp0 < MOVE.slideEndSpeed || s.slideAir > 0.3) { s.slide = 0; s.slideCd = MOVE.slideCooldown; ev.slideEnd = true; }
    } else if (s.ground && s.stun <= 0 && i.crouch && sp0 > 0.5) {
      // 슬라이딩 시작: ① 달리다 C 를 누른 순간 ② 착지 순간에 C 를 누르고 있으면 (점프 → 슬라이딩)
      const landing = s.landT > 0;
      if ((crouchPress && sp0 >= MOVE.slideMinSpeed) || (landing && sp0 >= MOVE.landSlideMin)) {
        let ns = sp0;
        if (landing) ns += MOVE.landBoost * s.landVy; // 떠난 곳보다 낮게 떨어진 힘을 앞으로
        if (s.slideCd <= 0) ns += MOVE.slideBoost;                                         // 기본 가속은 쿨다운마다 한 번
        ns = Math.max(sp0, Math.min(ns, Math.max(MOVE.boostCap, sp0)));                    // 가속으로는 boostCap 까지 (이미 빠르면 그대로)
        s.vx *= ns / sp0; s.vz *= ns / sp0;
        s.slide = MOVE.slideDur; s.slideAir = 0; s.landT = 0;
        ev.slideStart = true; ev.slideBoost = ns - sp0;
      }
    }
    if (s.slide <= 0) {
      if (i.crouch || s.stun > 0) s.crouch = true;
      else if (s.crouch && headroom(cs, s, STAND_H)) s.crouch = false;
    } else s.crouch = true;
  }
  s.h = lerp(s.h, bodyH(s), 1 - Math.exp(-dt * 14));

  // 달리기: 앞으로 가고, 앉거나 슬라이딩 중이 아닐 때
  const sprint = !inMotion && i.sprint && i.fwd > 0 && !s.crouch && s.slide <= 0 && (s.ground || s.sprinting);
  s.sprinting = sprint;
  s.sprintOut = sprint ? 0 : Math.min(1, s.sprintOut + dt);

  if (!inMotion) {
    const wd = wishDir(s, i.fwd, i.side), moving = !wd.none && (i.fwd || i.side);
    const base = s.crouch ? MOVE.crouch : sprint ? MOVE.sprint : MOVE.walk;
    const wish = moving ? base * i.speedMul : 0;
    const kbk = s.kb > 0 ? MOVE.knockControl : 1;
    if (s.slide > 0 && s.ground) {
      // 슬라이딩: 천천히 줄어드는 속도, 내리막이면 빨라진다, 방향은 살짝만 튼다
      const sp = hSpeed(s);
      if (sp > 1e-4) {
        const slope = slopeAlong(cs, s, s.vx / sp, s.vz / sp);
        const over = Math.max(0, sp - MOVE.slideMax) * MOVE.slideOverDrag;
        const fr = MOVE.slideDur - s.slide < MOVE.slideGrace ? MOVE.slideGraceMul : 1;
        const nsp = Math.max(0, sp - (MOVE.slideFriction * fr + over) * dt + slope * MOVE.slideSlopeAccel * dt);
        s.vx *= nsp / sp; s.vz *= nsp / sp;
        if (moving) { const keep = hSpeed(s); accelerate(s, wd.x, wd.z, keep, 1.2, dt); const n = hSpeed(s); if (n > keep && n > 0) { s.vx *= keep / n; s.vz *= keep / n; } }
      }
    } else if (s.ground) {
      friction(s, dt, MOVE.friction * (s.kb > 0 ? MOVE.knockFriction : 1));
      if (moving) accelerate(s, wd.x, wd.z, wish, MOVE.groundAccel * kbk, dt);
    } else if (moving) {
      // 공중: 방향은 바꿀 수 있지만 속도는 늘지 않는다 (버니합으로 빨라지지 않게)
      const before = Math.max(hSpeed(s), wish);
      accelerate(s, wd.x, wd.z, Math.min(wish, MOVE.walk), MOVE.airAccel * kbk, dt);
      const n = hSpeed(s); if (n > before) { s.vx *= before / n; s.vz *= before / n; }
    }

    // 점프 / 넘어가기
    if (s.ground) { s.airT = 0; s.coyote = MOVE.coyote; } else { s.airT += dt; s.coyote = Math.max(0, s.coyote - dt); }
    const jumpKey = s.jumpBuf > 0 && !s.vaultLock && s.stun <= 0;
    if (jumpKey && i.fwd >= 0 && (s.ground || (s.airT < 0.6 && s.vy > -4)) && s.slide <= 0 && jumpPress && tryVault(s, cs)) { ev.vaultStart = true; s.jumpBuf = 0; return ev; }
    if (jumpKey && (s.ground || s.coyote > 0) && headroom(cs, s, STAND_H)) {
      s.vy = MOVE.jumpV; s.ground = false; s.coyote = 0; s.jumpBuf = 0; s.landT = 0; ev.jumped = true;
      if (s.slide > 0) { // 슬라이딩 점프: 속도 그대로, 빠를수록 더 높이
        s.vy += Math.min(MOVE.slideJumpLiftMax, Math.max(0, hSpeed(s) - MOVE.sprint) * MOVE.slideJumpLift);
        s.slide = 0; s.slideCd = MOVE.slideCooldown; ev.slideEnd = true; ev.slideJump = true; s.crouch = false;
      }
      else if (sprint && !i.airSprint) { const n = hSpeed(s), cap = MOVE.walk * 1.18; if (n > cap) { s.vx *= cap / n; s.vz *= cap / n; } } // 질주 스킬이 없으면 점프하면 달리기 속도가 줄어든다
    }
  }

  // 이동 + 충돌 (빠르면 잘게 나눈다)
  const px = s.x, pz = s.z, py = s.y, wasGround = s.ground, h = bodyH(s);
  const dist = Math.max(Math.abs(s.vx), Math.abs(s.vz), Math.abs(s.vy)) * dt;
  const n = Math.min(8, Math.max(1, Math.ceil(dist / 0.2)));
  const sub = dt / n;
  for (let k = 0; k < n; k++) {
    moveAxis(s, cs, 'x', s.vx * sub, h);
    moveAxis(s, cs, 'z', s.vz * sub, h);
    if (!(s.mo && s.mo.k !== 'roll' && s.mo.k !== 'grapple' && s.mo.k !== 'kpull' && s.mo.k !== 'ledge')) s.vy -= MOVE.gravity * sub; // 대쉬·돌진 중에는 떨어지지 않는다 (줄 이동은 위에서 약한 중력, 턱 넘기는 보통 중력)
    const ny = s.y + s.vy * sub;
    if (s.vy <= 0) {
      const sup = supportBelow(cs, s.x, s.y, s.z);
      if (ny <= sup) {
        if (!s.ground) {
          if (s.vy < -6) ev.landed = Math.max(ev.landed, Math.min(1, -s.vy / 12));
          // 착지 가속은 "땅을 떠난 높이보다 낮게 떨어진 만큼"만 (같은 높이에서 뛰고 내리기를 반복해 빨라지지 않게)
          s.landT = MOVE.landSlideWindow; s.landVy = Math.sqrt(2 * MOVE.gravity * Math.max(0, s.airY0 - sup));
        }
        s.y = sup; s.vy = 0; s.ground = true;
      } else if (wasGround && s.ground && s.y - sup <= STEP && !(s.mo && ROPE_MOTIONS.has(s.mo.k))) { // 내리막·계단에 붙어 내려간다
        s.stepOff += s.y - sup; s.y = sup; s.vy = 0;
      } else { s.y = ny; s.ground = false; }
    } else {
      if (overlapTop(cs, s.x, ny, s.z, h) !== -Infinity) s.vy = 0; else s.y = ny;
      s.ground = false;
    }
  }
  if (wasGround && !s.ground) s.airY0 = py; // 땅을 떠난 높이 (점프·밀려 뜸·턱에서 떨어짐)
  s.stepOff *= Math.exp(-dt * 14);
  if (s.ground) ev.moved = Math.hypot(s.x - px, s.z - pz);
  return ev;
}

// 진행 방향 (dx, dz) 쪽으로 땅이 내려가는 정도 (경사로 위에서만. 내리막 + , 오르막 −)
function slopeAlong(cs, s, dx, dz) {
  const a = supportBelow(cs, s.x, s.y + 0.3, s.z), b = supportBelow(cs, s.x + dx * 0.4, s.y + 0.3, s.z + dz * 0.4);
  return clamp((a - b) / 0.4, -1, 1);
}
