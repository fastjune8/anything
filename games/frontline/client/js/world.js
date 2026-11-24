import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetModel } from './mapassets.js';

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
  bag(g, S, m, r) { // 모래주머니 한 개: 삼베 결 + 가운데가 볼록한 명암 + 가운데 꿰맨 줄 (면마다 한 장씩 쓴다: tile 0)
    g.fillStyle = m.base; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 8) { g.fillStyle = `rgba(0,0,0,${0.02 + 0.025 * r()})`; g.fillRect(0, y, S, 2); }
    speckle(g, S, r, 4500, [shade(m.base, -0.12), shade(m.base, 0.1)], 1, 2.5, 0.3);
    const gr = g.createRadialGradient(S * 0.5, S * 0.42, S * 0.08, S * 0.5, S * 0.5, S * 0.75); // 볼록한 느낌: 가운데 밝고 가장자리 어둡게
    gr.addColorStop(0, 'rgba(255,255,240,0.16)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = m.line || shade(m.base, -0.4); g.globalAlpha = 0.55;
    for (let x = S * 0.12; x < S * 0.88; x += 26) g.fillRect(x, S * 0.5 - 2, 14, 4); // 꿰맨 자국
    g.globalAlpha = 1;
    grime(g, S, r, m.grime ?? 0.12, m.base);
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
  // 64×64 칸으로 나눠 꼭짓점 색에 큰 규모의 밝기·색 변화를 싣는다 (같은 텍스처가 14m 마다 반복돼 보이는 것을 가린다) → paintGround
  const GSEG = 64;
  const groundGeo = new THREE.PlaneGeometry(600, 600, GSEG, GSEG);
  groundGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((GSEG + 1) * (GSEG + 1) * 3).fill(1), 3));
  const ground = new THREE.Mesh(groundGeo);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── 먼 산 ──  (가까운 줄 26개 + 더 멀고 크고 옅은 줄 14개: 안개 속에서 겹겹이 깊이가 생긴다)
  const r = rng(99);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  const hillFarMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  let leafMats = [], leafKey = '';
  for (let i = 0; i < 40; i++) {
    const far = i >= 26, a = far ? ((i - 26) / 14) * Math.PI * 2 + r() * 0.3 : (i / 26) * Math.PI * 2 + r() * 0.2;
    const dist = far ? 480 + r() * 90 : 330 + r() * 120, h = far ? 45 + r() * 45 : 22 + r() * 40;
    const hill = new THREE.Mesh(new THREE.ConeGeometry((far ? 150 : 100) + r() * 90, h, 9, 2), far ? hillFarMat : hillMat);
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
  let lastLayout = null, current = null, groundMat = null;

  // 분위기 바꾸기: 빛·하늘·안개·재질을 다시 만들고, 올려 둔 맵을 다시 그린다
  // only: 다시 만들 재질 이름 목록 (없으면 전부, [] = 빛·하늘만). 분위기 에디터가 고친 것만 빨리 다시 그릴 때
  function setLook(lk, only) {
    current = lk;
    MAT_DEF = lk.materials;
    const names = only || Object.keys(lk.materials);
    if (!only) { for (const t of Object.values(textures)) t.dispose(); textures = {}; }
    for (const [key, m] of [...matCache]) if (!only || names.includes(key.split(':')[0])) { m.dispose(); matCache.delete(key); }
    for (const k of names) {
      if (textures[k]) textures[k].dispose();
      textures[k] = canvasTex(k === 'ground' ? 1024 : 512, drawMat(k, lk.materials[k]), aniso);
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
    hillFarMat.color.set(lk.hills).lerp(new THREE.Color(lk.fog.color), 0.4); // 먼 줄은 안개색 쪽으로 옅게
    const leavesChanged = JSON.stringify(lk.leaves) !== leafKey;
    if (leavesChanged) { // 나뭇잎 색이 바뀌었을 때만 (나무가 쓰던 재질을 버리므로 맵을 다시 그린다)
      for (const m of leafMats) m.dispose();
      leafMats = lk.leaves.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
      leafKey = JSON.stringify(lk.leaves);
    }
    const gt = textures.ground, gTile = MAT_DEF.ground.tile || 14;
    gt.repeat.set(600 / gTile, 600 / gTile);
    if (groundMat) groundMat.dispose();
    groundMat = getMat('ground').clone(); groundMat.vertexColors = true; // 꼭짓점 색(paintGround)을 곱한다. 재질은 지면 전용 복제본
    ground.material = groundMat;
    if (lastLayout && (!only || names.some(k => k !== 'ground') || leavesChanged)) setMap(lastLayout);
  }

  // ── 그림자 대상 줄이기 ──
  // 그림자 맵은 카메라 뒤·옆에 있는 물체까지 매번 다시 그린다. 그런데 어떤 물체의 그림자가 화면에 보이려면
  // 그 물체를 해의 반대 방향으로 바닥까지 늘린 모양(그림자 기둥)이 카메라 시야에 걸려야 한다. 안 걸리면 이번 프레임
  // 그림자 맵에서 뺀다 (castShadow=false). 매 프레임 다시 계산하므로 캐릭터·카메라가 움직여도 그림자는 그대로 따라온다.
  // shadowMap.autoUpdate 나 그림자 카메라·해상도는 건드리지 않는다. api.shadowCull=false 로 끄면 예전과 같다.
  let shadowFloor = 0;
  const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _bx = new THREE.Box3(), _bx2 = new THREE.Box3(), _sv = new THREE.Vector3();
  let cullOn = true;
  const SHADOW_MARGIN = 2; // m, 부드러운 그림자 가장자리와 부동소수 오차 여유
  function casts(box) {
    if (!cullOn) return true;
    const t = Math.max(0, box.max.y - shadowFloor) / Math.max(sunDir.y, 0.05); // 해 반대 방향으로 바닥에 닿기까지의 길이
    _bx.copy(box).expandByScalar(SHADOW_MARGIN);
    _bx2.copy(_bx).translate(_sv.copy(sunDir).multiplyScalar(-t));
    return _fr.intersectsBox(_bx.union(_bx2));
  }
  // 렌더 직전에 호출. bodies(casts) 는 움직이는 물체(캐릭터)가 자기 박스로 casts 를 불러 판정하는 콜백
  function beginShadowCull(cam, bodies) {
    cullOn = api.shadowCull;
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    let on = 0, total = 0;
    for (const m of mapGroup.children) {
      if (!m.userData.cs) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const c = casts(m.geometry.boundingBox);
      if (m.castShadow !== c) m.castShadow = c;
      total++; if (c) on++;
    }
    api.shadowStats.staticTotal = total; api.shadowStats.staticOn = on;
    if (bodies) bodies(casts);
  }

  // 정적 구조물·나무는 그리기 호출을 줄이려고 (재질 × 그림자 설정 × 공간 칸) 별로 지오메트리를 합쳐 한 메쉬로 만든다.
  // 충돌·총알은 layout.colliders 만 쓰므로 여기(눈에 보이는 모양)와 무관하다. 칸 단위로 합쳐서 칸 단위 프러스텀 컬링이 유지된다.
  // MERGE_CELL 보다 긴 물체(외곽 벽 등)는 합치면 컬링 범위만 넓어지므로 따로 둔다.
  const MERGE_CELL = 40;
  const mapStats = { sources: 0, meshes: 0, merged: 0, unmerged: 0, assetMeshes: 0, assetTris: 0 };

  // 지면 꼭짓점 색: ① 아주 큰 얼룩(밝기·따뜻함이 수십 m 마다 조금씩 달라진다) ② 플레이 공간 바깥은 어둡고 채도를 뺀다 (싸우는 곳과 배경을 가른다)
  // half = 플레이 공간 반지름(외곽 벽 안쪽 면). 값은 1 주변이라 재질 색을 거의 안 바꾼다
  const _gc = new THREE.Color();
  function paintGround(half) {
    const pos = groundGeo.attributes.position, col = groundGeo.attributes.color;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = -pos.getY(k);
      const n1 = 0.5 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.037 + 0.4) + 0.3 * Math.sin(x * 0.11 + z * 0.09 + 2) + 0.2 * Math.sin(z * 0.17 - x * 0.05);
      const n2 = Math.sin(x * 0.027 - 0.8) * Math.sin(z * 0.031 + 1.9);
      let rr = 1 + 0.07 * n1 + 0.04 * n2, gg = 1 + 0.07 * n1 - 0.01 * n2, bb = 1 + 0.07 * n1 - 0.05 * n2;
      const out = sm(0, 16, Math.max(Math.abs(x), Math.abs(z)) - half); // 0 = 안, 1 = 바깥
      const lum = (rr + gg + bb) / 3, desat = 0.45 * out, dark = 1 - 0.18 * out;
      rr = (rr + (lum - rr) * desat) * dark; gg = (gg + (lum - gg) * desat) * dark; bb = (bb + (lum - bb) * desat) * dark;
      _gc.setRGB(rr, gg, bb); col.setXYZ(k, _gc.r, _gc.g, _gc.b);
    }
    col.needsUpdate = true;
  }

  function setMap(layout) {
    lastLayout = layout;
    { let half = 0; for (const b of layout.boxes) if (!b.invisible && b.h >= 4) half = Math.max(half, Math.abs(b.x) - b.w / 2, Math.abs(b.z) - b.d / 2); paintGround(half > 20 ? half : 56); } // 외곽 벽 안쪽 면
    for (const child of [...mapGroup.children]) { // 이전 맵 치우기 (재질은 공유하므로 모양만 해제)
      mapGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
    shadowFloor = 0;
    for (const b of layout.boxes) if (!b.invisible && b.y < shadowFloor) shadowFloor = b.y; // 그림자를 받을 수 있는 가장 낮은 면
    const groups = new Map(); // key → { mat, cast, recv, geoms }
    mapStats.sources = 0; mapStats.meshes = 0; mapStats.merged = 0; mapStats.unmerged = 0; mapStats.assetMeshes = 0; mapStats.assetTris = 0;
    // 시각 모델(.glb): 불러온 것만. replacedBy 가 가리키는 모델이 있으면 그 박스의 눈에 보이는 모양은 건너뛴다 (충돌 박스는 layout.colliders 가 따로 갖는다)
    const placed = new Set(), _am = new THREE.Matrix4(), _aq = new THREE.Quaternion(), _ae = new THREE.Euler();
    for (const a of layout.assets || []) {
      const model = assetModel(a.id);
      if (!model) continue;
      placed.add(a.id);
      _am.compose(_sv.set(a.x, a.y, a.z), _aq.setFromEuler(_ae.set(0, -THREE.MathUtils.degToRad(a.rot || 0), 0)), new THREE.Vector3(a.s || 1, a.s || 1, a.s || 1));
      model.traverse(o => {
        if (!o.isMesh) return;
        const mats = [].concat(o.material);
        for (const m of mats) for (const k of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) if (m[k] && m[k].anisotropy < aniso) { m[k].anisotropy = aniso; m[k].needsUpdate = true; }
        const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(_am, o.matrixWorld)); // 위치를 구워 넣어야 그림자 컬이 박스를 바로 쓴다
        const cast = a.shadow !== 'none' && !/^NS_/.test(o.name) && !mats.some(m => m.transparent);
        const mesh = new THREE.Mesh(geo, o.material);
        mesh.castShadow = cast; mesh.receiveShadow = !mats.some(m => m.transparent); mesh.userData.cs = cast; mesh.name = o.name;
        mapGroup.add(mesh); mapStats.assetMeshes++; mapStats.assetTris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      });
    }
    // 모양(위치까지 구워 넣은 지오메트리)을 내놓는다. big 이면 합치지 않고 바로 메쉬로
    const emit = (geo, mat, x, z, cast, recv, big) => {
      mapStats.sources++;
      if (big) {
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = cast; mesh.receiveShadow = recv; mesh.userData.cs = cast;
        mapGroup.add(mesh); mapStats.meshes++; mapStats.unmerged++;
        return;
      }
      const key = Math.floor(x / MERGE_CELL) + ',' + Math.floor(z / MERGE_CELL) + '|' + mat.uuid + '|' + cast + recv;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { mat, cast, recv, geoms: [] });
      g.geoms.push(geo);
    };
    const r = rng(99);
    for (const b of layout.boxes) {
      if (b.invisible || (b.swap && placed.has(b.swap))) continue;
      const d = MAT_DEF[b.mat] || MAT_DEF.concrete;
      let geo;
      if (b.shape === 'cyl') geo = new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 18);
      else if (b.shape === 'ramp') geo = rampGeo(b.w, b.h, b.d, b.ramp, d.tile);
      else geo = boxGeo(b.w, b.h, b.d, b.fit ? 0 : d.tile);
      geo.translate(b.x, b.y + b.h / 2, b.z);
      emit(geo, getMat(b.mat, b.tint), b.x, b.z, !b.noShadow, true, Math.max(b.w, b.d) > MERGE_CELL); // noShadow: 얇은 건축 장식은 그림자를 던지지 않는다 (받기는 한다)
    }

    // ── 나무 ──
    for (const t of layout.trees) {
      const s = t.s;
      const trunk = new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 5 * s, 7);
      trunk.translate(t.x, 2.5 * s, t.z);
      emit(trunk, trunkMat, t.x, t.z, true, false, false);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.IcosahedronGeometry((1.3 + r() * 0.9) * s, 1);
        const pos = leaf.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const j = 1 + (Math.sin(pos.getX(k) * 12.9 + pos.getY(k) * 78.2 + pos.getZ(k) * 37.7) * 0.5) * 0.3;
          pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) * j * 0.85, pos.getZ(k) * j);
        }
        leaf.computeVertexNormals();
        leaf.translate(t.x + (r() - 0.5) * 2.2 * s, (4.2 + r() * 2.4) * s, t.z + (r() - 0.5) * 2.2 * s);
        emit(leaf, leafMats[i % leafMats.length], t.x, t.z, true, false, false);
      }
    }

    for (const g of groups.values()) {
      let merged = g.geoms[0];
      if (g.geoms.length > 1) {
        const mixed = g.geoms.some(x => x.index) && g.geoms.some(x => !x.index); // 인덱스 유무가 섞이면 합칠 수 없다
        const list = mixed ? g.geoms.map(x => x.index ? x.toNonIndexed() : x) : g.geoms;
        merged = mergeGeometries(list, false);
        if (merged) { for (const x of g.geoms) x.dispose(); if (mixed) for (const x of list) x.dispose(); }
      }
      if (merged) {
        const mesh = new THREE.Mesh(merged, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.recv; mesh.userData.cs = g.cast;
        mapGroup.add(mesh); mapStats.meshes++; mapStats.merged += g.geoms.length;
      } else { // 속성이 맞지 않아 합치지 못하면 하나씩 (일어나지 않아야 한다)
        for (const x of g.geoms) { const mesh = new THREE.Mesh(x, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.recv; mesh.userData.cs = g.cast; mapGroup.add(mesh); mapStats.meshes++; mapStats.unmerged++; }
      }
    }
  }

  setLook(look);
  const api = { setMap, setLook, sunDir, mapStats, beginShadowCull, shadowCull: true, shadowStats: { staticTotal: 0, staticOn: 0 }, get look() { return current; } };
  return api;
}
