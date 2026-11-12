// 작은 수학/DOM 도우미와 공용 상수
import * as THREE from 'three';

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
export const BASE_FOV = 74;
