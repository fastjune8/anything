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
// 반환: { reached(원래 목표에 닿았나), slid(당긴 거리 m) } — 뼈가 없으면 null
export function reachGrip(side, bones, gripName, gripWorld, pole, slide = null) {
  const S = side, upper = bones.get(`${S}UpperArm`), lower = bones.get(`${S}ForeArm`), hand = bones.get(`${S}Hand`), grip = bones.get(gripName);
  if (!upper || !lower || !hand || !grip) return false;
  hand.updateMatrixWorld(true);
  _m.copy(hand.matrixWorld).invert().multiply(grip.matrixWorld); // 손 기준 그립
  _m2.copy(gripWorld).multiply(_m.invert());                       // 손이 있어야 할 월드 변환
  const target = new THREE.Vector3(), q = new THREE.Quaternion();
  _m2.decompose(target, q, _s);
  let slid = 0;
  if (slide) { // 어깨에서 리치 밖이면 slide 방향으로 당긴다: |target + slide·t − 어깨| = 리치 의 가장 작은 t
    upper.updateMatrixWorld(true); lower.updateMatrixWorld(true);
    const a = upper.getWorldPosition(new THREE.Vector3()), reach = (a.distanceTo(lower.getWorldPosition(new THREE.Vector3())) + lower.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()))) * 0.985;
    const d = target.clone().sub(a), u = slide.clone().normalize();
    if (d.length() > reach) {
      const B = 2 * d.dot(u), C = d.lengthSq() - reach * reach, disc = B * B - 4 * C;
      if (disc >= 0) { const t = (-B - Math.sqrt(disc)) / 2; if (t > 0) { target.addScaledVector(u, t); slid = t; } }
    }
  }
  const okReach = twoBoneIK(upper, lower, hand, target, pole);
  setWorldQuaternion(hand, q);
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
