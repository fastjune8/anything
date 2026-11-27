// 자동 화질 조절. 느린 기기(약한 GPU·GPU 가속이 꺼진 브라우저)에서 프레임이 10fps 아래로 내려가면
//   마우스를 돌릴 때 프레임 하나에 수십 도씩 돌아가 "시점이 튀는" 것처럼 보인다 (3fps 에서 3rad/s 회전 = 프레임당 약 60°).
//   그래서 프레임 시간을 재다가 느리면 해상도(픽셀 비율)를 단계적으로 낮추고, 그래도 느리면 그림자를 끈다.
//   빠른 기기는 평균 프레임이 기준(SLOW_MS)을 넘지 않아 아무 일도 일어나지 않는다. 한 번 낮춘 화질은 새로고침 전까지 올리지 않는다 (오르내림 반복 방지).
import { renderer, scene, vmScene } from './scene.js';

const BASE = Math.min(devicePixelRatio, 2);
const MIN_RATIO = 0.5;
const SLOW_MS = 24;        // 평균 프레임이 이보다 길면(≈ 42fps 미만) 낮춘다
const VERY_SLOW_MS = 40;   // 해상도를 최저로 낮춰도 이보다 느리면 그림자를 끈다 (25fps 미만)
const WINDOW = 90;         // 프레임 수 (60fps 기준 1.5초)
const WARMUP_MS = 5000;    // 맵·셰이더 컴파일로 느린 처음 몇 초는 재지 않는다
const SKIP_MS = 250;       // 이보다 긴 프레임(탭 전환·로딩)은 평균에서 뺀다

export const quality = { ratio: BASE, shadows: true, steps: 0, software: false, gpu: '' };

// 소프트웨어 렌더링(GPU 가속 없음)은 처음부터 낮게 시작한다
try {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  quality.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  quality.software = /swiftshader|llvmpipe|software|basic render|softpipe/i.test(quality.gpu);
} catch { /* 알 수 없으면 일반 기기로 본다 */ }

function setRatio(r) { quality.ratio = r; renderer.setPixelRatio(r); }
function shadowsOff() {
  quality.shadows = false; renderer.shadowMap.enabled = false;
  for (const root of [scene, vmScene]) root.traverse(o => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; }); // 그림자 없는 셰이더로 다시 컴파일 (한 번)
}
if (quality.software) {
  setRatio(MIN_RATIO); shadowsOff(); quality.steps = 2;
  // GPU 가속이 꺼진 브라우저에서는 어떤 화질이어도 플레이가 어렵다 → 원인을 바로 알려 준다
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:8px 12px;background:#b3261e;color:#fff;font:13px/1.4 sans-serif;text-align:center;cursor:pointer';
  b.textContent = '⚠ 이 브라우저는 그래픽 가속(GPU)을 쓰지 못해 게임이 매우 느립니다. Chrome 설정 → 시스템 → "가능한 경우 그래픽 가속 사용"을 켜고 다시 시작하세요. (클릭하면 닫힘)';
  b.onclick = () => b.remove();
  document.body.appendChild(b);
}

// Intel 내장 그래픽(노트북): 고해상도 화면(Windows 배율 150~200% → 픽셀 비율 2)에서 화면의 4배 픽셀을 그리면 20~30fps 대로 떨어진다 → 처음부터 1.25 로 시작하고, 부족하면 아래 자동 조절이 더 낮춘다
const INTEL_START = 1.25;
if (!quality.software && /intel/i.test(quality.gpu) && quality.ratio > INTEL_START) { setRatio(INTEL_START); quality.steps = 1; }

let acc = 0, n = 0, since = 0, lastAvg = 0, lastRatio = quality.ratio, locked = false;
// 매 프레임 main.js 에서: ms = 이번 프레임이 걸린 시간, playing = 경기 화면인가
export function adaptQuality(ms, playing) {
  if (!playing) { since = 0; acc = n = 0; return; }
  since += ms;
  if (since < WARMUP_MS || ms > SKIP_MS) return;
  acc += ms; n++;
  if (n < WINDOW) return;
  const avg = acc / n; acc = n = 0;
  if (avg <= SLOW_MS || locked) return;
  // 직전에 해상도를 낮췄는데도 프레임이 10% 도 안 나아졌으면 병목은 GPU 해상도가 아니다(CPU 등) → 화질만 손해이므로 되돌리고 멈춘다
  if (lastAvg && quality.ratio < lastRatio && avg > lastAvg * 0.9) { setRatio(lastRatio); quality.steps--; locked = true; console.info(`[quality] 해상도를 낮춰도 나아지지 않아 ${lastRatio} 로 되돌림 (병목이 해상도가 아님)`); return; }
  lastAvg = avg; lastRatio = quality.ratio;
  if (quality.ratio > MIN_RATIO + 0.01) { setRatio(Math.max(MIN_RATIO, +(quality.ratio * 0.75).toFixed(2))); quality.steps++; console.info(`[quality] 평균 ${avg.toFixed(0)}ms/프레임 → 해상도 ${quality.ratio}`); }
  else if (quality.shadows && avg > VERY_SLOW_MS) { shadowsOff(); quality.steps++; console.info(`[quality] 평균 ${avg.toFixed(0)}ms/프레임 → 그림자 끔`); }
}
