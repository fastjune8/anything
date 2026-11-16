// 내 캐릭터 이동: 키 입력 → 이동 물리(shared/movement.js) → 소리·화면 흔들림.
// 물리는 서버와 같이 쓸 수 있게 shared/ 의 순수 함수에 있고, 여기는 입력을 모으고 사건(착지·넘어가기·발소리)을 연출한다.
import { advanceMovement, NO_INPUT } from '/shared/movement.js';
import { colliders } from './scene.js';
import { sfx } from './sfx.js';
import { me, wp, inp, game, eff, adsInput } from './state.js';

// 지금 누르고 있는 키 → 이동 입력
function readInput(can) {
  if (!can) return NO_INPUT;
  const k = inp.keys, w = eff[wp.cur];
  return {
    fwd: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
    side: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
    jump: k.has('Space'), crouch: k.has('KeyC'),
    sprint: k.has('ShiftLeft') && !adsInput() && !inp.fireHeld && !wp.reload,
    leanL: k.has('KeyQ'), leanR: k.has('KeyE'),
    speedMul: w.move * (1 - 0.4 * wp.adsT), // 무거운 총·정조준 중에는 느리게
  };
}

// dt: 실제로 흐른 시간 (화면이 느려도 그대로 넘긴다. 물리는 1/60초 이하로 나눠 계산한다)
export function updateMovement(dt, active) {
  const can = active && me.alive && game.matchState !== 'ended';
  const ev = advanceMovement(me, readInput(can), colliders, dt);
  wp.sprinting = ev.sprinting;
  if (ev.vaultStart) { wp.reload = null; sfx.step(0.8); } // 손을 짚어야 하므로 재장전은 끊긴다
  if (ev.vaultDone) sfx.land(0.45);
  if (ev.landed) sfx.land(ev.landed);
  if (ev.moved > 0.0005) { // 걸음: 화면 흔들림과 발소리
    wp.stepDist += ev.moved; wp.bobPhase += ev.moved * (wp.sprinting ? 2.6 : 3.1);
    if (wp.stepDist > (wp.sprinting ? 2.5 : me.crouch ? 1.6 : 2.0)) { wp.stepDist = 0; sfx.step(me.crouch ? 0.35 : wp.sprinting ? 1 : 0.7); }
  }
}
