// 내 에임 반동 상태: 연사하면 시선이 올라가고(me.pitch·yaw — 다음 cmd 에 실려 서버 판정에도 반영), 일부는 화면 흔들림(kickP·kickY)으로만 남았다가 풀린다.
//   연출(소리·불빛·궤적)은 playerfx.js, 시뮬레이션·넷코드는 predict.js — 이 모듈은 반동 수치만 다룬다.
import { me, wp, PITCH_MAX } from './state.js';
import { DEG } from './util.js';

// 쏜 순간 (근접 포함): 연사 간격 기록
export function noteShot() { wp.sinceShot = 0; }

// 총을 쐈다 (히트스캔 무기): 반동은 연사할수록 커지고, 정조준·앉기면 줄어든다. 55% 는 시선에 남는다 (직접 눌러 줘야 한다)
export function applyRecoil(w) {
  const n = wp.burstN;
  if (n === 0) wp.burstSeed = Math.random() * Math.PI * 2;
  const ramp = w.auto ? 1 + Math.min(n, 10) * 0.07 : 1;
  const stance = (1 - 0.3 * wp.adsT) * (me.crouch ? 0.8 : 1) * (me.onGround ? 1 : 1.3);
  const rv = w.recoilV * DEG * stance * ramp * (0.9 + Math.random() * 0.2);
  me.pitch = Math.min(PITCH_MAX, me.pitch + rv * 0.55); wp.kickP += rv * 0.45;
  const drift = Math.sin(n * 0.55 + wp.burstSeed) * Math.min(1, n / 3);
  const rh = (drift * 0.75 + (Math.random() * 2 - 1) * 0.45) * w.recoilH * DEG * stance * ramp;
  me.yaw += rh * 0.6; wp.kickY += rh * 0.4;
  wp.burstN = n + 1;
}

// 매 프레임: 연사 누적과 화면 흔들림이 풀린다
export function updateRecoil(dt) {
  const w = me.lo[me.ps.cur].w;
  wp.sinceShot += dt;
  if (wp.sinceShot > Math.max(0.18, 96 / w.rpm)) wp.burstN = Math.max(0, wp.burstN - dt * 14);
  const rec = Math.exp(-dt * 9);
  wp.kickP *= rec; wp.kickY *= rec;
}

// 맞았다·밀렸다: 화면(시각)만 살짝 흔들린다. 시선(me.yaw·pitch)은 건드리지 않는다
export function flinch(pitch, yaw = 0) { wp.kickP += pitch; wp.kickY += yaw; }

export function resetRecoil() { wp.kickP = wp.kickY = 0; }
