// 무기 종류·기능별 1인칭 포즈 보정: 근접 휘두르기, 볼트·펌프 동작.
//   P = { p(위치), rx, ry, rz(회전) } 를 받아 고친다. 새 무기 동작은 여기에 함수를 더하고 APPLY 에 넣는다.
import { wp } from '../state.js';
import { smooth } from '../util.js';

// 근접 무기: 휘두르기 (오른쪽 위에서 왼쪽 아래로)
function meleeSwing(w, P) {
  if (w.kind !== 'melee' || wp.swing <= 0) return;
  const a = Math.sin(Math.PI * (1 - wp.swing));
  P.p.x -= a * 0.16; P.p.y += a * 0.05; P.p.z -= a * 0.12; P.ry += a * 0.9; P.rz -= a * 0.7; P.rx -= a * 0.3;
}
// 볼트 / 펌프 동작 (k = 정조준 정도: 조준 중에는 덜 움직인다)
function boltPump(w, P, k) {
  if (!(w.bolt || w.shell) || wp.cooldown <= 0 || wp.reload) return;
  const c = 1 - wp.cooldown / (60 / w.rpm);
  const a = Math.sin(Math.PI * smooth(0.25, 0.85, c));
  P.rz += a * 0.22 * (1 - 0.6 * k); P.p.y -= a * 0.02 * (1 - 0.6 * k); P.rx -= a * 0.05;
}
const APPLY = [meleeSwing, boltPump];
export const applyWeaponPose = (w, P, k) => { for (const f of APPLY) f(w, P, k); };
