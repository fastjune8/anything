// 절차적 텍스처의 바탕: 난수·얼룩·점 그리기와 재질별 기본 무늬(TEX). 파일 없이 캔버스로 그린다.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function canvasTex(size, draw, maxAniso) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

export function speckle(g, S, r, n, colors, minR, maxR, alpha) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.3 + r() * 0.7);
    g.fillStyle = colors[(r() * colors.length) | 0];
    const s = minR + r() * (maxR - minR);
    g.fillRect(r() * S, r() * S, s, s);
  }
  g.globalAlpha = 1;
}

export function blotches(g, S, r, n, colors, minR, maxR, alpha) {
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

export const TEX = {
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
