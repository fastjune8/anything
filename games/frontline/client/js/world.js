import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// ───────── 절차적 텍스처 ─────────
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(size, draw, maxAniso) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

function speckle(g, S, r, n, colors, minR, maxR, alpha) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.3 + r() * 0.7);
    g.fillStyle = colors[(r() * colors.length) | 0];
    const s = minR + r() * (maxR - minR);
    g.fillRect(r() * S, r() * S, s, s);
  }
  g.globalAlpha = 1;
}

function blotches(g, S, r, n, colors, minR, maxR, alpha) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rad = minR + r() * (maxR - minR);
    const col = colors[(r() * colors.length) | 0];
    // 타일 경계에서 이어지도록 9방향 반복
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox + rad < 0 || x + ox - rad > S || y + oy + rad < 0 || y + oy - rad > S) continue;
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = alpha; g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  g.globalAlpha = 1;
}

const TEX = {
  ground(g, S) {
    const r = rng(7);
    g.fillStyle = '#6b6048'; g.fillRect(0, 0, S, S);
    blotches(g, S, r, 60, ['#4f5a32', '#5a6338', '#465029'], 40, 150, 0.55);
    blotches(g, S, r, 40, ['#7d6f55', '#84775c', '#5d533f'], 30, 110, 0.5);
    speckle(g, S, r, 14000, ['#3d3a2a', '#8c8168', '#4a5230', '#9a917c', '#2f3320'], 1, 3, 0.5);
    speckle(g, S, r, 500, ['#a39a86', '#55503f'], 2, 5, 0.6);
  },
  concrete(g, S) {
    const r = rng(11);
    g.fillStyle = '#8f8d87'; g.fillRect(0, 0, S, S);
    blotches(g, S, r, 30, ['#7a7872', '#a09e97', '#6e6c66'], 40, 140, 0.35);
    speckle(g, S, r, 9000, ['#6d6b66', '#a8a6a0', '#59574f'], 1, 2.5, 0.4);
    g.strokeStyle = 'rgba(40,38,34,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 50; y += r() * 40; g.lineTo(x, y); }
      g.stroke();
    }
    // 흘러내린 얼룩
    for (let i = 0; i < 14; i++) {
      const x = r() * S, h = 60 + r() * 200, w = 4 + r() * 14;
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(45,42,36,0.28)'); gr.addColorStop(1, 'rgba(45,42,36,0)');
      g.fillStyle = gr; g.fillRect(x, 0, w, h);
    }
  },
  concreteDark(g, S) {
    const r = rng(13);
    g.fillStyle = '#5c5b58'; g.fillRect(0, 0, S, S);
    blotches(g, S, r, 30, ['#4a4946', '#6a6965'], 40, 140, 0.4);
    speckle(g, S, r, 8000, ['#44433f', '#75746f'], 1, 2.5, 0.4);
  },
  brick(g, S) {
    const r = rng(17);
    g.fillStyle = '#8d8676'; g.fillRect(0, 0, S, S);
    const rows = 16, cols = 4, bh = S / rows, bw = S / cols;
    const cols3 = ['#8a4a36', '#7c3f2e', '#96553f', '#6f3a2c', '#a05e45', '#84503e'];
    for (let y = 0; y < rows; y++) for (let x = -1; x < cols; x++) {
      const ox = (y % 2) * bw / 2;
      g.fillStyle = cols3[(r() * cols3.length) | 0];
      g.fillRect(x * bw + ox + 2, y * bh + 2, bw - 4, bh - 4);
    }
    speckle(g, S, r, 9000, ['#5a3024', '#b0705a', '#3d2a22', '#9a9384'], 1, 3, 0.3);
    blotches(g, S, r, 14, ['#2e2a25'], 40, 120, 0.3);
  },
  container(g, S) {
    const r = rng(19);
    const n = 16, w = S / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      gr.addColorStop(0, '#9c9c9c'); gr.addColorStop(0.25, '#f2f2f2');
      gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(0.75, '#c8c8c8'); gr.addColorStop(1, '#8a8a8a');
      g.fillStyle = gr; g.fillRect(i * w, 0, w + 1, S);
    }
    blotches(g, S, r, 12, ['#6b4a35', '#54402f'], 15, 50, 0.2);
    speckle(g, S, r, 3000, ['#7a5a40', '#d8d8d8', '#555'], 1, 3, 0.3);
    for (let i = 0; i < 20; i++) {
      const x = r() * S, y = r() * S * 0.6, h = 40 + r() * 160;
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, 'rgba(90,60,40,0.35)'); gr.addColorStop(1, 'rgba(90,60,40,0)');
      g.fillStyle = gr; g.fillRect(x, y, 3 + r() * 6, h);
    }
  },
  crate(g, S) {
    const r = rng(23);
    g.fillStyle = '#8a6a42'; g.fillRect(0, 0, S, S);
    const planks = 6, pw = S / planks;
    for (let i = 0; i < planks; i++) {
      g.fillStyle = ['#8f6f46', '#7f623d', '#96764c', '#866841'][(r() * 4) | 0];
      g.fillRect(i * pw + 1, 0, pw - 2, S);
      g.strokeStyle = 'rgba(50,34,18,0.35)'; g.lineWidth = 1;
      for (let k = 0; k < 9; k++) {
        const x = i * pw + r() * pw; g.beginPath(); g.moveTo(x, 0);
        g.bezierCurveTo(x + (r() - 0.5) * 12, S * 0.3, x + (r() - 0.5) * 12, S * 0.6, x + (r() - 0.5) * 8, S); g.stroke();
      }
    }
    const f = S * 0.11;
    g.fillStyle = '#6f5432';
    g.fillRect(0, 0, S, f); g.fillRect(0, S - f, S, f); g.fillRect(0, 0, f, S); g.fillRect(S - f, 0, f, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(Math.PI / 4); g.fillRect(-S * 0.7, -f / 2, S * 1.4, f); g.restore();
    g.strokeStyle = 'rgba(30,20,10,0.6)'; g.lineWidth = 2;
    g.strokeRect(f, f, S - 2 * f, S - 2 * f); g.strokeRect(1, 1, S - 2, S - 2);
    speckle(g, S, r, 3000, ['#4d3a22', '#a98a5c'], 1, 2.5, 0.3);
  },
  wood(g, S) {
    const r = rng(29);
    g.fillStyle = '#6e563a'; g.fillRect(0, 0, S, S);
    const planks = 8, pw = S / planks;
    for (let i = 0; i < planks; i++) {
      g.fillStyle = ['#70583b', '#644d33', '#7a6042', '#5c472f'][(r() * 4) | 0];
      g.fillRect(0, i * pw + 1, S, pw - 2);
      g.strokeStyle = 'rgba(35,24,12,0.35)';
      for (let k = 0; k < 6; k++) { const y = i * pw + r() * pw; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 6); g.stroke(); }
    }
    speckle(g, S, r, 3000, ['#3f2f1d', '#8d7350'], 1, 2.5, 0.3);
  },
  sandbag(g, S) {
    const r = rng(31);
    g.fillStyle = '#4c4533'; g.fillRect(0, 0, S, S);
    const rows = 3, cols = 2, bh = S / rows, bw = S / cols;
    for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) {
      const ox = (y % 2) * bw / 2, X = x * bw + ox + 4, Y = y * bh + 4, W = bw - 8, H = bh - 8;
      const gr = g.createLinearGradient(0, Y, 0, Y + H);
      gr.addColorStop(0, '#b3a47c'); gr.addColorStop(0.5, '#9c8d68'); gr.addColorStop(1, '#6f6449');
      g.fillStyle = gr; g.beginPath(); g.roundRect(X, Y, W, H, H * 0.45); g.fill();
    }
    speckle(g, S, r, 12000, ['#7d7153', '#c2b48d', '#5e553e'], 1, 2, 0.35);
  },
  metal(g, S) {
    const r = rng(37);
    g.fillStyle = '#5a5f63'; g.fillRect(0, 0, S, S);
    blotches(g, S, r, 30, ['#6e4a33', '#474c50', '#70767b'], 20, 90, 0.35);
    speckle(g, S, r, 5000, ['#3c4043', '#80868b', '#6b4c38'], 1, 2.5, 0.35);
  },
  barrel(g, S) {
    const r = rng(41);
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, S, S);
    for (const y of [0.02, 0.33, 0.66, 0.96]) {
      const gr = g.createLinearGradient(0, y * S - 8, 0, y * S + 8);
      gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#777');
      g.fillStyle = gr; g.fillRect(0, y * S - 8, S, 16);
    }
    blotches(g, S, r, 24, ['#6b4a35', '#3b3028'], 15, 70, 0.45);
    speckle(g, S, r, 3000, ['#7a5a40', '#444'], 1, 3, 0.3);
  },
};

// ───────── 색으로 그리는 무늬 (분위기의 재질 style). m = 재질 정의 (content/looks.json) ─────────
// 밝은 근미래 톤: 칠한 면 + 이음새 + 옅은 때. 색은 데이터에서, 모양은 여기서
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function shade(hex, f) { // f > 0 밝게, f < 0 어둡게 (-1 ~ 1)
  const c = hexRgb(hex || '#888888').map(v => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function grime(g, S, r, amt, base) { // 위에서 흘러내린 옅은 때 + 모서리 닳음
  if (!amt) return;
  for (let i = 0; i < 10; i++) {
    const x = r() * S, h = S * (0.15 + r() * 0.5), w = 6 + r() * 24;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, `rgba(40,36,30,${0.22 * amt})`); gr.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = gr; g.fillRect(x, 0, w, h);
  }
  speckle(g, S, r, 2500 * amt, [shade(base, -0.25), shade(base, 0.2)], 1, 2.5, 0.35);
}
const STYLE = {
  plain(g, S, m, r) {
    g.fillStyle = m.base; g.fillRect(0, 0, S, S);
    speckle(g, S, r, 4000, [shade(m.base, -0.06), shade(m.base, 0.06)], 1, 2, 0.4);
    grime(g, S, r, m.grime ?? 0.2, m.base);
  },
  panel(g, S, m, r) {
    const n = m.cells || 2, c = S / n, line = m.line || shade(m.base, -0.3);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) { // 칸마다 아주 살짝 다른 색
      g.fillStyle = shade(m.base, (r() - 0.5) * 0.06); g.fillRect(i * c, k * c, c, c);
    }
    blotches(g, S, r, 18, [shade(m.base, -0.05), shade(m.base, 0.05)], 30, 120, 0.3);
    if (m.trim) { // 아래 띠 (경고색 등)
      g.fillStyle = m.trim; for (let k = 0; k < n; k++) g.fillRect(0, (k + 1) * c - c * 0.1, S, c * 0.07);
    }
    grime(g, S, r, m.grime ?? 0.25, m.base);
    for (let i = 0; i <= n; i++) { // 이음새: 어두운 홈 + 밝은 가장자리
      g.fillStyle = line; g.fillRect(i * c - 2, 0, 4, S); g.fillRect(0, i * c - 2, S, 4);
      g.fillStyle = shade(m.base, 0.25); g.fillRect(i * c + 2, 0, 1.5, S); g.fillRect(0, i * c + 2, S, 1.5);
    }
    g.fillStyle = line; // 귀퉁이 볼트
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) for (const [ox, oy] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) {
      g.beginPath(); g.arc(i * c + ox * c, k * c + oy * c, 3, 0, Math.PI * 2); g.fill();
    }
  },
  blocks(g, S, m, r) {
    const rows = m.rows || 4, cols = m.cols || 2, bh = S / rows, bw = S / cols;
    g.fillStyle = m.line || shade(m.base, -0.35); g.fillRect(0, 0, S, S);
    for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) {
      const ox = (y % 2) * bw / 2, X = x * bw + ox + 3, Y = y * bh + 3, W = bw - 6, H = bh - 6;
      g.fillStyle = shade(m.base, (r() - 0.5) * 0.12); g.fillRect(X, Y, W, H);
      g.fillStyle = shade(m.base, 0.18); g.fillRect(X, Y, W, 2);
      g.fillStyle = shade(m.base, -0.15); g.fillRect(X, Y + H - 2, W, 2);
    }
    grime(g, S, r, m.grime ?? 0.2, m.base);
  },
  corrugated(g, S, m, r) {
    const n = 16, w = S / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      gr.addColorStop(0, shade(m.base, -0.35)); gr.addColorStop(0.3, shade(m.base, -0.05)); gr.addColorStop(0.5, m.base);
      gr.addColorStop(0.75, shade(m.base, -0.18)); gr.addColorStop(1, shade(m.base, -0.4));
      g.fillStyle = gr; g.fillRect(i * w, 0, w + 1, S);
    }
    grime(g, S, r, m.grime ?? 0.15, m.base);
  },
  crate(g, S, m, r) {
    g.fillStyle = m.base; g.fillRect(0, 0, S, S);
    speckle(g, S, r, 3000, [shade(m.base, -0.08), shade(m.base, 0.08)], 1, 2, 0.4);
    const f = S * 0.1, frame = shade(m.base, -0.28);
    g.fillStyle = frame; g.fillRect(0, 0, S, f); g.fillRect(0, S - f, S, f); g.fillRect(0, 0, f, S); g.fillRect(S - f, 0, f, S);
    g.fillStyle = shade(m.base, 0.2); g.fillRect(f, f, S - 2 * f, 2);
    if (m.line) { g.fillStyle = m.line; g.fillRect(S * 0.3, S * 0.44, S * 0.4, S * 0.12); } // 가운데 표시 띠
    g.fillStyle = shade(m.base, -0.4);
    for (const [x, y] of [[f / 2, f / 2], [S - f / 2, f / 2], [f / 2, S - f / 2], [S - f / 2, S - f / 2]]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
    grime(g, S, r, m.grime ?? 0.2, m.base);
  },
  planks(g, S, m, r) {
    const n = 8, pw = S / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(m.base, (r() - 0.5) * 0.14); g.fillRect(0, i * pw + 1, S, pw - 2);
      g.strokeStyle = `rgba(30,20,10,0.25)`;
      for (let k = 0; k < 5; k++) { const y = i * pw + r() * pw; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 6); g.stroke(); }
    }
    grime(g, S, r, m.grime ?? 0.15, m.base);
  },
  plate(g, S, m, r) {
    g.fillStyle = m.base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.04 * r()})`; g.fillRect(0, r() * S, S, 1); } // 결
    const line = m.line || shade(m.base, -0.3);
    g.fillStyle = line; g.fillRect(0, S / 2 - 2, S, 4); g.fillRect(S / 2 - 2, 0, 4, S);
    for (let i = 0; i < 8; i++) for (const y of [S * 0.06, S * 0.56]) { g.beginPath(); g.arc((i + 0.5) * S / 8, y, 3.5, 0, Math.PI * 2); g.fill(); }
    grime(g, S, r, m.grime ?? 0.2, m.base);
  },
  stripe(g, S, m, r) {
    g.fillStyle = m.base; g.fillRect(0, 0, S, S);
    g.fillStyle = m.accent || shade(m.base, -0.6);
    for (const y of [0.1, 0.82]) g.fillRect(0, y * S, S, S * 0.08);
    for (const y of [0.0, 0.33, 0.66, 0.97]) { g.fillStyle = shade(m.base, -0.25); g.fillRect(0, y * S - 4, S, 8); }
    grime(g, S, r, m.grime ?? 0.2, m.base);
  },
  ground(g, S, m, r) {
    g.fillStyle = m.base; g.fillRect(0, 0, S, S);
    blotches(g, S, r, 40, [shade(m.base, -0.05), shade(m.base, 0.05)], 60, 200, 0.4);
    if (m.accent) blotches(g, S, r, 18, [m.accent], 40, 140, 0.22);
    speckle(g, S, r, 12000, [shade(m.base, -0.14), shade(m.base, 0.1), shade(m.base, -0.07)], 1, 3, 0.35);
  },
};
// 재질 정의 → 텍스처 (classic 은 예전 무늬 그대로)
function drawMat(name, m) {
  return (g, S) => {
    if (m.style === 'classic' || !STYLE[m.style]) (TEX[name] || TEX.concrete)(g, S);
    else STYLE[m.style](g, S, { base: '#888888', ...m }, rng(name.length * 977 + 13));
  };
}

// 경사로(쐐기): 박스 크기 안에서 ramp.up 쪽이 높은 모양. 면마다 따로 (각진 그림자)
function rampGeo(w, h, d, ramp, tile) {
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

function boxGeo(w, h, d, tile) {
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

// 하늘·조명·지면·먼 산을 만들고, 맵(구조물)은 setMap(layout) 으로 올린다. layout = shared/maps 의 { boxes, trees, colliders }
// look = content/looks.json 의 분위기 하나. 나중에 setLook 으로 바꿀 수 있다 (스튜디오에서 고치는 즉시 보기)
// opts.fogScale: 안개 짙기 배율 (맵 에디터는 위에서 내려다보므로 옅게)
export function buildWorld(scene, renderer, look, opts = {}) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let textures = {}, MAT_DEF = {};
  const matCache = new Map();
  const getMat = (name, tint) => {
    const key = name + ':' + (tint ?? '');
    if (matCache.has(key)) return matCache.get(key);
    const d = MAT_DEF[name] || MAT_DEF.concrete;
    const tex = textures[name] || textures.concrete;
    const m = new THREE.MeshStandardMaterial({
      map: tex, bumpMap: tex, bumpScale: d.bump,
      roughness: d.rough, metalness: d.metal || 0,
      color: tint ?? 0xffffff,
    });
    matCache.set(key, m);
    return m;
  };

  // ── 하늘 / 조명 (값은 setLook 에서) ──
  const sunDir = new THREE.Vector3();
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  const envScene = new THREE.Scene();
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xb4bcc2, 0.0042);

  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 320;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const fill = new THREE.HemisphereLight(0xbfd4ea, 0x5a5140, 0.55);
  scene.add(fill);

  // ── 지면 ──
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── 먼 산 ──
  const r = rng(99);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  let leafMats = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2, dist = 330 + r() * 120, h = 22 + r() * 40;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(100 + r() * 90, h, 9, 2), hillMat);
    const pos = hill.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) + (r() - 0.5) * 22, pos.getY(k) + (r() - 0.5) * 6, pos.getZ(k) + (r() - 0.5) * 22);
    hill.geometry.computeVertexNormals();
    hill.position.set(Math.cos(a) * dist, h / 2 - 3, Math.sin(a) * dist);
    scene.add(hill);
  }

  // ── 구조물 / 나무: 맵마다 다르므로 setMap 으로 통째로 갈아 끼운다 ──
  const mapGroup = new THREE.Group();
  scene.add(mapGroup);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
  let lastLayout = null, current = null;

  // 분위기 바꾸기: 빛·하늘·안개·재질을 다시 만들고, 올려 둔 맵을 다시 그린다
  function setLook(lk) {
    current = lk;
    MAT_DEF = lk.materials;
    for (const t of Object.values(textures)) t.dispose();
    for (const m of matCache.values()) m.dispose();
    matCache.clear(); textures = {};
    for (const [k, m] of Object.entries(lk.materials)) {
      const t = canvasTex(k === 'ground' ? 1024 : 512, drawMat(k, m), aniso);
      t.colorSpace = THREE.SRGBColorSpace;
      textures[k] = t;
    }
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - lk.sun.elev), THREE.MathUtils.degToRad(lk.sun.azim));
    u.turbidity.value = lk.sky.turbidity; u.rayleigh.value = lk.sky.rayleigh; u.mieCoefficient.value = lk.sky.mie; u.mieDirectionalG.value = lk.sky.mieG;
    u.sunPosition.value.copy(sunDir);
    sun.color.set(lk.sun.color); sun.intensity = lk.sun.intensity; sun.position.copy(sunDir).multiplyScalar(150);
    fill.color.set(lk.fill.sky); fill.groundColor.set(lk.fill.ground); fill.intensity = lk.fill.intensity;
    scene.fog.color.set(lk.fog.color); scene.fog.density = lk.fog.density * (opts.fogScale ?? 1);
    // 주변 반사: 하늘을 한 번 찍어서
    scene.remove(sky); envScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (scene.environment) scene.environment.dispose();
    scene.environment = pmrem.fromScene(envScene, 0, 1, 5000).texture;
    pmrem.dispose();
    envScene.remove(sky); scene.add(sky);
    scene.environmentIntensity = lk.env;
    renderer.toneMappingExposure = lk.exposure;
    hillMat.color.set(lk.hills);
    for (const m of leafMats) m.dispose();
    leafMats = lk.leaves.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    const gt = textures.ground, gTile = MAT_DEF.ground.tile || 14;
    gt.repeat.set(600 / gTile, 600 / gTile);
    ground.material = getMat('ground');
    if (lastLayout) setMap(lastLayout);
  }

  function setMap(layout) {
    lastLayout = layout;
    for (const child of [...mapGroup.children]) { // 이전 맵 치우기 (재질은 공유하므로 모양만 해제)
      mapGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
    const r = rng(99);
    for (const b of layout.boxes) {
      if (b.invisible) continue;
      const d = MAT_DEF[b.mat] || MAT_DEF.concrete;
      let mesh;
      if (b.shape === 'cyl') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 18), getMat(b.mat, b.tint));
      } else if (b.shape === 'ramp') {
        mesh = new THREE.Mesh(rampGeo(b.w, b.h, b.d, b.ramp, d.tile), getMat(b.mat, b.tint));
      } else {
        mesh = new THREE.Mesh(boxGeo(b.w, b.h, b.d, b.fit ? 0 : d.tile), getMat(b.mat, b.tint));
      }
      mesh.position.set(b.x, b.y + b.h / 2, b.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mapGroup.add(mesh);
    }

    // ── 나무 ──
    for (const t of layout.trees) {
      const s = t.s;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 5 * s, 7), trunkMat);
      trunk.position.set(t.x, 2.5 * s, t.z); trunk.castShadow = true; mapGroup.add(trunk);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry((1.3 + r() * 0.9) * s, 1), leafMats[i % leafMats.length]);
        const pos = leaf.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const j = 1 + (Math.sin(pos.getX(k) * 12.9 + pos.getY(k) * 78.2 + pos.getZ(k) * 37.7) * 0.5) * 0.3;
          pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) * j * 0.85, pos.getZ(k) * j);
        }
        leaf.geometry.computeVertexNormals();
        leaf.position.set(t.x + (r() - 0.5) * 2.2 * s, (4.2 + r() * 2.4) * s, t.z + (r() - 0.5) * 2.2 * s);
        leaf.castShadow = true; mapGroup.add(leaf);
      }
    }
  }

  setLook(look);
  return { setMap, setLook, sunDir, get look() { return current; } };
}
