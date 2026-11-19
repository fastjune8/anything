// 미니맵 (기획 9.2~9.4): 늘 보이는 작은 원형 지도(내 시선이 위) + 단축키(M)로 여는 전술 지도(게임은 멈추지 않는다).
//   보이는 것: 아군 위치 · 거점 위치/소유/경합 · 적이 낸 소리의 "대략적인 방향" (정확한 적 좌표는 절대 그리지 않는다)
//   소리 표시: 처음 들린 순간 짧은 펄스 → 같은 소리가 이어지면 그 아이콘을 갱신 → 멈추면 천천히 사라진다.
import { getMap } from '/shared/maps/index.js';
import { currentMap } from './scene.js';
import { remotes } from './remotes.js';
import { me, game, inp, isAlly } from './state.js';
import { $, MODE_CFG } from './util.js';

const mini = $('minimap'), mctx = mini.getContext('2d');
const tac = $('tactical'), tctx = tac.getContext('2d');
const SIZE = mini.width, R = SIZE / 2, VIEW_M = 38, K = R / VIEW_M;
const TEAM = { a: '#5aa9ff', e: '#ff4b3a', n: '#e9ecef' };
const teamCss = t => (t < 0 ? 'n' : t === me.team ? 'a' : 'e');

// 맵 배경 (한 번만 그린다)
const bgCache = new Map(), BG_PX = 4;
function background(id) {
  if (bgCache.has(id)) return bgCache.get(id);
  const map = getMap(id), half = map.half, side = Math.ceil(half * 2 * BG_PX);
  const c = document.createElement('canvas'); c.width = c.height = side;
  const g = c.getContext('2d');
  g.fillStyle = '#1b221f'; g.fillRect(0, 0, side, side);
  const rect = (b, color) => { g.fillStyle = color; g.fillRect((b.minX + half) * BG_PX, (b.minZ + half) * BG_PX, (b.maxX - b.minX) * BG_PX, (b.maxZ - b.minZ) * BG_PX); };
  for (const b of map.layout.colliders) if (b.minY >= 2.2) rect(b, 'rgba(226,218,180,0.18)');
  for (const b of map.layout.colliders) if (b.minY < 2.2 && b.maxY > 0.5) rect(b, '#cfc8a4');
  const out = { c, half };
  bgCache.set(id, out);
  return out;
}

// ───── 소리 (서버가 들을 수 있는 적의 소리만 보낸다: { s: 소리 주인 표시용 번호, k: 종류, b: 방향, w: 세기 1~3 }) ─────
const pings = new Map();
const HOLD = 1.2, FADE = 1.6;
export function onSound(m) {
  const now = performance.now() / 1000, p = pings.get(m.s);
  if (p) { p.b = m.b; p.w = Math.max(m.w, p.w * 0.6); p.t = now; p.k = m.k; }
  else pings.set(m.s, { b: m.b, w: m.w, k: m.k, t: now, first: now });
}
export function clearSounds() { pings.clear(); }
export const lastStats = { allies: 0, pings: 0 };

function drawPings(g, cx, cy, rad, toScreen, now) {
  let n = 0;
  for (const [key, p] of pings) {
    const age = now - p.t;
    if (age > HOLD + FADE) { pings.delete(key); continue; }
    const a = age < HOLD ? 1 : 1 - (age - HOLD) / FADE;
    const [ux, uy] = toScreen(Math.sin(p.b), Math.cos(p.b)); // 방향만 (거리 없음)
    const r = rad * (p.w >= 3 ? 0.55 : p.w === 2 ? 0.72 : 0.86);
    const x = cx + ux * r, y = cy + uy * r, ang = Math.atan2(uy, ux);
    g.save(); g.globalAlpha = a;
    g.fillStyle = p.k === 'fire' ? '#ff6a4a' : '#ffb43a';
    g.beginPath(); g.arc(cx, cy, r, ang - 0.16, ang + 0.16); g.arc(cx, cy, r - 7, ang + 0.16, ang - 0.16, true); g.closePath(); g.fill();
    const pulse = now - p.first;
    if (pulse < 0.5) { g.globalAlpha = (1 - pulse / 0.5) * a; g.strokeStyle = g.fillStyle; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 4 + pulse * 26, 0, Math.PI * 2); g.stroke(); }
    g.restore(); n++;
  }
  return n;
}
function drawPoints(g, toXY, scale) {
  const pts = game.dom && game.dom.pts;
  game.zones.forEach((z, i) => {
    const [x, y] = toXY(z.x, z.z), st = pts ? pts[i] : [-1, -1, 0, 0];
    g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(x, y, Math.max(7, z.r * scale), 0, Math.PI * 2); g.fill();
    g.strokeStyle = st[3] ? '#ffffff' : TEAM[teamCss(st[0])]; g.lineWidth = st[3] ? 3 : 2; g.stroke();
    g.fillStyle = TEAM[teamCss(st[0])]; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(z.id, x, y + 0.5);
  });
}
function drawAllies(g, toXY, arrow) {
  let n = 0;
  if (!MODE_CFG.teams) return 0;
  for (const r of remotes.values()) {
    if (!r.alive || !r.hasPos || !isAlly(r.team)) continue;
    const [x, y] = toXY(r.pos.x, r.pos.z);
    g.fillStyle = TEAM.a; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); n++;
    if (arrow) { g.fillStyle = '#e9ecef'; g.font = '10px sans-serif'; g.textAlign = 'center'; g.fillText(r.name, x, y - 8); }
  }
  return n;
}

export function updateMinimap() {
  if (!currentMap) return;
  const bg = background(currentMap), now = performance.now() / 1000;
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw), fx = -sy, fz = -cy, rx = cy, rz = -sy;
  const mx = me.pos.x, mz = me.pos.z;
  // 작은 지도: 시선이 위
  const g = mctx;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, SIZE, SIZE);
  g.save(); g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#141a18'; g.fillRect(0, 0, SIZE, SIZE);
  g.setTransform(K * rx, -K * fx, K * rz, -K * fz, R - K * (rx * mx + rz * mz), R + K * (fx * mx + fz * mz));
  g.globalAlpha = 0.85; g.drawImage(bg.c, -bg.half, -bg.half, bg.half * 2, bg.half * 2); g.globalAlpha = 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const toXY = (x, z) => { const dx = x - mx, dz = z - mz; return [R + (dx * rx + dz * rz) * K, R - (dx * fx + dz * fz) * K]; };
  drawPoints(g, toXY, K);
  lastStats.allies = drawAllies(g, toXY, false);
  lastStats.pings = drawPings(g, R, R, R - 4, (dx, dz) => [dx * rx + dz * rz, -(dx * fx + dz * fz)], now);
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(R, R - 7); g.lineTo(R + 5, R + 5); g.lineTo(R - 5, R + 5); g.closePath(); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();

  // 전술 지도: 우리 진영이 아래 (게임은 계속 진행)
  tac.style.display = inp.tactical ? 'block' : 'none';
  if (!inp.tactical) return;
  const W = tac.width = Math.min(innerWidth, innerHeight) * 0.8 | 0, H = tac.height = W, half = bg.half, k = W / (half * 2);
  const flip = me.team === 1 ? -1 : 1; // 0팀은 z+ 가 진영 → 아래로
  const T = (x, z) => [W / 2 + x * k * flip, H / 2 + z * k * flip];
  const t = tctx;
  t.fillStyle = 'rgba(10,12,12,.88)'; t.fillRect(0, 0, W, H);
  t.save(); t.translate(W / 2, H / 2); t.scale(flip, flip); t.drawImage(bg.c, -W / 2, -H / 2, W, H); t.restore();
  drawPoints(t, T, k);
  drawAllies(t, T, true);
  const [px, py] = T(mx, mz);
  drawPings(t, px, py, Math.min(W, H) * 0.12, (dx, dz) => [dx * flip, dz * flip], now);
  t.save(); t.translate(px, py); t.rotate(Math.atan2(fx * flip, -fz * flip)); t.fillStyle = '#fff'; t.beginPath(); t.moveTo(0, -9); t.lineTo(6, 6); t.lineTo(-6, 6); t.closePath(); t.fill(); t.restore();
  t.fillStyle = '#e9ecef'; t.font = '13px sans-serif'; t.textAlign = 'left'; t.fillText('전술 지도 (M) · 주황 표시 = 적이 낸 소리의 방향', 12, 20);
}
