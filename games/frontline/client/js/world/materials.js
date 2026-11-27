// 재질 프리셋(물성 묶음)과, 색 텍스처에서 Normal·Roughness/Metalness 맵을 뽑는 계산 (P3-2).
import * as THREE from 'three';

// 재질 이름 → 물성 묶음. 색 텍스처(무늬)에서 높이를 뽑아 Normal 맵, 때·얼룩에서 Roughness 맵을 만든다 (텍스처 파일 없음).
//   nrm: 노멀 세기 배율 (looks 의 bump 에 곱한다)  rv: 거칠기 흔들림 (어두운 때 = 더 거침)
//   env: 주변광(PMREM) 배율 — 반사뿐 아니라 그늘 밝기도 같이 바뀌므로 1 근처에서만 조금씩
//   scratch: 칠이 벗겨진 곳(밝은 점)에 금속성을 얹는 양  blur: 높이 흐림 횟수 (잔 점 노이즈가 반짝이지 않게)
export const MAT_PRESETS = {
  concrete:     { nrm: 2.2, rv: 0.25, env: 0.9, blur: 2 },
  metal:        { nrm: 1.4, rv: 0.45, env: 1.15, blur: 1 },
  paintedMetal: { nrm: 1.6, rv: 0.35, env: 1.0, blur: 1, scratch: 0.5 },
  wood:         { nrm: 2.0, rv: 0.2, env: 0.85, blur: 1 },
  fabric:       { nrm: 2.6, rv: 0.1, env: 0.75, blur: 1 },
  glass:        { env: 1.3 },
  plastic:      { nrm: 1.4, rv: 0.2, env: 0.95, blur: 1 },
  ground:       { nrm: 1.8, rv: 0.08, env: 0.8, blur: 2 },
};
// 재질 이름별 기본 프리셋 (looks.json 재질의 preset 으로 바꿀 수 있다). glb 재질은 이름으로 고른다
const PRESET_OF = {
  ground: 'ground', concrete: 'concrete', concreteDark: 'concrete', brick: 'concrete', container: 'paintedMetal',
  crate: 'plastic', wood: 'wood', sandbag: 'fabric', metal: 'metal', barrel: 'paintedMetal',
  BareMetal: 'metal', Concrete: 'concrete', PaintedMetal: 'paintedMetal', Wood: 'wood', Glass: 'glass',
};
export const presetOf = (name, d) => MAT_PRESETS[(d && d.preset) || PRESET_OF[name]] || MAT_PRESETS.concrete;

// 색 캔버스 → { normal, orm } (orm: G = 거칠기, B = 금속성. glTF 와 같은 묶음이라 roughnessMap·metalnessMap 이 같이 쓴다)
export function derivedMaps(src, d, P, maxAniso) {
  const S = src.width, px = src.getContext('2d').getImageData(0, 0, S, S).data;
  let H = new Float32Array(S * S), T = new Float32Array(S * S);
  let mean = 0;
  for (let i = 0; i < S * S; i++) { H[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; mean += H[i]; }
  mean /= S * S;
  const lum = Float32Array.from(H);
  const m = S - 1;
  for (let k = 0; k < (P.blur || 0); k++) { // 3×3 상자 흐림 (이어 붙는 가장자리)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let a = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += H[((y + dy) & m) * S + ((x + dx) & m)];
      T[y * S + x] = a / 9;
    }
    [H, T] = [T, H];
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const nc = mk(), oc = mk(), ng = nc.getContext('2d'), og = oc.getContext('2d');
  const nd = ng.createImageData(S, S), od = og.createImageData(S, S);
  const K = 6, rough = d.rough ?? 0.8, metal = d.metal || 0, rv = P.rv || 0, scr = P.scratch || 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    // canvas 는 flipY 로 올라가므로 위쪽 줄(y-1)이 +v. 어두운 곳 = 낮은 곳 (이음새·홈)
    const du = (H[y * S + ((x + 1) & m)] - H[y * S + ((x - 1) & m)]) * 0.5 * K;
    const dv = (H[((y - 1) & m) * S + x] - H[((y + 1) & m) * S + x]) * 0.5 * K;
    const inv = 1 / Math.hypot(du, dv, 1);
    nd.data[i * 4] = (-du * inv * 0.5 + 0.5) * 255; nd.data[i * 4 + 1] = (-dv * inv * 0.5 + 0.5) * 255; nd.data[i * 4 + 2] = (inv * 0.5 + 0.5) * 255; nd.data[i * 4 + 3] = 255;
    const dl = lum[i] - mean; // + 밝은 곳, − 때·홈
    const r = Math.min(1, Math.max(0.04, rough - dl * rv * 2));
    const met = Math.min(1, Math.max(0, metal + (scr && dl > 0.12 ? scr * Math.min(1, (dl - 0.12) * 8) : 0)));
    od.data[i * 4] = 255; od.data[i * 4 + 1] = r * 255; od.data[i * 4 + 2] = met * 255; od.data[i * 4 + 3] = 255;
  }
  ng.putImageData(nd, 0, 0); og.putImageData(od, 0, 0);
  const tex = c => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = maxAniso; return t; };
  return { normal: tex(nc), orm: tex(oc) };
}
