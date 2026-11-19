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
  return gun;
}

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
export function poseClip(gun, name, f) {
  const a = clipAction(gun, name);
  if (!a) return false;
  for (const other of Object.values(gun.actions)) if (other && other !== a) other.weight = 0;
  a.weight = 1; a.time = Math.max(0, Math.min(1, f)) * a.getClip().duration; gun.mixer.update(0);
  if (gun.armL && gun.handTarget) gun.armL.position.subVectors(gun.handTarget.position, gun.handRest).multiplyScalar(gun.modelScale || 1); // 모델 안 좌표 → 총 그룹 좌표 (guns.js WEAPON_SCALE)
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
