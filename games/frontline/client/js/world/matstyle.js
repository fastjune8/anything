// 분위기(look)의 재질 style 을 색으로 그리는 무늬 (content/looks.json 의 materials). drawMat(이름, 재질 정의) → 캔버스 그리는 함수.
import { rng, speckle, blotches, TEX } from './proctex.js';

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
export function drawMat(name, m) {
  return (g, S) => {
    if (m.style === 'classic' || !STYLE[m.style]) (TEX[name] || TEX.concrete)(g, S);
    else STYLE[m.style](g, S, { base: '#888888', ...m }, rng(name.length * 977 + 13));
  };
}
