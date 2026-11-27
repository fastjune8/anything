#!/usr/bin/env node
// 옷 GLB 검증기 (Blender 없이, 파일만 보고). 모델러가 새 옷을 내보낸 뒤 게임에 넣기 전에 돌린다.
//   node tools/validate_garment.mjs content/wearables/x_v_1.glb --slot upper [--fp] [--json]
//   node tools/validate_garment.mjs --item tactical_jacket_001            (cosmetics.json 의 tp/fp 둘 다)
//   node tools/validate_garment.mjs --all                                  (cosmetics.json 의 모든 옷)
// 종료 코드: fail 이 하나라도 있으면 1.   규칙: docs/GARMENT_ASSET_SPEC.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COLOR_SLOTS = ['fabric', 'fabric2', 'leather', 'metal', 'accent', 'team', 'core', 'hair'];
export const BUDGET = { upper: 5000, lower: 4000, head: 2500, hair: 2500, hands: 2000, feet: 2000, back: 2500, waist: 2500, acc1: 1000, acc2: 1000, fp: 3500 };
export const BODY = { tp: 'content/characters/hyperfps_thirdperson_v_8.glb', fp: 'content/characters/hyperfps_viewmodel_v_7.glb' };
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('GLB 가 아닙니다 (매직 글자 없음)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('GLB 버전 2 만 지원합니다');
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4); const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8')); else if (type === 0x004e4942 && !bin) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB 에 JSON 조각이 없습니다');
  return { json, bin: bin || Buffer.alloc(0) };
}

// 접근자(accessor) → 평평한 TypedArray (stride·normalized 처리, sparse 는 지원 안 함)
export function readAccessor(g, i) {
  const a = g.json.accessors[i]; if (a.sparse) throw new Error('sparse accessor 는 지원하지 않습니다');
  const [T, sz] = CT[a.componentType], n = NCOMP[a.type], bv = g.json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || sz * n, out = new T(a.count * n);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = sz === 1 ? dv[get](base + k * stride + c) : dv[get](base + k * stride + c * sz, true);
  if (a.normalized && a.componentType !== 5126) { const mx = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType]; const f = new Float32Array(out.length); for (let k = 0; k < out.length; k++) f[k] = Math.max(out[k] / mx, -1); return f; }
  return out;
}

const nodeName = (g, i) => g.json.nodes[i].name;
export const jointNames = g => (g.json.skins && g.json.skins[0] ? g.json.skins[0].joints.map(j => nodeName(g, j)) : []);

// 이 GLB 의 메시 primitive 들 (월드 변환 없이 그대로: 스킨 메시는 바인드 공간 좌표)
function prims(g) { const out = []; for (const m of g.json.meshes || []) for (const p of m.primitives) out.push(p); return out; }

class BodyGrid {                                   // 몸 정점 격자 (가장 가까운 정점의 부호 있는 거리)
  constructor(pos, nor, cell = 0.05) {
    this.pos = pos; this.nor = nor; this.cell = cell; this.map = new Map();
    for (let i = 0; i < pos.length / 3; i++) { const k = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); (this.map.get(k) || this.map.set(k, []).get(k)).push(i); }
  }
  key(x, y, z) { const c = this.cell; return `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`; }
  nearest(x, y, z) {
    const c = this.cell, ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c); let best = -1, bd = 1e9;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const l = this.map.get(`${ix + dx},${iy + dy},${iz + dz}`); if (!l) continue;
        for (const i of l) { const ex = this.pos[i * 3] - x, ey = this.pos[i * 3 + 1] - y, ez = this.pos[i * 3 + 2] - z, d = ex * ex + ey * ey + ez * ez; if (d < bd) { bd = d; best = i; } }
      }
    }
    if (best < 0) return null;
    const i = best, nx = this.nor[i * 3], ny = this.nor[i * 3 + 1], nz = this.nor[i * 3 + 2];
    return { dist: Math.sqrt(bd), signed: (x - this.pos[i * 3]) * nx + (y - this.pos[i * 3 + 1]) * ny + (z - this.pos[i * 3 + 2]) * nz };
  }
}
const bodyCache = new Map();
export function loadBody(view, root = ROOT) {
  if (!bodyCache.has(view + root)) {
    const g = parseGlb(fs.readFileSync(path.join(root, BODY[view]))); const p = prims(g)[0];
    bodyCache.set(view + root, { g, joints: jointNames(g), grid: null, p });
  }
  const b = bodyCache.get(view + root);
  if (!b.grid) { const pos = [], nor = []; for (const p of prims(b.g)) { pos.push(...readAccessor(b.g, p.attributes.POSITION)); nor.push(...readAccessor(b.g, p.attributes.NORMAL)); } b.grid = new BodyGrid(Float32Array.from(pos), Float32Array.from(nor)); b.ibm = b.g.json.skins ? readAccessor(b.g, b.g.json.skins[0].inverseBindMatrices) : null; }
  return b;
}

/**
 * 한 옷 GLB 를 검사한다.
 * @param {{json,bin}} g parseGlb 결과
 * @param {{slot:string, fp?:boolean, mount?:'skin'|{bone:string}, root?:string, regionsOnly?:boolean}} o
 * @returns {{issues:{level:'fail'|'warn'|'info', rule:string, text:string}[], stats:object}}
 */
export function validateGarment(g, o) {
  const issues = [], add = (level, rule, text) => issues.push({ level, rule, text });
  const view = o.fp ? 'fp' : 'tp', body = loadBody(view, o.root || ROOT), j = g.json, stats = {};
  const mount = o.mount || 'skin';
  // ── 파일 구성
  if (j.animations && j.animations.length) add('fail', 'no-animations', `애니메이션 ${j.animations.length}개가 들어 있다 (옷 GLB 에는 없어야 한다)`);
  if (j.textures && j.textures.length) add('fail', 'no-textures', '텍스처가 들어 있다 (색은 팔레트가 정한다)');
  if (j.cameras || (j.extensions && j.extensions.KHR_lights_punctual)) add('warn', 'no-extras', '카메라/조명이 들어 있다');
  const mats = (j.materials || []).map(m => m.name.replace(/\.\d+$/, ''));
  const badMats = mats.filter(m => !COLOR_SLOTS.includes(m));
  if (!mats.length) add('fail', 'materials', '재질이 없다 (재질 이름 = 색 칸)');
  if (badMats.length) add('fail', 'materials', `색 칸이 아닌 재질 이름: ${[...new Set(badMats)].join(', ')} (허용: ${COLOR_SLOTS.join(' ')})`);
  const ps = prims(g);
  if (!ps.length) { add('fail', 'mesh', '메시가 없다'); return { issues, stats }; }
  // ── 삼각형 예산
  let tris = 0; for (const p of ps) tris += p.indices !== undefined ? j.accessors[p.indices].count / 3 : j.accessors[p.attributes.POSITION].count / 3;
  const cap = o.fp ? BUDGET.fp : BUDGET[o.slot]; stats.tris = tris; stats.budget = cap;
  if (!cap) add('fail', 'slot', `알 수 없는 슬롯 ${o.slot}`); else if (tris > cap) add('fail', 'budget', `삼각형 ${tris} > 예산 ${cap}`);
  // ── 물체 수 (한 아이템 = 메시 하나 = draw call 하나)
  const meshNodes = j.nodes.filter(n => n.mesh !== undefined).length; stats.meshNodes = meshNodes;
  if (meshNodes > 1) add('warn', 'one-mesh', `메시 노드가 ${meshNodes}개 (아이템 하나는 메시 하나로 합친다: 그려 내기 호출이 늘어난다)`);
  // ── 뼈대 / 스킨
  if (mount === 'skin') {
    if (!j.skins || !j.skins.length) { add('fail', 'skin', '스킨(뼈대)이 없다 — 아마추어를 같이 선택하고 내보낸다'); return { issues, stats }; }
    if (j.skins.length > 1) add('warn', 'skin', `스킨이 ${j.skins.length}개 (첫 번째만 쓴다)`);
    const joints = jointNames(g); stats.joints = joints.length;
    const missing = joints.filter(n => !body.joints.includes(n));
    if (missing.length) add('fail', 'skeleton', `캐릭터에 없는 뼈: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''} (새 뼈를 만들지 않는다)`);
    const same = joints.length === body.joints.length && joints.every((n, i) => n === body.joints[i]);
    stats.sameJointOrder = same;
    if (!same && !missing.length) add('info', 'skeleton', `뼈 목록이 몸과 다르다 (${joints.length}/${body.joints.length}) — 이름으로 묶이므로 입혀지지만 몸의 Skeleton 을 공유하지 못해 뼈 행렬 계산이 따로 돈다`);
    // 역바인드 행렬: 이름이 같은 뼈끼리 몸과 같아야 한다 (다르면 옷이 다른 자세로 만들어진 것)
    const ibm = readAccessor(g, j.skins[0].inverseBindMatrices); let badIbm = 0;
    joints.forEach((n, i) => { const bi = body.joints.indexOf(n); if (bi < 0) return; for (let k = 0; k < 16; k++) if (Math.abs(ibm[i * 16 + k] - body.ibm[bi * 16 + k]) > 1e-3) { badIbm++; break; } });
    if (badIbm) add('fail', 'bind-pose', `역바인드 행렬이 몸과 다른 뼈 ${badIbm}개 — 옷이 몸의 기준 자세(REST)와 다른 자세에서 내보내졌다`);
    // 가중치
    let nv = 0, over = 0, zero = 0, unnorm = 0, oob = 0, nondef = 0;
    for (const p of ps) {
      if (p.attributes.JOINTS_0 === undefined || p.attributes.WEIGHTS_0 === undefined) { add('fail', 'weights', 'JOINTS_0/WEIGHTS_0 가 없다 (스킨 가중치 없음)'); continue; }
      if (p.attributes.JOINTS_1 !== undefined) over++;
      const J = readAccessor(g, p.attributes.JOINTS_0), Wt = readAccessor(g, p.attributes.WEIGHTS_0), n = J.length / 4;
      for (let v = 0; v < n; v++) {
        nv++; let sum = 0, inf = 0;
        for (let k = 0; k < 4; k++) { const w = Wt[v * 4 + k]; if (w > 1e-4) { sum += w; inf++; if (J[v * 4 + k] >= joints.length) oob++; } }
        if (!inf) zero++; else if (Math.abs(sum - 1) > 0.02) unnorm++;
      }
    }
    stats.verts = nv;
    if (over) add('fail', 'weights', '정점당 영향 뼈가 4개를 넘는다 (JOINTS_1 존재) — Limit Total 4');
    if (zero) add('fail', 'weights', `가중치가 없는 정점 ${zero}/${nv}`);
    if (unnorm) add('fail', 'weights', `가중치 합이 1이 아닌 정점 ${unnorm}/${nv} (Normalize All)`);
    if (oob) add('fail', 'weights', `뼈 번호가 범위를 벗어난 정점 ${oob}`);
  } else {
    const parent = j.nodes.findIndex(n => (n.children || []).some(c => j.nodes[c].mesh !== undefined));
    if (parent < 0 || j.nodes[parent].name !== mount.bone) add('fail', 'mount', `단단한 물건은 뼈 ${mount.bone} 에 붙어 있어야 한다 (지금 ${parent < 0 ? '없음' : j.nodes[parent].name})`);
  }
  // ── 정점 데이터: 좌표·법선·면 방향·몸과의 간격
  const grid = body.grid; let bad = 0, nTot = 0, inside = 0, tight = 0, minD = 1e9, inward = 0, faces = 0, flat = 0;
  const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const p of ps) {
    const P = readAccessor(g, p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? readAccessor(g, p.attributes.NORMAL) : null;
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; nTot++;
      if (!Number.isFinite(x + y + z)) { bad++; continue; }
      for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], P[v * 3 + k]); bb[k + 3] = Math.max(bb[k + 3], P[v * 3 + k]); }
      if (mount === 'skin' && !o.skipClearance) { const h = grid.nearest(x, y, z); if (h) { if (h.signed < 0) inside++; if (h.signed < 0.003) tight++; minD = Math.min(minD, h.signed); } }
    }
    if (!N) { add('fail', 'normals', '법선(NORMAL)이 없다'); continue; }
    if (p.indices !== undefined && mount === 'skin') {
      const I = readAccessor(g, p.indices);
      for (let f = 0; f < I.length; f += 3) {
        const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, len = Math.hypot(nx, ny, nz); faces++;
        if (len < 1e-10) { flat++; continue; }
        const dot = (nx * (N[a] + N[b] + N[c]) + ny * (N[a + 1] + N[b + 1] + N[c + 1]) + nz * (N[a + 2] + N[b + 2] + N[c + 2])) / len;
        if (dot < 0) inward++;                    // 면이 감긴 방향과 저장된 법선이 반대 = 뒤집힌 면 (게임에서 안 보이거나 어둡게 보인다)
      }
    }
  }
  stats.bbox = bb.map(x => +x.toFixed(3)); stats.verts = nTot;
  if (bad) add('fail', 'geometry', `좌표가 NaN/무한대인 정점 ${bad}`);
  if (flat) add('warn', 'geometry', `넓이가 0인 삼각형 ${flat}/${faces}`);
  if (faces && inward / faces > 0.02) add('fail', 'winding', `감긴 방향과 법선이 반대인 면 ${inward}/${faces} (${(100 * inward / faces).toFixed(1)}%) — 법선을 뒤집는다 (Blender: Shift+N)`);
  else if (inward) add('warn', 'winding', `감긴 방향과 법선이 반대인 면 ${inward}/${faces}`);
  // 몸 크기와 비교
  const bg = body.g, bp = prims(bg).flatMap(p => [bg.json.accessors[p.attributes.POSITION]]); const bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
  for (const a of bp) for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], a.min[k]); bmax[k] = Math.max(bmax[k], a.max[k]); }
  const sz = k => bb[k + 3] - bb[k], bsz = k => bmax[k] - bmin[k];
  if ([0, 1, 2].some(k => sz(k) > bsz(k) * 1.4 + 0.05)) add('fail', 'scale', `옷 크기 ${[0, 1, 2].map(k => sz(k).toFixed(2))} m 가 몸 ${[0, 1, 2].map(k => bsz(k).toFixed(2))} m 보다 너무 크다 (단위/스케일 확인)`);
  if (mount === 'skin' && !o.skipClearance && nTot) {
    stats.clearance = { min_mm: +(minD * 1000).toFixed(1), inside, tight, of: nTot };
    if (inside / nTot > 0.01) add('fail', 'clearance', `몸 안쪽으로 들어간 정점 ${inside}/${nTot} (${(100 * inside / nTot).toFixed(1)}%, 최소 ${(minD * 1000).toFixed(1)} mm)`);
    else if (inside) add('warn', 'clearance', `몸 안쪽으로 들어간 정점 ${inside}/${nTot} (최소 ${(minD * 1000).toFixed(1)} mm)`);
    if (tight / nTot > 0.10) add('warn', 'clearance', `몸과 3 mm 미만인 정점 ${tight}/${nTot} (깜빡임(z-fighting) 위험)`);
  }
  return { issues, stats };
}

export const failsOf = r => r.issues.filter(i => i.level === 'fail');

// ── CLI
async function main() {
  const args = process.argv.slice(2), flag = n => args.includes(n), val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const jobs = [];
  const cos = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/cosmetics.json'), 'utf8'));
  const addItem = it => { for (const [view, rel] of [['tp', it.tp], ['fp', it.fp]]) if (rel) jobs.push({ file: path.join(ROOT, 'content', rel), slot: it.slot, fp: view === 'fp', mount: it.mount, label: `${it.id} ${view}` }); };
  if (flag('--all')) cos.items.forEach(addItem);
  else if (val('--item')) { const it = cos.items.find(i => i.id === val('--item')); if (!it) { console.error(`cosmetics.json 에 ${val('--item')} 이(가) 없다`); process.exit(2); } addItem(it); }
  else {
    const f = args.find(a => a.endsWith('.glb')); if (!f || !val('--slot')) { console.error('사용: validate_garment.mjs <파일.glb> --slot <슬롯> [--fp] [--bone <뼈이름>] | --item <id> | --all  [--json]'); process.exit(2); }
    jobs.push({ file: path.resolve(f), slot: val('--slot'), fp: flag('--fp'), mount: val('--bone') ? { bone: val('--bone') } : 'skin', label: path.basename(f) });
  }
  let failed = 0; const all = [];
  for (const jb of jobs) {
    let r; try { r = validateGarment(parseGlb(fs.readFileSync(jb.file)), jb); } catch (e) { r = { issues: [{ level: 'fail', rule: 'read', text: e.message }], stats: {} }; }
    all.push({ label: jb.label, ...r }); const fl = failsOf(r).length; failed += fl;
    if (!flag('--json')) {
      console.log(`${fl ? '✗' : '✓'} ${jb.label}  삼각형 ${r.stats.tris ?? '?'}/${r.stats.budget ?? '?'}${r.stats.clearance ? ` · 몸과 최소 ${r.stats.clearance.min_mm} mm` : ''}`);
      for (const i of r.issues) console.log(`    [${i.level}] ${i.rule}: ${i.text}`);
    }
  }
  if (flag('--json')) console.log(JSON.stringify(all, null, 1));
  process.exit(failed ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
