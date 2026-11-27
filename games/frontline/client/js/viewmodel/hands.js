// 1인칭 캐릭터 팔: 총이 있는 자리·장전 동작은 그대로 두고, 캐릭터 모델의 팔이 총을 쥐고 따라간다 (2-본 IK).
//   팔 모델(AR)을 쓰지 않는 총 중 장전 클립이 있는 것에 쓴다. 팔마다 모델 복제 하나를 두고 반대쪽 팔은 접어 숨긴다.
//   아킴보의 왼손은 "오른팔을 좌우로 뒤집은 것" 이다 → 두 손이 같은 모양으로 쥐고, 손이 안쪽으로 가면 팔이 X 자로 교차한다.
import * as THREE from 'three';
import { fpAsset, makeInstance } from '../charassets.js';
import { reachGrip, elbowPole, curlHand, handCurl, driveTwist, palmToBore } from '../charik.js';
import { dress, setOutfit } from '../outfit.js';
import { outfit, onOutfitChange } from '../loadout.js';

const FWD = new THREE.Vector3(0, 0, -1);
const _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// side: 이 복제가 쓰는 팔. mirror: 결과를 좌우로 뒤집는다
function makeArm(parent, side, mirror = false) {
  const inst = makeInstance(fpAsset), root = inst.root, B = inst.bones;
  const mixer = new THREE.AnimationMixer(root); // 라이플 대기 자세를 한 번 입혀 손가락 모양을 잡는다
  mixer.clipAction(fpAsset.rifle.idle).play(); mixer.update(0);
  B.get(side === 'Right' ? 'LeftShoulder' : 'RightShoulder').scale.setScalar(1e-4);
  const list = [...B.values()], base = list.map(b => b.quaternion.clone());
  const fit = dress(inst, outfit.choice, { view: 'fp' }); onOutfitChange(c => setOutfit(fit, c));
  root.visible = false; parent.add(root);
  return {
    root,
    // pos·q: 손 그립이 가야 할 자리와 방향 (1인칭 장면 좌표)
    curl: {},
    // pos·q: 손 그립이 가야 할 자리와 방향, trigger: 검지만 따로 굽힘 (null = 다른 손가락처럼, 움직임으로 쥐었다 폈다)
    reach(pos, q, trigger = null) {
      const now = performance.now() / 1000, dt = Math.min(0.1, now - (this.t || now)); this.t = now;
      const c = trigger === null ? handCurl(this.curl, pos, dt, 0.75, 0.2) : 0.92;
      root.visible = true; root.scale.x = 1; root.position.set(0, 0, 0);
      for (let i = 0; i < list.length; i++) list[i].quaternion.copy(base[i]);
      if (mirror) { pos.x = -pos.x; q.set(q.x, -q.y, -q.z, q.w); }
      root.updateMatrixWorld(true);
      // 팔이 닿지 않으면 어깨째 그만큼 따라간다
      B.get(`${side}UpperArm`).getWorldPosition(_a); B.get(`${side}ForeArm`).getWorldPosition(_b);
      B.get(`${side}Hand`).getWorldPosition(_c); B.get(`Viewmodel${side}Grip`).getWorldPosition(_d);
      const reach = (_a.distanceTo(_b) + _b.distanceTo(_c)) * 0.94 + _c.distanceTo(_d) * 0.5, far = _a.distanceTo(pos);
      if (far > reach) { root.position.copy(pos).sub(_a).multiplyScalar((far - reach) / far); root.updateMatrixWorld(true); }
      reachGrip(side, B, `Viewmodel${side}Grip`, _m.compose(pos, q, _one), elbowPole(B, side, FWD));
      curlHand(B, side, c, trigger); driveTwist(B);
      if (mirror) { root.scale.x = -1; root.position.x = -root.position.x; }
      root.updateMatrixWorld(true);
    },
  };
}

export function createHands(parent) {
  if (!fpAsset || !fpAsset.rifle.idle) return null;
  const right = makeArm(parent, 'Right'), left = makeArm(parent, 'Left'), twin = makeArm(parent, 'Right', true);
  const p = new THREE.Vector3(), pq = new THREE.Quaternion();
  const quatOf = group => group.parent.getWorldQuaternion(pq).multiply(group.quaternion).clone(); // 좌우로 뒤집은 총도 회전은 이렇게
  const grip = g => p.set(0, g.gripY ?? -0.085, g.gripZ ?? 0).applyMatrix4(g.group.matrixWorld).clone();
  const hide = () => { right.root.visible = left.root.visible = twin.root.visible = false; };
  return {
    hide,
    // gun: 오른손 총, off: 왼손에 든 두 번째 총 (아킴보), moved: 왼손이 쉬는 자리에서 옮겨 간 만큼 (총 그룹 좌표)
    update(gun, off, moved) {
      gun.group.updateWorldMatrix(true, true);
      right.reach(grip(gun), quatOf(gun.group), 0.45);
      if (off) { off.group.updateWorldMatrix(true, true); left.root.visible = false; twin.reach(grip(off), quatOf(off.group), 0.45); return; }
      twin.root.visible = false;
      // 왼손 목표: 클립의 anim_hand_l (총 모양을 돌려도 손은 같이 돌지 않게 총 그룹 좌표로), 없으면 socket_hand_l
      if (gun.handTarget) p.copy(gun.handRest).multiplyScalar(gun.modelScale || 1).add(moved);
      else p.set(0, gun.supportY ?? -0.05, gun.supportZ ?? -0.2);
      const hq = palmToBore(quatOf(gun.group), p, gun.barrelY ?? 0); // 손바닥이 총열 쪽을 본다 (위에서 잡으면 덮고, 아래서 받치면 받친다)
      left.reach(p.applyMatrix4(gun.group.matrixWorld).clone(), hq);
    },
  };
}
