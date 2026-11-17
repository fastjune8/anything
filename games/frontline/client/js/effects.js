// 효과(이펙트) 실행기: content/effects.json 의 효과 정의를 장면에 그린다. 게임과 스튜디오 효과 에디터가 같이 쓴다.
//   효과 하나 = 층(emitter) 여러 개
//     particles  입자: 한 번에(count) 또는 시간 동안(rate × duration) 뿜는다. 수명·속도·방향·중력·저항·크기/색/투명도 변화·무늬·섞는 방식
//     ring       고리: 바닥(또는 화면 쪽)으로 퍼지는 충격파
//     light      빛: 주변을 잠깐 밝힌다
//   입자는 무늬·섞는 방식이 같은 것끼리 Points 하나로 그린다 (그리기 호출이 적다). 모양 계산은 모두 여기서 (THREE 만 쓴다)
import * as THREE from 'three';

// ───── 입자 무늬 (캔버스로 그린다, 이미지 파일 없음) ─────
export const TEXTURES = { soft: '부드러운 빛', spark: '불꽃 (가늘고 밝은)', smoke: '연기 (뭉게)', ring: '고리', star: '별빛 (네 갈래)', square: '파편 (각진)' };
const texCache = {};
function texture(name) {
  if (texCache[name]) return texCache[name];
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), h = S / 2;
  const radial = (stops, r = h) => { const gr = g.createRadialGradient(h, h, 0, h, h, r); for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, S, S); };
  switch (name) {
    case 'spark': radial([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']], h * 0.55); break;
    case 'smoke': {
      radial([[0, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
      for (let i = 0; i < 9; i++) { const x = h + (Math.random() - 0.5) * S * 0.45, y = h + (Math.random() - 0.5) * S * 0.45, r = S * (0.12 + Math.random() * 0.16); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
      break;
    }
    case 'ring': g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = S * 0.08; g.beginPath(); g.arc(h, h, h * 0.78, 0, Math.PI * 2); g.stroke(); break;
    case 'star':
      radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], h * 0.6);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(h - 1.5, 2, 3, S - 4); g.fillRect(2, h - 1.5, S - 4, 3);
      break;
    case 'square': g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(S * 0.3, S * 0.3, S * 0.4, S * 0.4); break;
    default: radial([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[name] = t);
}

// ───── 입자 묶음: 무늬·섞는 방식이 같은 입자들 ─────
const VERT = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying vec3 vC; varying float vA;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.0, aSize * uScale / max(0.05, -mv.z)); vC = aColor; vA = aAlpha; }`;
const FRAG = `uniform sampler2D map; varying vec3 vC; varying float vA;
void main() { vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vA; if (a < 0.004) discard; gl_FragColor = vec4(vC * t.rgb, a); }`;
const _size = new THREE.Vector2();
function makeGroup(scene, tex, blend, cap) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), alpha = new Float32Array(cap), size = new Float32Array(cap);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture(tex) }, uScale: { value: 500 } }, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = blend === 'normal' ? 5 : 6;
  // 입자 크기(m)를 화면 픽셀로: 화면 높이 × 투영 배율 / 2 / 거리
  points.onBeforeRender = (renderer, _s, camera) => { renderer.getDrawingBufferSize(_size); mat.uniforms.uScale.value = _size.y * camera.projectionMatrix.elements[5] * 0.5; };
  scene.add(points);
  return { points, geo, pos, col, alpha, size, cap, list: [] };
}

const rand = (a, b) => a + Math.random() * (b - a);
const _c0 = new THREE.Color(), _c1 = new THREE.Color(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// 효과 실행기 하나 (장면마다). opts.max = 입자 묶음 하나의 최대 입자 수
export function createEffects(scene, opts = {}) {
  const cap = opts.max || 1500;
  const groups = new Map(), running = [], rings = [];
  const lights = Array.from({ length: opts.lights ?? 4 }, () => { const l = new THREE.PointLight(0xffffff, 0, 10, 2); scene.add(l); return { l, t: 0, life: 0, base: 0 }; });
  let solo = null, muted = new Set(); // 스튜디오: 층 하나만 보기 / 끈 층

  const groupOf = (tex, blend) => { const k = `${tex}|${blend}`; if (!groups.has(k)) groups.set(k, makeGroup(scene, tex, blend, cap)); return groups.get(k); };

  // 입자 하나 뿜기
  function spawn(em, inst) {
    const g = groupOf(em.texture || 'soft', em.blend || 'add');
    if (g.list.length >= g.cap) return;
    const s = inst.scale, r = (em.radius || 0) * s;
    const p = { em, life: 0, max: rand(em.lifeMin ?? 0.5, em.lifeMax ?? em.lifeMin ?? 0.5), pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0 };
    // 나오는 곳: 반경 r 의 공 안
    if (r > 0) { _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); if (_v.lengthSq() > 1) _v.normalize(); p.pos.copy(_v).multiplyScalar(r); }
    p.pos.add(inst.pos);
    // 방향
    const speed = rand(em.speedMin ?? 0, em.speedMax ?? em.speedMin ?? 0) * s;
    const dir = em.dir || 'sphere';
    if (dir === 'up') _v.set(0, 1, 0);
    else if (dir === 'down') _v.set(0, -1, 0);
    else if (dir === 'out') { _v.copy(p.pos).sub(inst.pos); if (_v.lengthSq() < 1e-6) _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); _v.normalize(); }
    else if (dir === 'ground') { const a = Math.random() * Math.PI * 2; _v.set(Math.cos(a), 0, Math.sin(a)); }
    else if (dir === 'cone' || dir === 'forward') _v.copy(inst.dir);
    else { _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0); _v.normalize(); }
    if ((dir === 'cone' || dir === 'up' || dir === 'down' || dir === 'forward') && em.spread) { // 퍼짐 (도)
      const sp = THREE.MathUtils.degToRad(em.spread) * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      const side = Math.abs(_v.y) < 0.9 ? _up : new THREE.Vector3(1, 0, 0), a = new THREE.Vector3().crossVectors(_v, side).normalize(), b = new THREE.Vector3().crossVectors(_v, a);
      _v.multiplyScalar(Math.cos(sp)).addScaledVector(a, Math.sin(sp) * Math.cos(th)).addScaledVector(b, Math.sin(sp) * Math.sin(th)).normalize();
    }
    p.vel.copy(_v).multiplyScalar(speed);
    p.s = s;
    g.list.push(p);
  }

  function startRing(em, inst) {
    const w = Math.max(0.01, Math.min(0.95, (em.width ?? 0.3) / Math.max(0.01, em.radiusEnd ?? 3)));
    const m = new THREE.Mesh(new THREE.RingGeometry(1 - w, 1, 56), new THREE.MeshBasicMaterial({
      color: em.color || '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: em.blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending, toneMapped: false,
    }));
    m.position.copy(inst.pos); if ((em.facing || 'ground') === 'ground') { m.rotation.x = -Math.PI / 2; m.position.y += 0.03; }
    m.renderOrder = 7; scene.add(m);
    rings.push({ m, em, t: 0, s: inst.scale, facing: em.facing || 'ground' });
  }
  function startLight(em, inst) {
    const L = lights.find(x => x.t >= x.life) || lights[0];
    L.l.position.copy(inst.pos); L.l.color.set(em.color || '#ffffff'); L.l.distance = (em.range ?? 8) * inst.scale;
    L.base = em.intensity ?? 50; L.l.intensity = L.base; L.t = 0; L.life = em.life ?? 0.3;
  }

  // 효과 재생. def = effects.json 의 항목, pos = 위치(Vector3), o = { dir(앞 방향, cone·forward 에), scale(크기 배율) }
  function play(def, pos, o = {}) {
    if (!def) return null;
    const inst = { def, pos: pos.clone(), dir: (o.dir ? o.dir.clone() : new THREE.Vector3(0, 0, -1)).normalize(), scale: o.scale ?? 1, t: 0, ems: def.emitters.map(e => ({ e, started: false, acc: 0 })) };
    running.push(inst);
    return inst;
  }

  const visible = em => !muted.has(em) && (!solo || solo === em);
  function update(dt, camera) {
    // 층 시작·흘려 뿜기
    for (let i = running.length - 1; i >= 0; i--) {
      const inst = running[i];
      inst.t += dt;
      let alive = false;
      for (const st of inst.ems) {
        const em = st.e, t = inst.t - (em.delay || 0);
        if (t < 0) { alive = true; continue; }
        const show = visible(em);
        if (!st.started) {
          st.started = true;
          if (show) {
            if (em.kind === 'particles') for (let k = 0; k < (em.count || 0); k++) spawn(em, inst);
            else if (em.kind === 'ring') startRing(em, inst);
            else if (em.kind === 'light') startLight(em, inst);
          }
        }
        if (em.kind === 'particles' && em.rate > 0 && t < (em.duration ?? 0)) {
          alive = true;
          st.acc += em.rate * Math.min(dt, em.duration - t + dt);
          while (st.acc >= 1) { st.acc -= 1; if (show) spawn(em, inst); }
        }
      }
      if (!alive) running.splice(i, 1);
    }
    // 입자 움직이기 → 버퍼에 쓰기
    for (const g of groups.values()) {
      let n = 0;
      const L = g.list;
      for (let i = 0; i < L.length; i++) {
        const p = L[i], em = p.em;
        p.life += dt;
        if (p.life >= p.max) continue;
        const k = p.life / p.max;
        p.vel.y -= (em.gravity || 0) * p.s * dt;
        if (em.drag) p.vel.multiplyScalar(Math.exp(-em.drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        L[n] = p;
        g.pos[n * 3] = p.pos.x; g.pos[n * 3 + 1] = p.pos.y; g.pos[n * 3 + 2] = p.pos.z;
        _c0.set(em.colorStart || '#ffffff'); _c1.set(em.colorEnd || em.colorStart || '#ffffff'); _c0.lerp(_c1, k).multiplyScalar(em.glow ?? 1);
        g.col[n * 3] = _c0.r; g.col[n * 3 + 1] = _c0.g; g.col[n * 3 + 2] = _c0.b;
        const a0 = em.alphaStart ?? 1, a1 = em.alphaEnd ?? 0;
        g.alpha[n] = (a0 + (a1 - a0) * k) * Math.min(1, p.life / 0.03 + 0.2); // 처음 아주 잠깐 나타나기
        const s0 = em.sizeStart ?? 0.2, s1 = em.sizeEnd ?? s0;
        g.size[n] = (s0 + (s1 - s0) * k) * p.s;
        n++;
      }
      L.length = n;
      g.geo.setDrawRange(0, n);
      for (const a of ['position', 'aColor', 'aAlpha', 'aSize']) g.geo.attributes[a].needsUpdate = true;
    }
    // 고리
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i], em = r.em;
      r.t += dt;
      const life = em.life ?? 0.4, k = Math.min(1, r.t / life), e = 1 - (1 - k) * (1 - k);
      const rad = ((em.radiusStart ?? 0.2) + ((em.radiusEnd ?? 3) - (em.radiusStart ?? 0.2)) * e) * r.s;
      r.m.scale.setScalar(Math.max(0.001, rad));
      const a0 = em.alphaStart ?? 1, a1 = em.alphaEnd ?? 0;
      r.m.material.opacity = a0 + (a1 - a0) * k;
      if (r.facing === 'camera' && camera) r.m.quaternion.copy(camera.quaternion);
      if (k >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); }
    }
    // 빛
    for (const L of lights) {
      if (L.t >= L.life) { L.l.intensity = 0; continue; }
      L.t += dt; const k = Math.min(1, L.t / L.life); L.l.intensity = L.base * (1 - k) * (1 - k);
    }
  }

  function clear() {
    running.length = 0;
    for (const g of groups.values()) { g.list.length = 0; g.geo.setDrawRange(0, 0); }
    for (const r of rings) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }
    rings.length = 0;
    for (const L of lights) { L.t = L.life = 0; L.l.intensity = 0; }
  }
  const stats = () => ({ particles: [...groups.values()].reduce((n, g) => n + g.list.length, 0), rings: rings.length, running: running.length });
  // 스튜디오용: 층 하나만 보기(solo) / 끄기(mute)
  const setView = (s, m) => { solo = s || null; muted = new Set(m || []); };
  return { play, update, clear, stats, setView };
}
