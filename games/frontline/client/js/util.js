// 작은 수학/DOM 도우미와 공용 상수
import * as THREE from 'three';
import { MODES, DEFAULT_MODE } from '/shared/modes.js';

export const $ = id => document.getElementById(id);
export const V3 = THREE.Vector3;
export const DEG = Math.PI / 180;
export const UP = new V3(0, 1, 0);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// 각도를 가장 짧은 방향으로 보간
export const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const params = new URLSearchParams(location.search);
export const NOLOCK = params.has('nolock'); // 테스트용: 포인터 락 없이 진행
export const EMBED = params.has('embed');   // 스튜디오 안에서 시험 플레이 중 (Ctrl/⌘+P 또는 로비로 나가기 = 스튜디오로 돌아감)
export const START_AT = (params.get('at') || '').split(',').map(Number).filter(Number.isFinite); // 스튜디오: 처음 태어날 위치 [x, z]
export const BASE_FOV = 74;

// 현재 선택된(또는 들어가 있는) 모드. 로비에서 고르거나 방에 들어갈 때 setMode 로 바뀌고, 다른 모듈은 MODE_CFG 를 그대로 읽으면 된다.
const wanted = params.get('mode') || localStorage.getItem('fd_mode');
export const MODE_CFG = { ...MODES[wanted && Object.hasOwn(MODES, wanted) ? wanted : DEFAULT_MODE] };
export function setMode(id) {
  if (!Object.hasOwn(MODES, id)) return;
  Object.assign(MODE_CFG, MODES[id]);
  localStorage.setItem('fd_mode', id);
}
