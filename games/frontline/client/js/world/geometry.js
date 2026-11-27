// 맵 물체 모양 도우미: 경사로(쐐기)와 상자 지오메트리 (면마다 따로 — 각진 그림자).
import * as THREE from 'three';

// 경사로(쐐기): 박스 크기 안에서 ramp.up 쪽이 높은 모양. 면마다 따로 (각진 그림자)
export function rampGeo(w, h, d, ramp, tile) {
  const along = ramp.axis === 'x' ? w : d, across = ramp.axis === 'x' ? d : w;
  const a = along / 2, c = across / 2, y0 = -h / 2, y1 = h / 2;
  // x+ 쪽이 높은 쐐기를 만든 뒤 돌린다
  const P = { A: [-a, y0, -c], B: [a, y0, -c], C: [a, y0, c], D: [-a, y0, c], E: [a, y1, -c], F: [a, y1, c] };
  const faces = [['A', 'B', 'C'], ['A', 'C', 'D'], ['B', 'E', 'F'], ['B', 'F', 'C'], ['A', 'D', 'F'], ['A', 'F', 'E'], ['A', 'E', 'B'], ['D', 'C', 'F']];
  const pos = [], uv = [], t = tile || 2;
  for (const f of faces) for (const k of f) { const p = P[k]; pos.push(...p); uv.push((p[0] + p[1]) / t, p[2] / t); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const turn = ramp.axis === 'x' ? (ramp.up > 0 ? 0 : Math.PI) : (ramp.up > 0 ? -Math.PI / 2 : Math.PI / 2);
  if (turn) g.rotateY(turn);
  return g;
}

export function boxGeo(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile);
    }
  }
  return g;
}
