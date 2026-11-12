// 이펙트용 텍스처 (총구 화염, 연기)
import * as THREE from 'three';

function radialTex(stops, size = 64, spikes = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  if (spikes) {
    g.globalCompositeOperation = 'lighter';
    g.translate(h, h);
    for (let i = 0; i < spikes; i++) {
      g.rotate(Math.PI * 2 / spikes + 0.3);
      const lg = g.createLinearGradient(0, 0, h, 0);
      lg.addColorStop(0, 'rgba(255,240,200,0.9)'); lg.addColorStop(1, 'rgba(255,160,40,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -h * 0.09); g.lineTo(h, 0); g.lineTo(0, h * 0.09); g.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

export const softTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
export const flashTex = radialTex([[0, 'rgba(255,250,225,1)'], [0.25, 'rgba(255,200,90,0.8)'], [0.6, 'rgba(255,120,20,0.2)'], [1, 'rgba(255,90,0,0)']], 128, 5);
flashTex.colorSpace = THREE.SRGBColorSpace;
