// 캐릭터 애니메이션 컨트롤러 (3인칭 전신 · 1인칭 팔). 게임 상태 → 클립 가중치·시간.
//   구조 (docs/ARCHITECTURE.md "캐릭터 애니메이션"):
//     CharState      매 프레임 호출하는 쪽이 채우는 상태 (속도·방향·공중·조준·사격·재장전·무기)
//     TPAnimator     3인칭: 하체 층(이동·점프·낙하·착지) + 상체 층(이동 팔 흔들기 또는 라이플 클립)
//                    + 더하기 층(사격 반동) → 조준 방향 보정(골반 회전을 상체에서 되돌림 + 위아래 시선) → 왼손 IK → 총·탄창
//     FPAnimator     1인칭: 라이플 클립(허리 ↔ 정조준, 걷기, 재장전) + 더하기 반동 → 정조준 가늠자 맞춤 → 왼손 IK → 총·탄창
//   클립은 모두 시간을 직접 맞춘다 (timeScale 0): 걷기·달리기를 같은 걸음 위상으로 섞기 위해서다.
//   같은 뼈를 두 층이 쓰지 않는다: 하체 층은 하체 뼈만, 상체 층은 상체 뼈만 가진 클립 (charassets.js 에서 나눔).
//   각 층의 가중치 합은 항상 1 (모자라면 three.js 가 레스트 자세를 섞어 버린다).
import * as THREE from 'three';
import { tpAsset, fpAsset, makeInstance, REF_SPEED } from './charassets.js';
import { reachGrip, socketWorld, elbowPole, setWorldQuaternion, curlHand, handCurl, driveTwist, palmToBore } from './charik.js';
import { poseClip, hasClip } from './gunanim.js';

export const RIFLE_WEAPONS = new Set(['ar']); // 1인칭에서 팔 모델 클립이 총을 드는 무기 (지금은 기본 돌격소총만)
export const holdsGun = w => w.kind !== 'melee' && w.kind !== 'kunai'; // 3인칭: 총을 두 손으로 드는 무기 (라이플 상체 자세)
const gunAnimated = g => !!(g && g.clips && (hasClip(g, 'reload') || hasClip(g, 'reload_shell'))); // 총 모델에 장전 동작이 있다

const DIRS = ['f', 'r', 'b', 'l'];          // 진행 방향 순서 (각도 0, 90, 180, 270°: 앞, 오른쪽, 뒤, 왼쪽)
const ease = (w, target, dt, tau) => w + (target - w) * (1 - Math.exp(-dt / tau));
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);

// 재장전 중 탄창이 왼손을 따라가는 구간 (클립 길이 대비, animation_spec.md RELOAD_EVENTS)
const MAG = { grab: 0.24, drop: 0.36, fresh: 0.46, seat: 0.68 };

// 매 프레임 채우는 상태
export function newCharState() {
  return {
    fwd: 0, side: 0,      // 몸 기준 수평 속도 (m/s): 앞 +, 오른쪽 +
    air: false, vy: 0,    // 공중인가, 세로 속도
    ads: 0, sprint: false,
    rifle: false,         // 라이플 클립을 쓰는 무기를 들었나
    reloadF: null,        // 재장전 진행도 0~1 (아니면 null)
    shell: false,         // 지금 장전이 한 발씩(산탄총)인가
    endF: null,           // 한 발씩 장전이 끝난 뒤 마무리 동작 진행도 0~1
    shots: 0,             // 쏜 횟수 (늘어나면 반동을 재생)
    pitch: 0,             // 시선 위아래 (rad, 위 +)
    alive: true,
  };
}

// 4방향 가중치: 진행 각도(앞 0, 오른쪽 +)를 이웃한 두 방향으로 나눈다
function dirWeights(fwd, side, out) {
  let a = Math.atan2(side, fwd); if (a < 0) a += Math.PI * 2;
  const s = a / (Math.PI / 2), i = Math.floor(s) % 4, t = s - Math.floor(s);
  for (const d of DIRS) out[d] = 0;
  out[DIRS[i]] = 1 - t; out[DIRS[(i + 1) % 4]] += t;
  return out;
}

function action(mixer, clip, additive = false) {
  if (!clip) return null;
  const a = mixer.clipAction(clip);
  if (additive) a.blendMode = THREE.AdditiveAnimationBlendMode;
  a.play(); a.setEffectiveTimeScale(0); a.setEffectiveWeight(0); a.weight = 0;
  return a;
}
function setW(a, w) { if (a) a.setEffectiveWeight(w); }
function setT(a, t) { if (a) a.time = Math.max(0, Math.min(t, a.getClip().duration - 1e-4)); }
function setPhase(a, ph) { if (a) a.time = (ph % 1) * a.getClip().duration; }

// 총을 오른손 그립 뼈에 붙인다 (규칙: 총의 socket_hand_r = 그립, 총 축 그대로)
export function attachGun(gun, grip) {
  grip.add(gun.group);
  gun.group.position.set(0, -(gun.gripY ?? -0.085), -(gun.gripZ ?? 0));
  gun.group.quaternion.identity();
}

// three.js PropertyMixer 는 섞인 값이 지난 프레임과 같으면 뼈에 다시 쓰지 않는다.
// post() 가 뼈를 고친 채로 남으면 다음 보정이 그 위에 겹쳐 쌓이므로, 믹서를 돌리기 전에 지난 믹서 결과로 되돌린다.
function saveMix(st, bones) {
  if (!st.list) { st.list = [...bones.values()]; st.q = st.list.map(b => b.quaternion.clone()); }
  for (let i = 0; i < st.list.length; i++) st.q[i].copy(st.list[i].quaternion);
}
function restoreMix(st) {
  if (!st.list) return;
  for (let i = 0; i < st.list.length; i++) st.list[i].quaternion.copy(st.q[i]);
}

// 왼손 IK 를 가중치 w 로: 클립 자세와 IK 자세를 섞는다 (재장전 시작·끝에 손이 튀지 않게)
const IK_BONES = ['LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand'];
function blendedLeftIK(B, gripName, gripWorld, pole, w) {
  if (w <= 0.001) return;
  const bones = IK_BONES.map(n => B.get(n)).filter(Boolean);
  const before = bones.map(b => b.quaternion.clone());
  reachGrip('Left', B, gripName, gripWorld, pole);
  if (w < 0.999) bones.forEach((b, i) => { b.quaternion.copy(before[i].slerp(b.quaternion, w)); b.updateMatrixWorld(true); });
}

// 탄창 따라가기: 재장전 진행도 f 에 맞춰 총의 탄창(gun.mag)을 왼손 그립으로 옮기거나 숨기거나 되돌린다
function magFollow(st, gun, leftGrip, f) {
  const mag = gun && gun.mag;
  if (!mag || !leftGrip) return;
  if (st.magRest === undefined) { st.magRest = mag.position.clone(); st.magQ = mag.quaternion.clone(); st.magOff = null; }
  const inHand = f !== null && ((f >= MAG.grab && f < MAG.drop) || (f >= MAG.fresh && f < MAG.seat));
  const hidden = f !== null && f >= MAG.drop && f < MAG.fresh;
  if (f === null || f < MAG.grab) st.magOff = null;
  mag.visible = !hidden;
  if (!inHand) { if (gun.magRest) mag.position.copy(gun.magRest); else mag.position.copy(st.magRest); mag.quaternion.copy(st.magQ); return; }
  mag.parent.updateMatrixWorld(true); leftGrip.updateMatrixWorld(true);
  if (!st.magOff) { // 잡는 순간: 손 기준 탄창 위치를 기억한다
    if (gun.magRest) mag.position.copy(gun.magRest);
    mag.quaternion.copy(st.magQ); mag.updateMatrixWorld(true);
    st.magOff = _m.copy(leftGrip.matrixWorld).invert().multiply(mag.matrixWorld).clone();
  }
  _m.multiplyMatrices(leftGrip.matrixWorld, st.magOff);
  _m2.copy(mag.parent.matrixWorld).invert().multiply(_m);
  _m2.decompose(mag.position, mag.quaternion, _v);
}

// ───────────────────────── 3인칭 ─────────────────────────
export class TPAnimator {
  // 반환이 null 이면 캐릭터 모델이 없다 (예전 병사를 쓴다)
  static create() { const inst = makeInstance(tpAsset); return inst ? new TPAnimator(inst) : null; }

  constructor(inst) {
    this.inst = inst; this.bones = inst.bones;
    // 바깥 그룹(위치·yaw) → 모델(정면 +Z 로 만든 것을 게임 정면 -Z 로 돌림)
    this.root = new THREE.Group(); this.model = inst.root; this.model.rotation.y = Math.PI; this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const A = tpAsset, mk = (c, add) => action(this.mixer, c, add);
    const pair = p => p && { lower: mk(p.lower), upper: mk(p.upper) };
    this.loco = { idle: pair(A.loco.idle), jump: pair(A.loco.jump), fall: pair(A.loco.fall), land: pair(A.loco.land), walk: {}, run: {} };
    for (const g of ['walk', 'run']) for (const d of DIRS) this.loco[g][d] = pair(A.loco[g][d]);
    this.rifle = { idle: mk(A.rifle.idle), aim: mk(A.rifle.aim), walk: mk(A.rifle.walk), reload: mk(A.rifle.reload), fire: mk(A.rifle.fireAdd, true) };
    this.dur = { walk: A.loco.walk.f ? A.loco.walk.f.lower.duration : 0.9, run: A.loco.run.f ? A.loco.run.f.lower.duration : 0.533 };
    // 상태
    this.t = 0; this.phase = 0; this.move = 0; this.gait = 0; this.dirW = { f: 1, r: 0, b: 0, l: 0 };
    this.airW = 0; this.airT = 0; this.airKind = 'fall'; this.jumpT = 9; this.landT = 9; this.wasAir = false;
    this.rifleW = 0; this.aimW = 0; this.reloadW = 0; this.walkW = 0; this.fireT = 9; this.shots = 0;
    this.gun = null; this.gunMag = {}; this.mix = {};
    // 레스트 자세의 골반 회전 (모델 기준) — 이동 클립이 골반을 돌린 만큼 상체에서 되돌릴 때 쓴다
    this.model.updateMatrixWorld(true);
    const hips = this.bones.get('Hips');
    this.hipsRest = this.model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hips.getWorldQuaternion(new THREE.Quaternion()));
  }

  // 들고 있는 총 (guns.js buildGun 결과, 없으면 null)
  setGun(gun) {
    if (this.gun === gun) return;
    if (this.gun) { this.gun.group.visible = false; if (this.gun.mag) this.gun.mag.visible = true; if (this.gun.twin) this.gun.twin.group.visible = false; }
    this.gun = gun; this.gunMag = {};
    if (gun) { if (gun.group.parent !== this.bones.get('RightHandGrip')) attachGun(gun, this.bones.get('RightHandGrip')); gun.group.visible = true; }
    if (gun && gun.twin) { this.root.add(gun.twin.group); gun.twin.group.visible = true; } // 아킴보의 왼손 총
  }

  update(dt, s) {
    const L = this.loco, R = this.rifle;
    this.t += dt;
    // ── 이동 (땅) ──
    const speed = Math.hypot(s.fwd, s.side);
    this.move = ease(this.move, smooth(0.12, 0.9, speed), dt, 0.1);
    this.gait = ease(this.gait, Math.max(0, Math.min(1, (speed - REF_SPEED.walk) / (REF_SPEED.run - REF_SPEED.walk))), dt, 0.12);
    if (speed > 0.05) { const w = dirWeights(s.fwd, s.side, {}); for (const d of DIRS) this.dirW[d] = ease(this.dirW[d], w[d], dt, 0.12); }
    let sum = 0; for (const d of DIRS) sum += this.dirW[d]; for (const d of DIRS) this.dirW[d] /= sum || 1;
    // 걸음 위상: 걷기·달리기를 같은 위상으로 (딛은 발이 미끄러지지 않는 빠르기)
    const cps = (1 - this.gait) * (speed / REF_SPEED.walk) / this.dur.walk + this.gait * (speed / REF_SPEED.run) / this.dur.run;
    this.phase = (this.phase + dt * Math.max(cps, 0)) % 1;
    // ── 공중: 뛰어오름 → 낙하 → 착지 ──
    if (s.air) this.airT += dt; else this.airT = 0;
    const inAir = s.air && this.airT > 0.07; // 계단·턱의 짧은 공중은 무시
    if (inAir && !this.wasAir) { this.airKind = s.vy > 1 ? 'jump' : 'fall'; this.jumpT = 0; }
    if (!s.air && this.wasAir) this.landT = 0;
    this.wasAir = inAir;
    this.jumpT += dt; this.landT += dt;
    if (this.airKind === 'jump' && L.jump && this.jumpT > L.jump.lower.getClip().duration) this.airKind = 'fall';
    this.airW = ease(this.airW, inAir ? 1 : 0, dt, 0.06);
    const landDur = L.land ? L.land.lower.getClip().duration : 0;
    const landW = L.land && this.landT < landDur ? (1 - smooth(0.45, 1, this.landT / landDur)) * (1 - 0.7 * this.move) * (1 - this.airW) : 0;
    // 하체 가중치 (합 1)
    const ground = (1 - this.airW) * (1 - landW);
    const W = new Map();
    const add = (p, w) => { if (p && w > 1e-4) W.set(p, (W.get(p) || 0) + w); };
    add(L.idle, ground * (1 - this.move));
    for (const d of DIRS) { add(L.walk[d], ground * this.move * (1 - this.gait) * this.dirW[d]); add(L.run[d], ground * this.move * this.gait * this.dirW[d]); }
    const jumpK = this.airKind === 'jump' ? 1 : 0;
    add(L.jump, this.airW * jumpK); add(L.fall, this.airW * (1 - jumpK));
    add(L.land, landW);
    let tot = 0; for (const w of W.values()) tot += w;
    // ── 상체: 라이플 ──
    this.rifleW = ease(this.rifleW, s.rifle && R.idle ? 1 : 0, dt, 0.12);
    const own = gunAnimated(this.gun); // 총에 장전 동작이 있으면 캐릭터의 공용 장전 클립 대신 총을 따라간다
    const reloading = !own && s.reloadF !== null && !!R.reload;
    this.reloadW = ease(this.reloadW, reloading ? 1 : 0, dt, 0.08);
    this.aimW = ease(this.aimW, s.sprint || reloading || (own && s.reloadF !== null) ? 0 : smooth(0, 1, s.ads), dt, 0.06);
    this.walkW = ease(this.walkW, !s.air ? this.move : 0, dt, 0.12);
    const rw = this.rifleW;
    // 모든 이동 클립: 하체 + (1 - 라이플) 만큼 상체
    for (const p of [L.idle, L.jump, L.fall, L.land, ...DIRS.map(d => L.walk[d]), ...DIRS.map(d => L.run[d])]) {
      if (!p) continue;
      const w = (W.get(p) || 0) / (tot || 1);
      setW(p.lower, w); setW(p.upper, w * (1 - rw));
    }
    const rest = rw * (1 - this.reloadW), base = rest * (1 - this.aimW);
    setW(R.reload, rw * this.reloadW);
    setW(R.aim, rest * this.aimW);
    setW(R.walk, base * this.walkW);
    setW(R.idle, base * (1 - this.walkW) + (R.walk ? 0 : base * this.walkW));
    // 사격: 쏜 횟수가 늘면 반동(더하기)을 처음부터
    if (s.shots !== this.shots) { if (s.shots > this.shots) this.fireT = 0; this.shots = s.shots; }
    this.fireT += dt;
    const fd = R.fire ? R.fire.getClip().duration : 0;
    setW(R.fire, R.fire && this.fireT < fd && s.rifle ? rw : 0);
    // ── 시간 ──
    setPhase(L.idle && L.idle.lower, this.t / (L.idle ? L.idle.lower.getClip().duration : 1)); setPhase(L.idle && L.idle.upper, this.t / (L.idle ? L.idle.upper.getClip().duration : 1));
    for (const g of ['walk', 'run']) for (const d of DIRS) { const p = L[g][d]; if (p) { setPhase(p.lower, this.phase); setPhase(p.upper, this.phase); } }
    if (L.jump) { setT(L.jump.lower, this.jumpT); setT(L.jump.upper, this.jumpT); }
    if (L.fall) { const fdur = L.fall.lower.getClip().duration; setPhase(L.fall.lower, this.t / fdur); setPhase(L.fall.upper, this.t / fdur); }
    if (L.land) { setT(L.land.lower, this.landT); setT(L.land.upper, this.landT); }
    if (R.idle) setPhase(R.idle, this.t / R.idle.getClip().duration);
    if (R.aim) setPhase(R.aim, this.t / R.aim.getClip().duration);
    if (R.walk) setPhase(R.walk, this.phase);
    if (R.reload) setT(R.reload, (s.reloadF ?? 1) * R.reload.getClip().duration);
    if (R.fire) setT(R.fire, this.fireT);
    restoreMix(this.mix);
    this.mixer.update(0);
    saveMix(this.mix, this.bones);
    this.post(s); driveTwist(this.bones);
  }

  // 클립을 섞은 뒤: 조준 방향 보정 → 위아래 시선 → 왼손 IK → 탄창
  post(s) {
    const B = this.bones, rw = this.rifleW;
    this.root.updateMatrixWorld(true);
    const rootQ = this.model.getWorldQuaternion(_q3);
    if (rw > 0.01) {
      // 이동 클립이 골반을 돌린 만큼(걸음 흔들림·옆걸음 40°·달리기 숙임) 상체에서 되돌린다 → 총이 캐릭터 정면을 본다
      const hips = B.get('Hips'), spine = B.get('Spine');
      const d = _q.copy(rootQ).invert().multiply(hips.getWorldQuaternion(_q2)).multiply(_q2.copy(this.hipsRest).invert()); // 모델 기준 골반 변화
      const fix = _q2.copy(d).invert();
      _q.identity().slerp(fix, rw);
      const w = rootQ.clone().multiply(_q).multiply(rootQ.clone().invert());       // 월드 기준으로
      setWorldQuaternion(spine, w.multiply(spine.getWorldQuaternion(_q2)));
    }
    // 위아래 시선: 라이플이면 상체 전체(Spine1·Chest 나눠서), 아니면 목·머리만
    const right = _v.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(_q));
    const p = Math.max(-1.2, Math.min(1.2, s.pitch || 0));
    const bend = (name, k) => { const b = B.get(name); if (b && k) setWorldQuaternion(b, _q2.setFromAxisAngle(right, p * k).multiply(b.getWorldQuaternion(_q))); };
    bend('Spine1', 0.5 * rw); bend('Chest', 0.5 * rw);
    bend('Neck', 0.3 * (1 - rw)); bend('Head', 0.3 * (1 - rw));
    this.root.updateMatrixWorld(true);
    // 왼손: 총의 socket_hand_l 을 쥔다 (재장전 중에는 클립의 손을 그대로)
    const g = this.gun;
    if (gunAnimated(g)) { this.followGun(s, g, rw); this.fingers(rw); return; }
    if (g && g.group.visible) {
      const lw = socketWorld(g.group, 'socket_hand_l');
      if (lw) {
        const fwd = _v2.set(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(_q));
        blendedLeftIK(B, 'LeftHandGrip', lw, elbowPole(B, 'Left', fwd), rw * (1 - this.reloadW));
      }
    }
    if (g) magFollow(this.gunMag, g, B.get('LeftHandGrip'), s.rifle && s.reloadF !== null ? s.reloadF : null);
  }

  // 총의 장전 동작을 몸이 따라간다: 총 부품을 맞추고 → 오른손이 총 전체 동작대로 옮겨 가고 → 왼손이 anim_hand_l(또는 왼손 총)을 쥔다
  followGun(s, g, rw) {
    const B = this.bones, grip = B.get('RightHandGrip');
    const name = s.endF !== null ? 'reload_end' : s.shell ? 'reload_shell' : 'reload';
    const f = s.endF !== null ? s.endF : s.reloadF;
    const active = f !== null && hasClip(g, name);
    if (!poseClip(g, active ? name : 'reload', active ? f : 0, false) && !poseClip(g, 'reload_shell', 0, false)) return;
    if (g.mag) g.mag.visible = true;
    const fwd = _v2.set(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(_q)).clone();
    this.root.updateMatrixWorld(true);
    const rest = grip.matrixWorld.clone(); // 장전 동작을 빼고 총을 드는 자리
    const off = new THREE.Vector3(0, g.gripY ?? -0.085, g.gripZ ?? 0);
    // 총의 월드 변환 = 드는 자리 × (총 원점으로) × 동작
    const gunAt = m => {
      const M = rest.clone().multiply(_m.makeTranslation(-off.x, -off.y, -off.z));
      if (m) M.multiply(_m2.compose(m.p, m.q, _one));
      return M;
    };
    const gripTo = M => M.clone().multiply(_m.makeTranslation(off.x, off.y, off.z));
    if (active && g.motion && !g.twin) reachGrip('Right', B, 'RightHandGrip', gripTo(gunAt(g.motion)), elbowPole(B, 'Right', fwd));
    if (g.twin) { this.akimbo(g, active ? f : null, gunAt, gripTo, fwd, rw); return; }
    this.root.updateMatrixWorld(true);
    if (g.handTarget) _v.copy(g.handTarget.position).multiplyScalar(g.modelScale || 1);
    else _v.set(0, g.supportY ?? -0.05, g.supportZ ?? -0.2);
    g.group.updateWorldMatrix(true, false);
    const hq = palmToBore(g.group.getWorldQuaternion(_q2), _v, g.barrelY ?? 0, _q3); // 손바닥이 총열 쪽을 본다
    const at = _v.applyMatrix4(g.group.matrixWorld);
    _m.compose(at, hq, _one);
    blendedLeftIK(B, 'LeftHandGrip', _m, elbowPole(B, 'Left', fwd), rw);
  }

  // 손가락: 오른손은 총을 쥐고 검지는 방아쇠에, 왼손은 움직이면 펴고 멈추면 쥔다 (아킴보는 왼손도 총을 쥔다)
  fingers(rw) {
    if (rw < 0.01) return;
    const B = this.bones, now = performance.now() / 1000, dt = Math.min(0.1, now - (this.fT || now)); this.fT = now;
    curlHand(B, 'Right', 0.92 * rw, 0.45 * rw);
    if (this.gun && this.gun.twin) { curlHand(B, 'Left', 0.92 * rw, 0.45 * rw); return; }
    const h = B.get('LeftHand'); if (!h) return;
    curlHand(B, 'Left', rw * handCurl(this.leftCurl || (this.leftCurl = {}), h.getWorldPosition(_v), dt, 0.75, 0.2));
  }

  // 아킴보: 왼손 총은 오른손 총을 몸의 좌우 가운데면에 비춘 자리. 같은 클립을 조금 늦게 재생한다
  akimbo(g, f, gunAt, gripTo, fwd, rw) {
    const B = this.bones, t = g.twin;
    poseClip(t, 'reload', f === null ? 0 : Math.max(0, (f - 0.035) / 0.965), false);
    const inRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const spread = new THREE.Matrix4().makeTranslation(0.1, 0, 0); // 두 총 사이를 벌린다
    const right = spread.clone().multiply(inRoot).multiply(gunAt(f === null ? null : g.motion));
    const left = spread.clone().multiply(inRoot).multiply(gunAt(f === null ? null : t.motion));
    const S = new THREE.Matrix4().makeScale(-1, 1, 1);
    const lw = S.clone().multiply(left);                       // 좌우로 비춘 총 (뒤집힌 모양)
    const under = f === null || !t.motion ? 0 : 0.25 * Math.max(0, -t.motion.p.x);
    lw.elements[13] -= under;
    lw.decompose(t.group.position, t.group.quaternion, t.group.scale);
    const rWorld = this.root.matrixWorld.clone().multiply(right);
    reachGrip('Right', B, 'RightHandGrip', gripTo(rWorld), elbowPole(B, 'Right', fwd));
    t.group.updateWorldMatrix(false, false);
    const hand = left.clone().premultiply(S).multiply(S);        // 회전만 남긴 비춘 자리 (뒤집힘 없음)
    hand.elements[13] -= under;
    const target = gripTo(this.root.matrixWorld.clone().multiply(hand));
    blendedLeftIK(B, 'LeftHandGrip', target, elbowPole(B, 'Left', fwd), rw);
    this.root.updateMatrixWorld(true);
  }
}

// ───────────────────────── 1인칭 ─────────────────────────
export class FPAnimator {
  static create() { const inst = makeInstance(fpAsset); return inst && fpAsset.rifle.idle ? new FPAnimator(inst) : null; }

  constructor(inst) {
    this.inst = inst; this.bones = inst.bones; this.root = inst.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    const C = fpAsset.rifle, mk = (c, add) => action(this.mixer, c, add);
    this.a = { idle: mk(C.idle), aim: mk(C.aim), walk: mk(C.walk), reload: mk(C.reload), fire: mk(C.fireAdd, true) };
    this.t = 0; this.phase = 0; this.aimW = 0; this.walkW = 0; this.reloadW = 0; this.fireT = 9; this.shots = 0;
    this.gun = null; this.gunMag = {}; this.mix = {};
    this.sightFix = new THREE.Vector3();
  }

  setGun(gun) {
    if (this.gun === gun) return;
    this.gun = gun; this.gunMag = {};
    if (gun) attachGun(gun, this.bones.get('ViewmodelRightGrip'));
  }

  // s: CharState (speed 는 fwd/side 로), ads 0~1. space = 이 1인칭 팔이 들어 있는 그룹 (카메라 공간)
  update(dt, s, space) {
    const A = this.a;
    this.t += dt;
    const speed = Math.hypot(s.fwd, s.side);
    const reloading = s.reloadF !== null && !!A.reload;
    this.reloadW = ease(this.reloadW, reloading ? 1 : 0, dt, 0.06);
    const k = smooth(0, 1, s.ads);                    // 정조준: 무기 상태의 adsT 그대로 (adsTime 동안 올라간다)
    this.aimW = reloading ? 0 : k;
    this.walkW = ease(this.walkW, !s.air && !s.sprint ? smooth(0.2, 1.2, speed) : 0, dt, 0.1);
    this.phase = (this.phase + dt * (speed / REF_SPEED.walk) / (A.walk ? A.walk.getClip().duration : 0.9)) % 1;
    const rest = 1 - this.reloadW, base = rest * (1 - this.aimW);
    setW(A.reload, this.reloadW); setW(A.aim, rest * this.aimW);
    setW(A.walk, base * this.walkW); setW(A.idle, base * (1 - this.walkW) + (A.walk ? 0 : base * this.walkW));
    if (s.shots !== this.shots) { if (s.shots > this.shots) this.fireT = 0; this.shots = s.shots; }
    this.fireT += dt;
    setW(A.fire, A.fire && this.fireT < A.fire.getClip().duration ? 1 - (s.fireDamp || 0) * this.aimW : 0); // 조준 방식(weaponview.js)에 따라 정조준 중 발사 반동 연출을 줄인다
    setPhase(A.idle, this.t / A.idle.getClip().duration);
    if (A.aim) setPhase(A.aim, this.t / A.aim.getClip().duration);
    if (A.walk) setPhase(A.walk, this.phase);
    if (A.reload) setT(A.reload, (s.reloadF ?? 1) * A.reload.getClip().duration);
    if (A.fire) setT(A.fire, this.fireT);
    this.root.position.set(0, 0, 0);
    restoreMix(this.mix);
    this.mixer.update(0);
    saveMix(this.mix, this.bones);
    this.post(s, space, k); driveTwist(this.bones);
  }

  // 왼손 그립을 world 변환(Matrix4)으로 옮긴다 (w 0~1). 총의 장전 클립이 왼손 목표를 줄 때 (viewmodel.js)
  reachLeft(world, w, space) {
    blendedLeftIK(this.bones, 'ViewmodelLeftGrip', world, elbowPole(this.bones, 'Left', _v2.set(0, 0, -1).applyQuaternion(space.getWorldQuaternion(_q))), w);
    this.root.updateMatrixWorld(true);
  }

  post(s, space, k) {
    const B = this.bones, g = this.gun;
    this.root.updateMatrixWorld(true);
    // 정조준: 달린 조준경에 따라 조준선 높이가 다르다 → 조준점이 화면 중앙(카메라 축)에 오도록 팔 전체를 옮긴다
    if (g && k > 0.001) {
      _v.set(0, g.sightY, g.adsZ !== undefined ? 0 : 0);
      g.group.localToWorld(_v); space.worldToLocal(_v);
      this.sightFix.set(-_v.x, -_v.y, 0).multiplyScalar(k);
      this.root.position.copy(this.sightFix);
      this.root.updateMatrixWorld(true);
    }
    if (g) {
      const lw = socketWorld(g.group, 'socket_hand_l');
      if (lw) blendedLeftIK(B, 'ViewmodelLeftGrip', lw, elbowPole(B, 'Left', _v2.set(0, 0, -1).applyQuaternion(space.getWorldQuaternion(_q))), 1 - this.reloadW);
    }
    if (g) magFollow(this.gunMag, g, B.get('ViewmodelLeftGrip'), s.reloadF);
  }
}
