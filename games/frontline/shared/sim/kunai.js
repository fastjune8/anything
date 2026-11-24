// 듀얼 쿠나이 (Thread Manipulator) — 서버·브라우저 공용, 결정적. 기획: docs/weapons/DUAL_KUNAI.md
//   왼손(0)·오른손(1) 쿠나이가 따로 움직인다: 준비 → 비행 → 앵커(벽·바닥에 박힘) → 회수 → 잠깐 대기 → 준비
//   좌클릭 = 왼손, 우클릭 = 오른손 (준비면 던지고, 날아가거나 박혀 있으면 회수). R = 둘 다 회수. X = 기동/설치 모드 전환
//   무기 스킬 키(Q/E) = 모드에 따른 능력: 기동 → 앵커 쪽으로 끌려간다, 설치 → 지금 노드(앵커·핀)로 와이어 네트워크 (shared/sim/thread.js)
//   F = 핀 노드 (조준한 곳에 와이어용 점을 하나 더, 충전식 2개)
//   여기서 하는 것: 비행과 벽 충돌, 앵커·와이어 수명, 회수, 끌려가기 목표. 사람에게 맞았는지(직접 명중·와이어 감지·돌진 공격)는 서버가 판정한다
//   (ev.ku 에 이번 tick 의 비행 구간을 내보내면 server/game/room.js 가 되감은 적 자세로 검사한다)
import { rayWorld } from '../collision.js';
import { startMotion, eyeY, ropeTarget, findLedge } from './movement.js';
import { BTN } from './config.js';
import { THREAD, resetThread, copyThread, stepThread, buildThread, markNode } from './thread.js';
export { wireOn, wireTime, segEnds, nodePos, activeNodes, planThread, areaValid, areaShape, inArea, pinCount, THREAD, KIND_NAME } from './thread.js';

// 수치 (기획서 초기값 — 플레이 테스트로 고친다)
export const KUNAI = {
  speed: 62, gravity: 3,       // 던지는 속도 (m/s), 살짝 떨어진다
  range: 35,                   // 최대 비행 거리 · 앵커가 플레이어에게서 이보다 멀어지면 회수
  anchorLife: 20,              // 앵커 유지 시간 (초)
  wireLife: THREAD.wireLife,   // 와이어 유지 시간 (초, 앵커와 따로 — 선분마다. 네트워크 수치는 thread.js)
  returnSpeed: 50, readyDelay: 0.12, // 회수 속도 · 손에 돌아온 뒤 다시 던질 수 있을 때까지
  pull: { max: 28, snap: 11, kick: 0.6, steer: 7, dur: 1.8, grav: 0.12, arrive: 1.3, arriveMid: 2.2 }, // 끌려가기: 최고 속도 · 그 속도로 붙는 빠르기(클수록 탁) · 시작 속도(최고의 비율) · 방향키로 트는 속도 · 최대 시간 · 중력 배율 · 도착 거리(앵커 1개 / 2개 가운데)
  dash: { minSpeed: 9, dmg: 35, push: 7, lift: 2.5, stun: 0.25, reach: 0.95, keep: 0.35 }, // 기동 중 적과 부딪힘
  wire: { radius: 0.55, slow: 0.6, slowDur: 1.2, reveal: 3, cd: 2.5, cutRadius: 0.15 },     // 감지 거리 · 이동 방해 · 위치 표시 · 같은 적 재발동 간격 · 총알로 끊는 거리
};
// 상태
export const KS = { READY: 0, FLY: 1, ANCHOR: 2, RETURN: 3, COOL: 4 };
export const KS_NAME = ['준비', '비행', '고정', '회수', '회수'];
export const isKunai = w => !!w && w.kind === 'kunai';
export const kunaiSlot = lo => lo.findIndex(l => isKunai(l.w));

const newOne = () => ({ s: KS.READY, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, d: 0, n: 2 });
export function resetKunai(ps) { ps.ku = [newOne(), newOne()]; ps.kmode = 0; resetThread(ps); }
export function copyKunai(dst, src) { dst.ku = (src.ku || [newOne(), newOne()]).map(k => ({ ...k })); dst.kmode = src.kmode | 0; copyThread(dst, src); }
export const anchored = ps => ps.ku.filter(k => k.s === KS.ANCHOR);

// 손 위치 (h = 0 왼손, 1 오른손) — 그리기·회수 목표
export function handPos(ps, h) {
  const rx = Math.cos(ps.yaw), rz = -Math.sin(ps.yaw), side = h ? 0.24 : -0.24;
  return { x: ps.x + rx * side, y: eyeY(ps) - 0.22, z: ps.z + rz * side };
}
const aim = (yaw, pitch) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });

function throwOne(ps, h, ev) {
  const k = ps.ku[h], d = aim(ps.yaw, ps.pitch);
  // 눈 위치에서 조준선 그대로 날아간다 (조준한 곳에 정확히 — 손에서 나가는 모습은 브라우저가 그린다)
  k.s = KS.FLY; k.x = ps.x; k.y = eyeY(ps); k.z = ps.z;
  k.vx = d.x * KUNAI.speed; k.vy = d.y * KUNAI.speed; k.vz = d.z * KUNAI.speed; k.d = 0; k.t = 0;
  ps.st.protect = 0; // 부활 보호: 공격하면 풀린다
  (ev.kuThrow || (ev.kuThrow = [])).push(h);
}
export function recallOne(ps, h, ev) {
  const k = ps.ku[h];
  if (k.s !== KS.FLY && k.s !== KS.ANCHOR) return false;
  k.s = KS.RETURN; k.vx = k.vy = k.vz = 0;
  if (ev) (ev.kuRecall || (ev.kuRecall = [])).push(h);
  return true;
}

// 1 tick. held = 쿠나이를 손에 들고 있다, act = 행동할 수 있다(살아 있음·넘어지지 않음), press(b) = 이번 tick 에 누른 버튼
export function stepKunai(ps, lo, cs, dt, ev, held, act, press) {
  if (!ps.ku) resetKunai(ps);
  if (held && act && ps.drawT <= 0) {
    if (press(BTN.mode)) { ps.kmode = ps.kmode ? 0 : 1; ev.kmode = ps.kmode; }
    for (const [b, h] of [[BTN.fire, 0], [BTN.ads, 1]]) {
      if (!press(b)) continue;
      if (ps.ku[h].s === KS.READY) throwOne(ps, h, ev);
      else recallOne(ps, h, ev);
    }
    if (press(BTN.reload)) { recallOne(ps, 0, ev); recallOne(ps, 1, ev); }
  }
  const ex = ps.x, ey = eyeY(ps), ez = ps.z;
  for (let h = 0; h < 2; h++) {
    const k = ps.ku[h];
    if (k.s === KS.FLY) {
      k.vy -= KUNAI.gravity * dt;
      const sp = Math.hypot(k.vx, k.vy, k.vz), len = sp * dt, d = { x: k.vx / sp, y: k.vy / sp, z: k.vz / sp }, o = { x: k.x, y: k.y, z: k.z };
      const wall = rayWorld(o, d, cs, len);
      if (wall.t < len) {
        const t = Math.max(0, wall.t - 0.03);
        k.x += d.x * t; k.y += d.y * t; k.z += d.z * t; k.d += wall.t;
        k.s = KS.ANCHOR; k.t = KUNAI.anchorLife; k.n = wall.n; markNode(ps, h);
        (ev.ku || (ev.ku = [])).push({ h, o, d, len: wall.t });
        (ev.kuAnchor || (ev.kuAnchor = [])).push(h);
      } else {
        k.x += d.x * len; k.y += d.y * len; k.z += d.z * len; k.d += len;
        (ev.ku || (ev.ku = [])).push({ h, o, d, len });
        if (k.d >= KUNAI.range) recallOne(ps, h, null);
      }
    } else if (k.s === KS.ANCHOR) {
      k.t -= dt;
      if (k.t <= 0 || Math.hypot(k.x - ex, k.y - ey, k.z - ez) > KUNAI.range) { recallOne(ps, h, null); (ev.kuExpire || (ev.kuExpire = [])).push(h); }
    } else if (k.s === KS.RETURN) {
      const hp = handPos(ps, h), dx = hp.x - k.x, dy = hp.y - k.y, dz = hp.z - k.z, dist = Math.hypot(dx, dy, dz), step = KUNAI.returnSpeed * dt;
      if (dist <= Math.max(step, 0.6)) { k.s = KS.COOL; k.t = KUNAI.readyDelay; k.x = hp.x; k.y = hp.y; k.z = hp.z; }
      else { k.x += dx / dist * step; k.y += dy / dist * step; k.z += dz / dist * step; }
    } else if (k.s === KS.COOL) {
      k.t -= dt;
      if (k.t <= 0) { k.s = KS.READY; k.t = 0; (ev.kuReady || (ev.kuReady = [])).push(h); }
    }
  }
  // 와이어 네트워크: 핀 노드(F) · 선분·영역 수명 (앵커와 따로, 빠진 노드의 선분은 정리)
  stepThread(ps, cs, dt, ev, held, act, press);
  // 끌려가는 중이면 목표를 지금 앵커로 다시 잡는다 (하나를 회수하면 남은 쪽으로, 새로 박으면 두 앵커 가운데로)
  if (ps.mo && ps.mo.k === 'kpull') {
    const tg = pullTarget(ps, cs), m = ps.mo;
    if (!tg) m.gone = true; else { m.tx = tg.x; m.ty = tg.y; m.tz = tg.z; m.ledge = tg.ledge; m.arrive = tg.arrive; }
  }
}

// 끌려가는 목표 (몸 가운데가 갈 자리): 앵커 1개 = 그 앵커 앞 (벽이면 손이 닿는 높이, 위에 올라설 자리가 있으면 턱 넘기),
//   2개 = 두 앵커의 가운데 (공중을 가로지르며 속도를 가진 채 빠져나간다 — 새총처럼)
export function pullTarget(ps, cs = null) {
  const a = anchored(ps), P = KUNAI.pull;
  if (!a.length) return null;
  if (a.length === 1) { const t = ropeTarget(a[0], a[0].n); return { ...t, ledge: cs ? findLedge(cs, a[0], a[0].n) : null, arrive: P.arrive }; }
  return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, z: (a[0].z + a[1].z) / 2, ledge: null, arrive: P.arriveMid };
}

// 무기 스킬 키 = 모드 능력. 반환: 발동했나 (조건이 안 맞으면 쿨타임을 쓰지 않는다)
export function kunaiAbility(ps, ev, cs) {
  const n = anchored(ps).length;
  if (ps.kmode === 0) { // 기동
    if (!n) { ev.kunaiFail = '앵커가 없다 — 먼저 쿠나이를 박는다'; return false; }
    const tg = pullTarget(ps, cs), P = KUNAI.pull;
    startMotion(ps, 'kpull', { tx: tg.x, ty: tg.y, tz: tg.z, dur: P.dur, max: P.max, snap: P.snap, kick: P.kick, steer: P.steer, grav: P.grav, arrive: tg.arrive, ledge: tg.ledge });
    return true;
  }
  return buildThread(ps, cs, ev); // 설치: 노드 2개 = 직선, 3·4개 = 영역 (엇갈리면 교차 와이어)
}

// ───── 판정용 기하 (서버) ─────
// 선분 p0-p1 과 q0-q1 사이 가장 가까운 거리. 반환 { d, s, t } (s·t = 각 선분 위 위치 0~1)
export function segSegDist(p0, p1, q0, q1) {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z, vx = q1.x - q0.x, vy = q1.y - q0.y, vz = q1.z - q0.z;
  const wx = p0.x - q0.x, wy = p0.y - q0.y, wz = p0.z - q0.z;
  const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz, D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; }
  else { sN = b * e - c * d; tN = a * e - b * d; if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; } }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
  const s = Math.abs(sN) < 1e-9 ? 0 : sN / sD, t = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  const dx = wx + s * ux - t * vx, dy = wy + s * uy - t * vy, dz = wz + s * uz - t * vz;
  return { d: Math.hypot(dx, dy, dz), s, t };
}
