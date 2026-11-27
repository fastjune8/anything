// 캐릭터 팔 IK (2-본 해석해) + 무기 쥐기. 스튜디오 캐릭터 보기가 쓰고, 나중에 게임의 3인칭·1인칭 캐릭터도 같이 쓴다.
//   규칙 (모델링/character/rigging_specification.md 4절):
//   - 무기는 오른손 그립(RightHandGrip / ViewmodelRightGrip)에 붙인다. 무기의 socket_hand_r 이 그 자리에 온다
//   - 왼손: 무기의 socket_hand_l 에 왼손 그립(LeftHandGrip)이 오도록 위팔·아래팔을 2-본 IK
//   - 팔이 닿지 않으면 목표를 총열 축을 따라 손 쪽으로 당긴다 (리치 = (위팔 + 아래팔) × 0.985)
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _s = new THREE.Vector3();

// 뼈를 회전해 from(월드) 점이 to(월드) 쪽을 향하게 (뼈 위치를 축으로)
function aim(bone, from, to) {
  bone.getWorldPosition(_a);
  const v1 = from.clone().sub(_a), v2 = to.clone().sub(_a);
  if (v1.lengthSq() < 1e-10 || v2.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(v1.normalize(), v2.normalize());
  bone.getWorldQuaternion(_q2);
  setWorldQuaternion(bone, _q.multiply(_q2));
}
export function setWorldQuaternion(obj, q) {
  const pq = obj.parent ? obj.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  obj.quaternion.copy(pq.invert().multiply(q));
  obj.updateMatrixWorld(true);
}

// upper·lower·hand 3 뼈로 손(hand 원점)을 target(월드)에. pole = 팔꿈치가 향할 쪽(월드 점). 반환: 닿았는가
export function twoBoneIK(upper, lower, hand, target, pole) {
  upper.updateMatrixWorld(true);
  const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = hand.getWorldPosition(new THREE.Vector3());
  const la = a.distanceTo(b), lb = b.distanceTo(c), reach = (la + lb) * 0.985;
  const toT = target.clone().sub(a);
  const dist = Math.max(1e-4, Math.min(toT.length(), reach));
  const dir = toT.normalize();
  // 팔꿈치 자리: a→target 축에서 pole 쪽으로
  const cosA = Math.max(-1, Math.min(1, (la * la + dist * dist - lb * lb) / (2 * la * dist)));
  const side = pole.clone().sub(a); side.sub(dir.clone().multiplyScalar(side.dot(dir)));
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0);
  side.normalize();
  const elbow = a.clone().addScaledVector(dir, cosA * la).addScaledVector(side, Math.sqrt(1 - cosA * cosA) * la);
  aim(upper, b, elbow);
  lower.updateMatrixWorld(true);
  aim(lower, hand.getWorldPosition(_c), a.clone().addScaledVector(dir, dist));
  return toT.length() <= reach + 1e-4 || target.distanceTo(a) <= reach;
}

// 손 뼈의 자식 그립(grip)이 월드 변환 gripWorld(Matrix4) 에 오도록 팔을 맞춘다
//   손 목표 = gripWorld × (손 기준 그립 행렬)^-1 → IK 로 손 위치, 그다음 손 회전
//   slide(월드 방향, 선택): 닿지 않으면 목표를 이 방향(총열을 따라 손잡이 쪽)으로 닿는 데까지 당긴다 (규칙 4절)
//   손목이 꺾이지 않게 (2026-11-27):
//   - 팔꿈치: 손이 가리키는 방향의 반대쪽(아래팔이 손과 일직선이 되는 자리)으로 둔다. pole 은 그쪽이 애매할 때의 기본값
//   - 손목 꺾임 한계: opt.maxBend(rad). 왼손(받치는 손)은 기본 0.9 rad, 오른손은 총이 손에 붙어 있어 한계 없음
//   - 비틀림: 손을 돌린 만큼의 일부를 아래팔(꼬임 뼈 ForeArmTwist 가 있으면 그 뼈)이 나눠 받는다 → 손목 한 점에서 꼬이지 않는다
// 반환: { reached(원래 목표에 닿았나), slid(당긴 거리 m) } — 뼈가 없으면 null
const Y = new THREE.Vector3(0, 1, 0);
export function reachGrip(side, bones, gripName, gripWorld, pole, slide = null, opt = {}) {
  const S = side, upper = bones.get(`${S}UpperArm`), lower = bones.get(`${S}ForeArm`), hand = bones.get(`${S}Hand`), grip = bones.get(gripName);
  if (!upper || !lower || !hand || !grip) return false;
  hand.updateMatrixWorld(true);
  _m.copy(hand.matrixWorld).invert().multiply(grip.matrixWorld); // 손 기준 그립
  _m2.copy(gripWorld).multiply(_m.invert());                       // 손이 있어야 할 월드 변환
  const target = new THREE.Vector3(), q = new THREE.Quaternion();
  _m2.decompose(target, q, _s);
  upper.updateMatrixWorld(true);
  const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = hand.getWorldPosition(new THREE.Vector3());
  const la = a.distanceTo(b), lb = b.distanceTo(c);
  let slid = 0;
  if (slide) { // 어깨에서 리치 밖이면 slide 방향으로 당긴다: |target + slide·t − 어깨| = 리치 의 가장 작은 t
    const reach = (la + lb) * 0.985;
    const d = target.clone().sub(a), u = slide.clone().normalize();
    if (d.length() > reach) {
      const B = 2 * d.dot(u), C = d.lengthSq() - reach * reach, disc = B * B - 4 * C;
      if (disc >= 0) { const t = (-B - Math.sqrt(disc)) / 2; if (t > 0) { target.addScaledVector(u, t); slid = t; } }
    }
  }
  // 팔꿈치가 갈 쪽: 아래팔이 손과 일직선이 되는 점(손목에서 손 방향 반대로 아래팔 길이)과 기본 pole 을 섞는다
  const rest = hand.userData.rest || (hand.userData.rest = hand.quaternion.clone()); // 손의 쉬는 회전 (아래팔 기준, charassets makeInstance)
  const handDir = Y.clone().applyQuaternion(q.clone().multiply(rest.clone().invert())); // 손이 이 회전이면 아래팔이 향할 방향
  const ideal = target.clone().addScaledVector(handDir, -lb);
  const axis = target.clone().sub(a).normalize();
  const perp = v => { const x = v.clone().sub(a); return x.sub(axis.clone().multiplyScalar(x.dot(axis))); };
  const sideV = perp(ideal), base = perp(pole);
  if (base.lengthSq() > 1e-8) base.normalize().multiplyScalar(0.06);
  if (sideV.y > 0) sideV.y *= 0.25; // 팔꿈치를 위로 치켜들지 않는다
  const bend = a.clone().add(sideV.add(base));
  // 손바닥(그립)이 손 기준 어디에 있는지 (월드 길이) — 손목 꺾임을 줄이면 손바닥이 밀리므로 손목 목표를 옮겨 다시 푼다
  const o = grip.getWorldPosition(new THREE.Vector3()).sub(c).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert());
  const gp = new THREE.Vector3().setFromMatrixPosition(gripWorld).add(target.clone().sub(new THREE.Vector3().setFromMatrixPosition(_m2)));
  const maxBend = opt.maxBend ?? (S === 'Left' ? 0.6 : Infinity);
  let okReach = false, want = null, twist = null;
  for (let it = 0; it < 4; it++) {
    okReach = twoBoneIK(upper, lower, hand, target, bend);
    // 손 회전 = 아래팔 × 쉬는 회전 × (꺾임 · 비틀림). 꺾임은 한계까지
    const fq = lower.getWorldQuaternion(new THREE.Quaternion());
    const d = fq.clone().multiply(rest).invert().multiply(q);           // 쉬는 손 기준 남은 회전
    twist = new THREE.Quaternion(0, d.y, 0, d.w); if (twist.lengthSq() < 1e-10) twist.identity(); else twist.normalize();
    const swing = d.clone().multiply(twist.clone().invert());
    const ang = 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
    if (ang > maxBend) swing.slerp(new THREE.Quaternion(), 1 - maxBend / ang);
    want = fq.multiply(rest).multiply(swing).multiply(twist);
    if (ang <= maxBend) break;
    const palm = hand.getWorldPosition(new THREE.Vector3()).add(o.clone().applyQuaternion(want));
    const err = gp.clone().sub(palm); if (err.lengthSq() < 1e-6) break;
    target.add(err);
  }
  if (!bones.get(`${S}ForeArmTwist`)) { // 꼬임 뼈가 없는 모델: 아래팔 전체가 일부를 받는다 (있으면 driveTwist 가 그 뼈에 준다)
    lower.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y, 0.35 * 2 * Math.atan2(twist.y, twist.w)));
    lower.updateMatrixWorld(true);
  }
  setWorldQuaternion(hand, want);
  return { reached: okReach && slid === 0, slid };
}

// 무기의 부착 지점 월드 변환 (무기 축 그대로)
export function socketWorld(gun, name) {
  const s = gun.getObjectByName(name);
  if (!s) return null;
  gun.updateMatrixWorld(true);
  const p = s.getWorldPosition(new THREE.Vector3()), q = gun.getWorldQuaternion(new THREE.Quaternion());
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}

// 팔꿈치 방향: 어깨에서 바깥·아래·뒤 (forward = 캐릭터 정면)
export function elbowPole(bones, side, forward) {
  const up = bones.get(`${side}UpperArm`), chest = bones.get('Chest') || bones.get('ViewmodelChest');
  if (!up) return new THREE.Vector3();
  const sp = up.getWorldPosition(new THREE.Vector3()), cp = chest ? chest.getWorldPosition(new THREE.Vector3()) : sp.clone();
  const out = sp.clone().sub(cp); out.y = 0; if (out.lengthSq() < 1e-6) out.set(side === 'Left' ? 1 : -1, 0, 0); out.normalize();
  return sp.addScaledVector(out, 0.35).add(new THREE.Vector3(0, -0.45, 0)).addScaledVector(forward, -0.3);
}

// 손가락 쥐기 (캐릭터 손가락 뼈: {side}{Index|Middle|Ring|Little}{1..3} 는 로컬 −X 로 굽는다, 쉬는 회전 기준)
//   curl 0 = 편 손, 1 = 꽉 쥔 손. trigger = 검지만 따로 (방아쇠 손가락). 움직이는 손은 펴고 멈춘 손은 쥔다 → handCurl
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'], BENDS = [0.95, 1.15, 0.75], _x = new THREE.Vector3(1, 0, 0), _zt = new THREE.Vector3(0, 0, 1), _fq = new THREE.Quaternion();
export function curlHand(bones, side, curl, trigger = null) {
  for (const f of FINGERS) {
    const c = f === 'Index' && trigger !== null ? trigger : curl;
    for (let k = 0; k < 3; k++) {
      const b = bones.get(`${side}${f}${k + 1}`); if (!b || !b.userData.rest) continue;
      b.quaternion.copy(b.userData.rest).multiply(_fq.setFromAxisAngle(_x, -c * BENDS[k]));
    }
  }
  // 엄지: 뿌리(로컬 +Z)는 검지 쪽으로 모으고, 끝마디는 감는다 → 쥘 때 엄지가 옆으로 튀어나오지 않는다
  const t1 = bones.get(`${side}Thumb1`);
  if (t1 && t1.userData.rest) t1.quaternion.copy(t1.userData.rest).multiply(_fq.setFromAxisAngle(_zt, 0.6 * curl));
  for (let k = 2; k <= 3; k++) {
    const b = bones.get(`${side}Thumb${k}`); if (b && b.userData.rest) b.quaternion.copy(b.userData.rest).multiply(_fq.setFromAxisAngle(_x, -0.45 * curl));
  }
  const h = bones.get(`${side}Hand`); if (h) h.updateMatrixWorld(true);
}
// 손이 빠르게 움직이면 펴고(잡으러 가는 중), 멈추면 쥔다(잡고 있다). key = 손마다 기억할 곳
export function handCurl(store, pos, dt, hold = 0.8, open = 0.2) {
  if (!store.p) { store.p = pos.clone(); store.c = hold; }
  const v = dt > 0 ? store.p.distanceTo(pos) / dt : 0; store.p.copy(pos);
  const want = hold - (hold - open) * Math.min(1, Math.max(0, (v - 0.4) / 1.4));
  store.c += (want - store.c) * (1 - Math.exp(-dt * 14));
  return store.c;
}

// 아래팔 꼬임 뼈(ForeArmTwist, 모델 V.10~): 손이 아래팔 축으로 돈 만큼의 k 를 받는다 → 비틀림이 손목 한 점이 아니라 아래팔에 퍼진다.
//   매 프레임 마지막(클립·IK 뒤)에 부른다. 손 뼈의 축(Y)과 아래팔 축이 같다 (손의 쉬는 회전은 축 둘레 90°)
const _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion();
export function driveTwist(bones, k = 0.55) {
  for (const S of ['Left', 'Right']) {
    const tb = bones.get(`${S}ForeArmTwist`), h = bones.get(`${S}Hand`);
    if (!tb || !h || !h.userData.rest) continue;
    _tq.copy(h.userData.rest).invert().multiply(h.quaternion);
    const a = 2 * Math.atan2(_tq.y, _tq.w);
    tb.quaternion.copy(tb.userData.rest || _tq2.identity()).multiply(_tq2.setFromAxisAngle(Y, (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a) * k));
    tb.updateMatrixWorld(true);
  }
}

// 받치는 손의 방향: 총 축(-Z) 둘레로 손바닥이 총열 쪽을 보게 돌린다. at = 총 그룹 좌표의 손 자리 (총열 아래면 그대로, 위면 뒤집어 덮는다)
const _z = new THREE.Vector3(0, 0, 1), _rq = new THREE.Quaternion();
export function palmToBore(gunQ, at, boreY = 0, out = new THREE.Quaternion()) {
  const x = at.x, y = at.y - boreY, r = Math.hypot(x, y);
  const roll = Math.atan2(x, -y) * Math.min(1, r / 0.03); // 총열 바로 옆(3cm 안)은 그대로 둔다
  return out.copy(gunQ).multiply(_rq.setFromAxisAngle(_z, roll));
}
