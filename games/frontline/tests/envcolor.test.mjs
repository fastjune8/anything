// 환경 색 가드 (서버·브라우저 없이, 1초 미만): outpost 의 환경 색이 팀 색과 헷갈리지 않는지 검사한다.
//  - 팀 색은 코드(client/js/remotes.js 의 제복, client/js/objective.js 의 거점·HUD)에서 읽는다. 값을 따로 복사해 두지 않는다.
//  - 오류: 파랑·빨강 색조(채도 30% 이상)이거나, 팀 색과 색 차이(ΔE76)가 15 미만
//  - 주의(실패 아님): 색 차이 30 미만 → 화면 캡처로 확인할 대상
// 기준 근거: docs/ENV_ART_BIBLE.md 5.2, docs/ENV_ART_ANALYSIS.md 6.2
import fs from 'node:fs';
import { check, failed } from './helpers.mjs';
import looks from '../content/looks.json' with { type: 'json' };
import outpost from '../content/maps/outpost.json' with { type: 'json' };
import { buildLayout } from '../shared/maps/build.js';

const ERR_DE = 15, WARN_DE = 30, RESERVED_MIN_SAT = 30, DARK_V = 30;
const src = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const hexOf = n => '#' + n.toString(16).padStart(6, '0');

// ── 팀 색 (코드에서 읽는다) ──
const remotes = src('client/js/remotes.js').match(/const TEAM_COLORS = \{ ally: \[(0x[0-9a-fA-F]{6}), (0x[0-9a-fA-F]{6})\], foe: \[(0x[0-9a-fA-F]{6}), (0x[0-9a-fA-F]{6})\] \}/);
const objective = src('client/js/objective.js').match(/export const COLORS = \{ a: (0x[0-9a-fA-F]{6}), e: (0x[0-9a-fA-F]{6})/);
check(!!remotes && !!objective, '팀 색 정의를 코드에서 찾는다 (remotes.js TEAM_COLORS, objective.js COLORS)');
if (!remotes || !objective) process.exit(1);
const TEAM = {
  '아군 제복': hexOf(+remotes[1]), '아군 조끼': hexOf(+remotes[2]), '적 제복': hexOf(+remotes[3]), '적 조끼': hexOf(+remotes[4]),
  'HUD 아군': hexOf(+objective[1]), 'HUD 적': hexOf(+objective[2]),
};
check(TEAM['아군 제복'] === '#3f5f8a' && TEAM['적 제복'] === '#8a3d35', '아군·적 제복 색은 바뀌지 않았다 (#3f5f8a / #8a3d35)');

// ── 색 계산 ──
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function lab(h) {
  const [r, g, b] = rgb(h).map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
function hsv(h) {
  const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let H = 0;
  if (d) H = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { H: (H + 360) % 360, S: mx ? (d / mx) * 100 : 0, V: mx * 100 };
}
const reserved = h => { const { H, S } = hsv(h); return S >= RESERVED_MIN_SAT && ((H >= 190 && H <= 235) || H >= 340 || H <= 20); };

// ── outpost 가 쓰는 환경 색 모으기: 분위기(look)의 재질 색 + 실제 맵 박스(buildLayout)의 tint ──
// 맵 JSON 의 tint 만 보면 parts.js · build.js 의 기본 색(예: 드럼통)을 놓친다 → 펼친 결과를 본다
const look = looks.find(l => l.id === (outpost.look || looks[0].id));
const layout = buildLayout(outpost);
const env = new Map(); // 색 → 어디서 쓰는지
const add = (hex, where) => {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex) || hex.toLowerCase() === '#ffffff') return; // 흰 바탕(tint 로 색이 정해지는 재질)은 건너뛴다
  const k = hex.toLowerCase(); env.set(k, [...(env.get(k) || []), where]);
};
for (const [name, m] of Object.entries(look.materials)) for (const key of ['base', 'line', 'accent', 'trim']) add(m[key], `${look.id}.${name}.${key}`);
for (const b of layout.boxes) if (b.tint !== undefined) add(hexOf(b.tint), `layout ${b.mat}.tint`);
check(layout.boxes.some(b => b.mat === 'barrel' && b.tint !== undefined), '드럼통 박스에 (기본값 포함) tint 가 들어 있다');

// ── 환경 재질끼리 구분 (땅·벽돌·나무·모래주머니·콘크리트·금속) ──
const M = look.materials, mb = n => M[n].base;
const sep = (a, b, min) => check(dE(mb(a), mb(b)) >= min, `${a} ↔ ${b} 색이 구분된다 (ΔE ${dE(mb(a), mb(b)).toFixed(0)} ≥ ${min})`);
sep('brick', 'ground', 18); sep('wood', 'ground', 20); sep('sandbag', 'ground', 15); sep('concrete', 'ground', 12);
sep('metal', 'ground', 12); sep('brick', 'wood', 20); sep('sandbag', 'concrete', 20);

// ── 장식은 충돌에 끼지 않는다: 충돌 박스는 noCollide 가 아닌 것만, 보이지 않는 박스는 모래주머니 속뼈대·나무뿐 ──
check(layout.colliders.length === layout.boxes.filter(b => !b.noCollide).length, '충돌 박스 = noCollide 가 아닌 박스');
check(layout.boxes.filter(b => b.invisible).every(b => b.mat === 'sandbag' || b.mat === 'none'), '보이지 않는 박스는 모래주머니 충돌체·나무뿐이다');
check(layout.colliders.length === 233, `outpost 충돌 박스 수 233 유지 (${layout.colliders.length})`);
check(env.size > 10, `검사할 환경 색 ${env.size}개를 모았다`);

let warnings = 0;
for (const [hex, where] of [...env].sort()) {
  const { H, S, V } = hsv(hex);
  const near = Object.entries(TEAM).map(([n, t]) => [n, dE(hex, t)]).sort((a, b) => a[1] - b[1])[0];
  const label = `${hex} (H${H.toFixed(0)} S${S.toFixed(0)} V${V.toFixed(0)}) ${[...new Set(where)].slice(0, 2).join(', ')}${where.length > 2 ? ` 외 ${where.length - 2}` : ''}`;
  check(!reserved(hex), `${label}: 파랑·빨강 색조(채도 ${RESERVED_MIN_SAT}%↑)가 아니다`);
  if (V < DARK_V) continue; // 검정에 가까운 이음새·줄무늬(명도 30% 미만)는 면 색이 아니라 팀 색(어두운 조끼 포함)과 비교하지 않는다
  check(near[1] >= ERR_DE, `${label}: 팀 색과 구분된다 (가장 가까운 ${near[0]}, ΔE ${near[1].toFixed(0)})`);
  if (near[1] < WARN_DE && near[1] >= ERR_DE) { warnings++; console.log(`  ! 주의: ${hex} 는 ${near[0]} 와 ΔE ${near[1].toFixed(0)} — 화면에서 확인`); }
}
console.log(`  (주의 ${warnings}건 — 실패 아님)`);

process.exit(failed() ? 1 : 0);
