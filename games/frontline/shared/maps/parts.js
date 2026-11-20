// 맵을 조립하는 부품들 (THREE 의존 없음 — 서버에서도 쓴다)
// B(x, y, z, w, h, d, mat, extra): 박스 하나를 추가하는 함수. x,z = 중심, y = 바닥 높이, w(x) h(y) d(z)


// ───────── 건축 디테일 (P2-2) ─────────
// 벽·건물에 얹는 장식 박스(noCollide) — 충돌 박스는 아래 wallRun 이 예전과 똑같이 만들고, 장식은 벽 앞뒤로 최대 0.1m 만 나온다.
// 재질은 이미 있는 키만 쓴다 (벽 재질 → 틀·기단·기둥·머리돌). noShadow = 얇은 장식이라 그림자 맵에서 뺀다 (client/js/world.js)
// concreteDark 는 노란 줄무늬가 박혀 있어서 얇은 장식에 쓰면 줄이 토막토막 보인다 → 기단·틀은 metal(회색 판)을 쓴다
const TRIM = {
  brick: { frame: 'concrete', base: 'metal', pier: 'metal', cap: 'concrete', corner: 'metal' },
  concrete: { frame: 'metal', base: 'metal', pier: 'metal', cap: 'metal', corner: 'metal' },
  concreteDark: { frame: 'metal', base: 'metal', pier: 'metal', cap: 'metal', corner: 'metal' },
  wood: { frame: 'metal', base: 'metal', pier: 'wood', cap: 'metal', corner: 'metal' },
};
const TRIM_DEFAULT = TRIM.concrete;
const THIN = { noCollide: true, noShadow: true };
const SOLID = { noCollide: true };
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }; // 정해진 "무작위"

// opts: false = 장식 없음 · { face: 1|-1 (한 면만) , cap: false (머리돌 없음) }
export function wallRun(B, alongX, fixed, from, to, h, t, ops, mat, opts) {
  ops = [...(ops || [])].sort((a, b) => a.at - b.at);
  const seg = (a, b, y0, y1) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const c = (a + b) / 2, len = b - a;
    if (alongX) B(c, y0, fixed, len, y1 - y0, t, mat);
    else B(fixed, y0, c, t, y1 - y0, len, mat);
  };
  let cur = from;
  for (const o of ops) {
    const a = o.at - o.w / 2, b = o.at + o.w / 2;
    seg(cur, a, 0, h);
    if (o.type === 'door') seg(a, b, 2.2, h);
    else { seg(a, b, 0, 1.0); seg(a, b, 2.0, h); }
    cur = b;
  }
  seg(cur, to, 0, h);
  if (opts !== false) trimWall(B, alongX, fixed, from, to, h, t, ops, mat, opts || {});
}

// 틀·기단·기둥·머리돌. 벽이 뻗는 방향 좌표 u, 벽 옆으로의 치우침 off
function trimWall(B, alongX, fixed, from, to, h, t, ops, mat, o) {
  const M = TRIM[mat] || TRIM_DEFAULT;
  const side = o.face === 1 || o.face === -1 ? o.face : 0; // 0 = 양쪽 면
  // 벽 중심 기준 두께 방향 범위: 양쪽이면 t+2p 를 가운데에, 한쪽이면 벽 한가운데부터 그쪽 바깥 p 까지
  const P = (u0, u1, y0, y1, p, m, extra) => {
    const du = u1 - u0, dv = side ? t / 2 + p : t + 2 * p, off = side ? side * dv / 2 : 0;
    if (du < 0.01 || y1 - y0 < 0.005) return;
    const u = (u0 + u1) / 2;
    if (alongX) B(u, y0, fixed + off, du, y1 - y0, dv, m, extra);
    else B(fixed + off, y0, u, dv, y1 - y0, du, m, extra);
  };
  const FW = 0.15, GAP = 0.02; // 틀 너비 · 개구부 가장자리에서 벽 쪽으로 물러난 거리 (벽 끝면과 같은 평면이 되면 깜빡인다)
  // 개구부 사이의 벽 구간 (끝은 벽 끝)
  const solid = []; let cur = from;
  for (const o2 of ops) { solid.push([cur, o2.at - o2.w / 2]); cur = o2.at + o2.w / 2; }
  solid.push([cur, to]);
  // 이웃과 가까우면 틀을 좁힌다
  const fw = (gap) => Math.min(FW, Math.max(0, gap * 0.45));
  ops.forEach((op, i) => {
    const a = op.at - op.w / 2, b = op.at + op.w / 2, fl = fw(solid[i][1] - solid[i][0]), fr = fw(solid[i + 1][1] - solid[i + 1][0]);
    if (fl < 0.05 && fr < 0.05) return;
    if (op.type === 'door') {
      if (h < 2.6) return;
      const hh = Math.min(0.2, h - 2.2 - 0.05);
      P(a - fl, a - GAP, 0, 2.2 + 0.02, 0.07, M.frame, THIN); // 왼 기둥
      P(b + GAP, b + fr, 0, 2.2 + 0.02, 0.07, M.frame, THIN); // 오른 기둥
      P(a - fl, b + fr, 2.2 + 0.02, 2.2 + 0.02 + hh, 0.09, M.frame, THIN); // 위 틀(문 위로 살짝 더 나온다)
      P(a, b, 0, 0.04, 0.05, M.base, THIN); // 문턱
    } else {
      if (h < 2.4) return;
      P(a - fl, a - GAP, 1.0, 2.0 + 0.02, 0.07, M.frame, THIN);
      P(b + GAP, b + fr, 1.0, 2.0 + 0.02, 0.07, M.frame, THIN);
      P(a - fl, b + fr, 2.0 + 0.02, 2.0 + 0.02 + 0.13, 0.09, M.frame, THIN); // 위 틀
      P(a - fl - 0.05, b + fr + 0.05, 0.93, 1.0 + 0.03, 0.12, M.frame, THIN); // 창턱(양쪽으로 더 나온다)
    }
  });
  // 기단: 문(과 문틀) 자리만 비우고 이어서. 창 아래 벽은 기단이 이어진다
  if (h >= 1.5) {
    const ph = h >= 3 ? 0.4 : h >= 2.4 ? 0.32 : 0.22;
    const IN = 0.012; // 벽 끝면과 같은 평면이면 깜빡인다
    const span = (u0, u1) => { u0 = Math.max(u0, from + IN); u1 = Math.min(u1, to - IN); for (let s = u0; s < u1 - 0.01; s += 36) P(s, Math.min(u1, s + 36), 0, ph, 0.06, M.base, THIN); };
    let a0 = from;
    ops.forEach((op, i) => {
      if (op.type !== 'door' || h < 2.6) return;
      span(a0, op.at - op.w / 2 - fw(solid[i][1] - solid[i][0]));
      a0 = op.at + op.w / 2 + fw(solid[i + 1][1] - solid[i + 1][0]);
    });
    span(a0, to);
  }
  // 머리돌 (벽 윗면 아래 0.1m, 옆으로 0.06m 나온다)
  if (o.cap !== false && h >= 1.0) for (let s = from; s < to - 0.01; s += 36) P(Math.max(from - 0.03, s - 0.03), Math.min(to + 0.03, s + 36 + 0.03), h - 0.1, h + 0.02, 0.06, M.cap, THIN);
  // 기둥: 열린 곳 없이 이어진 긴 구간에 간격을 달리해서
  if (h >= 2.4) solid.forEach(([s0, s1], i) => {
    const l0 = s0 + (i === 0 ? 0 : fw(s1 - s0)) + 0.5, l1 = s1 - (i === solid.length - 1 ? 0 : fw(s1 - s0)) - 0.5, L = l1 - l0;
    if (L < 6.5) return;
    const n = Math.max(1, Math.floor(L / 8));
    for (let k = 1; k <= n; k++) {
      const hj = hash(Math.round(l0 * 10) + k * 13), u = l0 + (L * k) / (n + 1) + (hj - 0.5) * Math.min(2.4, L / (n + 1) * 0.4), w = 0.42 + 0.26 * hash(k * 7 + n);
      P(u - w / 2, u + w / 2, 0, h - 0.1, 0.1, M.pier, SOLID);
    }
  });
  // 벽 끝 기둥: 긴 벽의 자유로운 끝을 마무리 (벽 안쪽으로 0.6m, 길이는 그대로)
  if (h >= 2.4 && to - from >= 8 && o.ends !== false) { P(from + 0.012, from + 0.6, 0, h - 0.1, 0.09, M.pier, SOLID); P(to - 0.6, to - 0.012, 0, h - 0.1, 0.09, M.pier, SOLID); }
}

// ops: { n:[], s:[], e:[], w:[] } — at 은 벽을 따라가는 절대 좌표
export function building(B, cx, cz, w, d, h, mat, ops, roof, plain) {
  const t = 0.3;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const o = plain ? false : { cap: !roof, ends: false };
  wallRun(B, true, z1 - t / 2, x0, x1, h, t, ops.n, mat, o);
  wallRun(B, true, z0 + t / 2, x0, x1, h, t, ops.s, mat, o);
  wallRun(B, false, x1 - t / 2, z0 + t, z1 - t, h, t, ops.e, mat, o);
  wallRun(B, false, x0 + t / 2, z0 + t, z1 - t, h, t, ops.w, mat, o);
  if (roof) B(cx, h, cz, w + 0.6, 0.25, d + 0.6, 'concreteDark');
  if (plain) return;
  const M = TRIM[mat] || TRIM_DEFAULT, q = 0.07, c = t + 2 * q;
  // 모서리 기둥: 바깥·안쪽으로 0.07m 만 나온다
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(cx + sx * (w / 2 - t / 2), 0, cz + sz * (d / 2 - t / 2), c, h, c, M.corner, SOLID);
  if (roof) {
    // 지붕 가장자리: 아래쪽 처마 끝 띠(위쪽 노란 줄은 그대로 보인다) + 윗면 둘레의 낮은 턱
    const W = w + 0.6, Dd = d + 0.6;
    // 지붕 밑면(y=h)과 같은 평면에서 겹치면 천장에 계단 모양으로 비치므로(z-fighting) 지붕 바깥쪽 고리 모양으로만 만든다
    const rim = 0.05;
    for (const sz of [-1, 1]) B(cx, h, cz + sz * (Dd / 2 + rim / 2), W + 2 * rim, 0.07, rim, 'metal', THIN);
    for (const sx of [-1, 1]) B(cx + sx * (W / 2 + rim / 2), h, cz, rim, 0.07, Dd, 'metal', THIN);
    const ph = 0.1, pw = 0.16, y = h + 0.25;
    for (const sz of [-1, 1]) B(cx, y, cz + sz * (Dd / 2 - 0.08 - pw / 2), W - 0.16, ph, pw, 'concrete', THIN);
    for (const sx of [-1, 1]) B(cx + sx * (W / 2 - 0.08 - pw / 2), y, cz, pw, ph, Dd - 0.16 - 2 * pw, 'concrete', THIN);
  }
}

// ───────── 소품 (P2-1): 충돌 박스 하나 + 눈에 보이는 장식(noCollide). 장식은 충돌 박스 밖으로 최대 0.06m 만 나온다 ─────────
// 장식은 이미 있는 재질 키(container+tint · metal · concrete · concreteDark · barrel · sandbag)만 쓴다 → 합쳐진 메쉬 수가 거의 늘지 않는다
const D = { noCollide: true };

export function container(B, x, z, alongX, tint, y = 0) {
  const L = 6.06, W = 2.44, H = 2.59;
  B(x, y, z, alongX ? L : W, H, alongX ? W : L, 'container', { tint }); // 충돌 · 본체
  // u = 길이 방향, v = 폭 방향 (alongX 면 u→x, v→z). 문은 +u 끝
  const P = (u, v, y0, du, h, dv, mat, extra) => {
    if (alongX) B(x + u, y + y0, z + v, du, h, dv, mat, { ...D, ...extra });
    else B(x + v, y + y0, z + u, dv, h, du, mat, { ...D, ...extra });
  };
  const c = { tint };
  for (const su of [-1, 1]) for (const sv of [-1, 1]) P(su * (L / 2 - 0.07), sv * (W / 2 - 0.07), 0, 0.2, H, 0.2, 'metal'); // 모서리 기둥
  for (const sv of [-1, 1]) {
    P(0, sv * (W / 2 - 0.05), H - 0.1, L + 0.06, 0.13, 0.12, 'metal'); // 위 테두리
    P(0, sv * (W / 2 - 0.05), 0, L + 0.06, 0.13, 0.12, 'metal'); // 아래 테두리
  }
  for (const su of [-1, 1]) {
    P(su * (L / 2 - 0.05), 0, H - 0.1, 0.12, 0.13, W + 0.06, 'metal'); // 끝 위 테두리
    P(su * (L / 2 - 0.05), 0, 0, 0.12, 0.13, W + 0.06, 'metal'); // 끝 아래 테두리
  }
  for (const sv of [-1, 1]) for (const u of [-1.9, -0.65, 0.65, 1.9]) P(u, sv * (W / 2 + 0.005), 0.16, 0.08, H - 0.36, 0.05, 'container', c); // 옆면 골(패널 구분)
  // 문(+u 끝): 문틀 가운데 이음 + 잠금 막대 두 개 + 손잡이 판
  const du = L / 2 + 0.03;
  P(du, 0, 0.14, 0.05, H - 0.3, 0.05, 'metal'); // 두 짝 사이 이음
  for (const v of [-0.55, 0.55]) P(du, v, 0.18, 0.06, H - 0.4, 0.05, 'metal'); // 잠금 막대
  for (const v of [-0.55, 0.55]) P(du + 0.01, v, 1.0, 0.07, 0.16, 0.14, 'metal'); // 손잡이
}
export function crate(B, x, z, s, y = 0) { B(x, y, z, s, s, s, 'crate', { fit: true }); }
export function sandbags(B, x, z, len, alongX, h = 1.0) {
  // 충돌: 예전과 같은 보이지 않는 박스 하나. 눈에 보이는 건 가마니 한 개씩(엇갈려 쌓기). 모두 충돌 박스 안쪽
  const W = 0.6;
  B(x, 0, z, alongX ? len : W, h, alongX ? W : len, 'sandbag', { invisible: true });
  const P = (u, y0, du, hh, dd, extra) => {
    if (alongX) B(x + u, y0, z, du, hh, dd, 'sandbag', { ...D, fit: true, ...extra });
    else B(x, y0, z + u, dd, hh, du, 'sandbag', { ...D, fit: true, ...extra });
  };
  const nB = Math.max(1, Math.round(len / 0.65)), bl = len / nB;
  const nC = Math.max(1, Math.round(h / 0.2)), ch = h / nC;
  if (alongX) B(x, 0, z, len - 0.04, h - 0.06, 0.34, 'concreteDark', D); else B(x, 0, z, 0.34, h - 0.06, len - 0.04, 'concreteDark', D); // 속(틈새가 어둡게)
  for (let c = 0; c < nC; c++) {
    const dep = W - 0.025 * c, odd = c % 2 === 1, y0 = c * ch;
    const spans = [];
    if (!odd) for (let i = 0; i < nB; i++) spans.push([-len / 2 + i * bl, bl]);
    else {
      spans.push([-len / 2, bl / 2]);
      for (let i = 0; i < nB - 1; i++) spans.push([-len / 2 + bl / 2 + i * bl, bl]);
      spans.push([len / 2 - bl / 2, bl / 2]);
    }
    spans.forEach(([a, l], i) => {
      const k = ((c * 37 + i * 17) % 7) / 7; // 가마니마다 조금씩 다른 높이 (정해진 값)
      P(a + l / 2, y0, l - 0.02, (ch - 0.015) * (0.93 + 0.07 * k), dep - 0.02 * k, {});
    });
  }
}
export function barrier(B, x, z, alongX) {
  B(x, 0, z, alongX ? 3 : 0.5, 1.05, alongX ? 0.5 : 3, 'concrete'); // 충돌 · 본체
  const P = (u, y0, du, h, dv, mat) => {
    if (alongX) B(x + u, y0, z, du, h, dv, mat, D);
    else B(x, y0, z + u, dv, h, du, mat, D);
  };
  P(0, 0, 3.08, 0.2, 0.62, 'concrete'); // 아래 받침(밑이 넓은 방벽)
  P(0, 0.2, 3.04, 0.05, 0.54, 'concreteDark'); // 받침 위 그늘 줄
  P(0, 1.0, 3.04, 0.08, 0.42, 'concreteDark'); // 위 모서리 덮개
  for (const su of [-1, 1]) P(su * 1.42, 0.25, 0.2, 0.75, 0.55, 'concrete'); // 양 끝 기둥(보강)
  P(0, 0.62, 2.7, 0.05, 0.54, 'concreteDark'); // 가운데 가로 홈
  P(0, 0.25, 0.05, 0.75, 0.54, 'concreteDark'); // 세로 이음
}
export function barrel(B, x, z, tint) {
  B(x, 0, z, 0.6, 0.9, 0.6, 'barrel', { shape: 'cyl', tint }); // 충돌 · 본체
  const R = (y0, w, h) => B(x, y0, z, w, h, w, 'metal', { ...D, shape: 'cyl' });
  R(0, 0.63, 0.05); // 아래 테
  R(0.2, 0.63, 0.05); R(0.6, 0.63, 0.05); // 가운데 철띠 두 줄
  R(0.86, 0.64, 0.06); // 위 테(림)
  R(0.9, 0.48, 0.02); // 뚜껑
}

export function tower(B, x, z) {
  const top = 3.2;
  B(x, top - 0.2, z, 4, 0.2, 4, 'wood');
  for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
    B(x + dx, 0, z + dz, 0.25, top - 0.2, 0.25, 'wood');
    B(x + dx, top, z + dz, 0.12, 2.1, 0.12, 'wood');
  }
  B(x, top + 2.1, z, 4.6, 0.12, 4.6, 'metal');
  // 난간
  B(x, top, z - 1.94, 4, 1.0, 0.12, 'wood');
  B(x, top, z + 1.94, 4, 1.0, 0.12, 'wood');
  B(x + 1.94, top, z, 0.12, 1.0, 3.76, 'wood');
  B(x - 1.94, top, z - 1.25, 0.12, 1.0, 1.26, 'wood');
  B(x - 1.94, top, z + 1.25, 0.12, 1.0, 1.26, 'wood');
  // 계단 (서쪽에서 올라옴)
  const n = 10, rise = top / n, run = 0.45;
  for (let i = 0; i < n; i++) {
    const sx = x - 2 - run * n + run * (i + 0.5);
    B(sx, rise * (i + 1) - 0.12, z, run, 0.12, 1.2, 'wood');
  }
}


// 박스 목록 → 충돌용 AABB 목록까지 묶어서 맵 배치 완성
export function finishLayout(boxes, trees) {
  for (const t of trees) boxes.push({ x: t.x, y: 0, z: t.z, w: 0.5 * t.s, h: 5 * t.s, d: 0.5 * t.s, mat: 'none', invisible: true });
  const colliders = boxes.filter(b => !b.noCollide).map(b => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minY: b.y, maxY: b.y + b.h,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    ...(b.ramp ? { ramp: b.ramp } : {}), // 경사로: 윗면이 기울어진 쐐기 (shared/collision.js)
  }));
  return { boxes, trees, colliders };
}
