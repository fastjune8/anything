import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildLayout } from './layout.js';

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

const MAT_DEF = {
  ground: { tile: 14, rough: 1.0, bump: 0.6 },
  concrete: { tile: 4, rough: 0.92, bump: 0.25 },
  concreteDark: { tile: 4, rough: 0.95, bump: 0.25 },
  brick: { tile: 1.6, rough: 0.9, bump: 0.5 },
  container: { tile: 2.44, rough: 0.55, metal: 0.55, bump: 0.6 },
  crate: { tile: 0, rough: 0.85, bump: 0.3 },
  wood: { tile: 2, rough: 0.88, bump: 0.3 },
  sandbag: { tile: 1.0, rough: 1.0, bump: 0.9 },
  metal: { tile: 2, rough: 0.5, metal: 0.7, bump: 0.2 },
  barrel: { tile: 0, rough: 0.5, metal: 0.6, bump: 0.3 },
};

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

export function buildWorld(scene, renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = {};
  for (const k of Object.keys(TEX)) textures[k] = canvasTex(k === 'ground' ? 1024 : 512, TEX[k], aniso);

  const matCache = new Map();
  const getMat = (name, tint) => {
    const key = name + ':' + (tint ?? '');
    if (matCache.has(key)) return matCache.get(key);
    const d = MAT_DEF[name];
    const m = new THREE.MeshStandardMaterial({
      map: textures[name], bumpMap: textures[name], bumpScale: d.bump,
      roughness: d.rough, metalness: d.metal || 0,
      color: tint ?? 0xffffff,
    });
    matCache.set(key, m);
    return m;
  };

  // ── 하늘 / 조명 ──
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 34), THREE.MathUtils.degToRad(138));
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);

  const envScene = new THREE.Scene();
  envScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 1, 5000).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xb4bcc2, 0.0042);

  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 320;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x5a5140, 0.55));

  // ── 지면 ──
  const gt = textures.ground;
  gt.repeat.set(600 / MAT_DEF.ground.tile, 600 / MAT_DEF.ground.tile);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), getMat('ground'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── 먼 산 ──
  const r = rng(99);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2, dist = 330 + r() * 120, h = 22 + r() * 40;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(100 + r() * 90, h, 9, 2), hillMat);
    const pos = hill.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) + (r() - 0.5) * 22, pos.getY(k) + (r() - 0.5) * 6, pos.getZ(k) + (r() - 0.5) * 22);
    hill.geometry.computeVertexNormals();
    hill.position.set(Math.cos(a) * dist, h / 2 - 3, Math.sin(a) * dist);
    scene.add(hill);
  }

  // ── 구조물 ──
  const layout = buildLayout();
  for (const b of layout.boxes) {
    if (b.invisible) continue;
    const d = MAT_DEF[b.mat];
    let mesh;
    if (b.shape === 'cyl') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 18), getMat(b.mat, b.tint));
    } else {
      mesh = new THREE.Mesh(boxGeo(b.w, b.h, b.d, b.fit ? 0 : d.tile), getMat(b.mat, b.tint));
    }
    mesh.position.set(b.x, b.y + b.h / 2, b.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ── 나무 ──
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
  const leafMats = [0x35472a, 0x2e4025, 0x40522f].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  for (const t of layout.trees) {
    const s = t.s;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 5 * s, 7), trunkMat);
    trunk.position.set(t.x, 2.5 * s, t.z); trunk.castShadow = true; scene.add(trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry((1.3 + r() * 0.9) * s, 1), leafMats[i % 3]);
      const pos = leaf.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const j = 1 + (Math.sin(pos.getX(k) * 12.9 + pos.getY(k) * 78.2 + pos.getZ(k) * 37.7) * 0.5) * 0.3;
        pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) * j * 0.85, pos.getZ(k) * j);
      }
      leaf.geometry.computeVertexNormals();
      leaf.position.set(t.x + (r() - 0.5) * 2.2 * s, (4.2 + r() * 2.4) * s, t.z + (r() - 0.5) * 2.2 * s);
      leaf.castShadow = true; scene.add(leaf);
    }
  }

  return { colliders: layout.colliders, sunDir };
}

// ───────── 레이캐스트 (AABB) ─────────
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function normalOf(i) { return NORMALS[i] || NORMALS[2]; }

export function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, n = -1;
  // X
  if (Math.abs(d.x) < 1e-9) { if (o.x < b.minX || o.x > b.maxX) return null; }
  else {
    let t1 = (b.minX - o.x) / d.x, t2 = (b.maxX - o.x) / d.x, nn = 1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = 0; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.y) < 1e-9) { if (o.y < b.minY || o.y > b.maxY) return null; }
  else {
    let t1 = (b.minY - o.y) / d.y, t2 = (b.maxY - o.y) / d.y, nn = 3;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = 2; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.z) < 1e-9) { if (o.z < b.minZ || o.z > b.maxZ) return null; }
  else {
    let t1 = (b.minZ - o.z) / d.z, t2 = (b.maxZ - o.z) / d.z, nn = 5;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nn = 4; }
    if (t1 > tmin) { tmin = t1; n = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (n < 0) return null; // 박스 내부에서 시작
  return { t: tmin, n };
}

export function rayWorld(o, d, colliders, maxT = 400) {
  let best = maxT, n = -1;
  for (let i = 0; i < colliders.length; i++) {
    const h = rayBox(o, d, colliders[i], best);
    if (h && h.t < best) { best = h.t; n = h.n; }
  }
  if (d.y < -1e-6) { // 지면
    const t = -o.y / d.y;
    if (t > 0 && t < best) { best = t; n = 2; }
  }
  return { t: best, n };
}
