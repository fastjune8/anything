// 미니맵: 내 시선이 위쪽이 되도록 회전하는 원형 지도.
//  - 지도 배경은 맵마다 한 번만 그려 두고(오프스크린), 매 프레임 회전·이동해서 오려 낸다.
//  - 아군(팀전)은 항상, 적은 총을 쏜 직후 2초 동안만 보인다 (벽 너머를 계속 알 수 있으면 치트와 같다).
import { getMap } from '/shared/maps/index.js';
import { currentMap } from './scene.js';
import { remotes } from './remotes.js';
import { me, game, isAlly } from './state.js';
import { $ } from './util.js';
import { inMini, enemyVisible, toMini } from './minimath.js';
import { currentZone, sideOfTeam, CSS } from './objective.js';

const canvas = $('minimap');
const ctx = canvas.getContext('2d');
const SIZE = canvas.width, R = SIZE / 2;
const VIEW_M = 38;                 // 가운데에서 가장자리까지 보이는 거리 (m)
const K = R / VIEW_M;              // 1m 당 픽셀

// 맵 배경 (맵 id 별로 캐시)
const bgCache = new Map();
const BG_PX = 4;                   // 배경 이미지의 1m 당 픽셀
function backgroundFor(id) {
  if (bgCache.has(id)) return bgCache.get(id);
  const map = getMap(id), half = map.half, side = Math.ceil(half * 2 * BG_PX);
  const c = document.createElement('canvas'); c.width = c.height = side;
  const g = c.getContext('2d');
  g.fillStyle = '#1c2420'; g.fillRect(0, 0, side, side);
  const rect = (b, color) => { g.fillStyle = color; g.fillRect((b.minX + half) * BG_PX, (b.minZ + half) * BG_PX, (b.maxX - b.minX) * BG_PX, (b.maxZ - b.minZ) * BG_PX); };
  // 지붕 등 높은 곳은 흐리게, 몸을 막는 구조물은 진하게 (참고 이미지처럼 밝은 박스)
  for (const b of map.layout.colliders) if (b.minY >= 2.2) rect(b, 'rgba(226,218,180,0.22)');
  for (const b of map.layout.colliders) if (b.minY < 2.2 && b.maxY > 0.5) rect(b, '#d9d2ad');
  bgCache.set(id, c);
  return c;
}

export const lastStats = { allies: 0, enemies: 0 }; // 마지막으로 그린 점 개수 (테스트/디버그용)

export function updateMinimap() {
  const now = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#0d1210'; ctx.fillRect(0, 0, SIZE, SIZE);

  // 지도: 내 위치가 중심, 내 시선이 위쪽
  const half = getMap(currentMap).half, bg = backgroundFor(currentMap);
  ctx.translate(R, R); ctx.rotate(me.yaw); ctx.scale(K, K); ctx.translate(-me.pos.x, -me.pos.z);
  ctx.drawImage(bg, -half, -half, half * 2, half * 2);
  ctx.restore();

  // 점령전 거점: 주인 팀 색 원 + 글자 (가장자리 밖이면 가장자리에 붙여 방향만)
  const zn = currentZone();
  if (zn) {
    const s = game.zone || { o: -1, c: 0 };
    const color = s.c ? CSS.none : CSS[sideOfTeam(s.o)];
    let p = toMini(me.pos.x, me.pos.z, me.yaw, zn.x, zn.z, K);
    const d = Math.hypot(p.x, p.y), lim = R - 12;
    if (d > lim) p = { x: p.x / d * lim, y: p.y / d * lim };
    ctx.beginPath(); ctx.arc(R + p.x, R + p.y, Math.max(7, zn.r * K), 0, Math.PI * 2);
    ctx.fillStyle = color + '33'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(zn.id, R + p.x, R + p.y);
  }

  // 다른 플레이어
  lastStats.allies = 0; lastStats.enemies = 0;
  for (const r of remotes.values()) {
    if (!r.alive || !r.hasPos) continue;
    const ally = isAlly(r.team);
    if (!ally && !enemyVisible(now, r.shotAt)) continue;
    const p = toMini(me.pos.x, me.pos.z, me.yaw, r.pos.x, r.pos.z, K);
    if (!inMini(p, R)) continue;
    const age = (now - r.shotAt) / 2000; // 적: 쏜 직후엔 크고 밝게, 점점 작아지며 사라진다
    ctx.beginPath();
    ctx.arc(R + p.x, R + p.y, ally ? 4.5 : 3.5 + (1 - age) * 3, 0, Math.PI * 2);
    ctx.fillStyle = ally ? '#5aa9ff' : `rgba(255,75,58,${(1 - age * 0.7).toFixed(2)})`;
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
    if (ally) lastStats.allies++; else lastStats.enemies++;
  }

  // 나 (항상 가운데, 위를 향한 삼각형)
  ctx.beginPath();
  ctx.moveTo(R, R - 9); ctx.lineTo(R + 6, R + 7); ctx.lineTo(R, R + 3); ctx.lineTo(R - 6, R + 7); ctx.closePath();
  ctx.fillStyle = '#ffb43a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.stroke();

  // 테두리
  ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
}
