// 총 동작 (게임 1인칭 · 스튜디오 모델 에디터가 같이 쓴다 → 에디터에서 본 그대로 게임에 나온다)
//   1) 모션 클립: Blender 에서 만든 클립(재장전 등, docs/GUN_MODELING.md 11)을 진행도(0~1)로 맞춘다. 왼팔은 anim_hand_l 을 따라간다
//   2) 총 전체의 움직임: 재장전 때 총을 기울였다 되돌리는 코드 동작 (클립에는 넣지 않는다)
import * as THREE from 'three';

// 총 객체에 모션 클립을 붙인다 (guns.js buildFromModel · 모델 에디터). root = 클립의 대상들이 들어 있는 물체
export function attachClips(gun, root, clips, armL) {
  gun.animRoot = root; gun.clips = clips || []; gun.armL = armL || null; gun.actions = {};
  gun.handTarget = null;
  root.traverse(o => { if (!gun.handTarget && /^anim_hand_l/i.test(o.name)) gun.handTarget = o; });
  gun.handRest = gun.handTarget ? gun.handTarget.position.clone() : null;
  gun.whole = restOf(root, /^anim_gun/i);  // 총 전체(팔 포함)의 움직임
  gun.spin = restOf(root, /^anim_spin/i);  // 총 모양만 돌리기 (팔은 그대로)
  gun.cover = restOf(root, /^part_cover/i); // 급탄 덮개 (그 위의 조준경이 따라간다)
  return gun;
}

function restOf(root, re) {
  let node = null; root.traverse(o => { if (!node && re.test(o.name)) node = o; });
  return node && { node, p: node.position.clone(), inv: node.quaternion.clone().invert() };
}
// 총이 크게 돌아가도 왼팔은 화면에서 방향을 지킨다 (손 자리만 따라간다). 같이 돌면 팔이 눈앞을 가린다
const _hand = new THREE.Vector3(), _tilt = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0);
function steadyArm(gun, turning) {
  const arm = gun.armL;
  if (!turning) { arm.quaternion.identity(); return; }
  arm.quaternion.copy(gun.motion.q).invert();
  if (gun.pistol) { // 권총은 손이 총에 겹치므로 팔을 아래에서 올라오게 눕힌다
    const k = Math.min(1, 2 * Math.acos(Math.min(1, Math.abs(gun.motion.q.w))) / 0.4);
    arm.quaternion.multiply(_tilt.setFromAxisAngle(_x, 0.6 * k));
  }
  _hand.set(0, gun.supportY ?? -0.07, gun.supportZ ?? -0.2);
  arm.position.add(_hand).sub(_hand.applyQuaternion(arm.quaternion));
}

// 총 모양을 돌려도(anim_spin) 빠져 있는 탄창은 같이 돌지 않는다 (제자리에서 벗어나 있으면 빠진 것으로 본다)
function keepLoose(gun) {
  const m = gun.mag;
  if (!m || !gun.magRest || m.parent !== gun.animRoot || m.position.distanceTo(gun.magRest) < 0.003) return;
  const k = gun.loose || (gun.loose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), on: false });
  k.p.copy(m.position); k.q.copy(m.quaternion); k.on = true;
  const root = gun.animRoot, s = root.scale.x || 1;
  _inv.copy(root.quaternion).invert();
  m.position.multiplyScalar(s).add(gun.spinRest.root).sub(root.position).applyQuaternion(_inv).divideScalar(s);
  m.quaternion.premultiply(_inv);
}
function restoreLoose(gun) {
  const k = gun.loose;
  if (k && k.on) { gun.mag.position.copy(k.p); gun.mag.quaternion.copy(k.q); k.on = false; }
}
const _inv = new THREE.Quaternion(), _grip = new THREE.Vector3();

// anim_spin: 쥔 손(그립)을 축으로 총 모양(모델·부착 파츠)만 돌린다 → 돌리는 동안에도 총이 손에서 떨어지지 않는다
function spinGun(gun) {
  const root = gun.animRoot, att = gun.att;
  if (!gun.spinRest) gun.spinRest = { root: root.position.clone(), att: att ? att.position.clone() : null };
  root.quaternion.multiplyQuaternions(gun.spin.node.quaternion, gun.spin.inv);
  _grip.set(0, gun.gripY ?? -0.085, gun.gripZ ?? 0);
  root.position.copy(gun.spinRest.root).sub(_grip).applyQuaternion(root.quaternion).add(_grip);
  if (att) { att.quaternion.copy(root.quaternion); att.position.copy(gun.spinRest.att).sub(_grip).applyQuaternion(root.quaternion).add(_grip); }
  keepLoose(gun);
}

// 급탄 덮개에 단 조준경 파츠를 덮개의 경첩 둘레로 같이 움직인다
function followCover(gun) {
  const { node, p, inv } = gun.cover, o = gun.opticGroup, s = gun.modelScale || 1;
  o.quaternion.multiplyQuaternions(node.quaternion, inv);
  o.position.copy(o.userData.base).addScaledVector(p, -s).applyQuaternion(o.quaternion).addScaledVector(node.position, s);
}
export const hasClip = (gun, name) => !!clipAction(gun, name);

// 이름으로 클립 동작 (없으면 null). 시간은 poseClip 이 직접 맞춘다
export function clipAction(gun, name) {
  if (!gun.actions) gun.actions = {};
  if (gun.actions[name] !== undefined) return gun.actions[name];
  const clip = (gun.clips || []).find(c => c.name === name);
  if (!clip || !gun.animRoot) return (gun.actions[name] = null);
  if (!gun.mixer) gun.mixer = new THREE.AnimationMixer(gun.animRoot);
  const a = gun.mixer.clipAction(clip); a.play(); a.paused = true;
  return (gun.actions[name] = a);
}

// 클립의 f(0~1) 지점 자세로 맞추고, 왼팔이 왼손 목표(anim_hand_l)를 따라가게 한다. 반환: 클립이 있었는가
//   anim_gun 이 있으면 그 움직임을 총 그룹에 준다 (whole = false 면 gun.motion 에만 남기고 부르는 쪽이 적용).
//   anim_spin 이 있으면 그 회전을 총 모양(모델·부착 파츠)에만 준다
export function poseClip(gun, name, f, whole = true) {
  const a = clipAction(gun, name);
  if (!a) return false;
  for (const other of Object.values(gun.actions)) if (other && other !== a) other.weight = 0;
  restoreLoose(gun); // 지난 장면에서 회전을 상쇄한 탄창은 믹서 값으로 되돌린 뒤 다시 계산한다
  a.weight = 1; a.time = Math.max(0, Math.min(1, f)) * a.getClip().duration; gun.mixer.update(0);
  if (gun.armL && gun.handTarget) gun.armL.position.subVectors(gun.handTarget.position, gun.handRest).multiplyScalar(gun.modelScale || 1); // 모델 안 좌표 → 총 그룹 좌표 (guns.js WEAPON_SCALE)
  const w = gun.whole;
  if (w) {
    const m = gun.motion || (gun.motion = { p: new THREE.Vector3(), q: new THREE.Quaternion() });
    m.p.subVectors(w.node.position, w.p).multiplyScalar(gun.modelScale || 1);
    m.q.multiplyQuaternions(w.node.quaternion, w.inv);
    if (whole && gun.group) { gun.group.position.copy(m.p); gun.group.quaternion.copy(m.q); }
  }
  if (gun.armL) steadyArm(gun, whole && w);
  if (gun.cover && gun.opticGroup) followCover(gun);
  if (gun.spin) spinGun(gun);
  return true;
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 재장전 때 총 전체의 움직임 (진행도 f 0~1). shell = 산탄총 한 발씩 장전, first = 그중 첫 발
// 반환: { x, y, z, rx, ry, rz, magDrop } — 위치(m)·회전(rad) 더할 값, magDrop = 클립이 없는 총의 탄창 내림 정도(0~1)
export function reloadMotion(f, shell = false, first = true) {
  let down, magDrop = 0, z = 0, rz = 0;
  if (shell) {
    down = first ? smooth(0, 0.8, f) : 1;
    z = Math.sin(Math.PI * f) * 0.015 * (first ? 0 : 1);
  } else {
    down = smooth(0, 0.14, f) * (1 - smooth(0.86, 1, f));
    magDrop = smooth(0.15, 0.28, f) * (1 - smooth(0.5, 0.62, f));
    rz = Math.sin(f * Math.PI * 3) * 0.05 * down;
  }
  return { x: -0.03 * down, y: -0.075 * down, z, rx: 0.32 * down, ry: 0.15 * down, rz: rz + 0.42 * down, magDrop };
}
