// 점령전 (기획 7.2~7.8). 공통 규칙은 shared/sim/domination.js, 거점 개수·위치는 맵 데이터 (단일·복수 거점 모두).
import { newPoint, stepPoint, scoreTick, judge } from '../../../shared/sim/domination.js';

const SEND_MS = 200;
const DEFAULT_ZONE = { id: 'A', name: '거점', x: 0, z: 0, r: 6 };

export function createDomination(room) {
  const cfg = room.cfg.dom;
  const zones = room.map.zones && room.map.zones.length ? room.map.zones : [DEFAULT_ZONE];
  let pts, acc, sendAcc, lastKey;
  const inside = (P, z) => P.alive && Math.hypot(P.ps.x - z.x, P.ps.z - z.z) <= z.r && P.ps.y >= (z.y || 0) - 1 && P.ps.y < (z.y || 0) + cfg.height;
  const snap = () => ({ pts: pts.map(p => [p.owner, p.team, Math.round(p.prog * 1000) / 1000, p.contested ? 1 : 0, p.n[0], p.n[1]]), zones: zones.map(z => [z.id, z.name || z.id, z.x, z.z, z.r]) });
  const rules = {
    zones,
    reset() { pts = zones.map(newPoint); acc = [0, 0]; sendAcc = 0; lastKey = ''; },
    onKill() {},
    // 반환: { over, winner, overtime }
    tick(dt, timeUp, overtimeOver) {
      for (let i = 0; i < zones.length; i++) {
        const n = [0, 0], who = [];
        for (const P of room.players.values()) if ((P.team === 0 || P.team === 1) && inside(P, zones[i])) { n[P.team]++; who.push(P); }
        const before = pts[i].contested;
        const cap = stepPoint(pts[i], n, dt, cfg);
        if (cap >= 0) {
          for (const P of who) if (P.team === cap) P.caps++;
          room.emit({ e: 'cap', z: i, team: cap });
        }
        if (pts[i].contested && !before) room.emit({ e: 'contest', z: i });
      }
      const sc = scoreTick(pts, acc, dt, cfg);
      room.scores[0] = sc[0]; room.scores[1] = sc[1];
      sendAcc += dt * 1000;
      if (sendAcc >= SEND_MS) {
        sendAcc = 0;
        const s = snap(), key = JSON.stringify([s.pts, room.scores]);
        if (key !== lastKey) { lastKey = key; room.emit({ e: 'dom', pts: s.pts, sc: room.scores }); }
      }
      return judge(room.scores, room.goal, timeUp, room.overtime, overtimeOver);
    },
    snapshot() { return { dom: snap() }; },
    // 봇이 갈 곳: 우리 것이 아닌 가까운 거점 (경합 중이면 우선)
    objectiveFor(P) {
      let best = null, bv = Infinity;
      zones.forEach((z, i) => {
        const p = pts[i], mine = p.owner === P.team && p.team < 0 && !p.contested;
        const d = Math.hypot(z.x - P.ps.x, z.z - P.ps.z) + (mine ? 60 : 0) - (p.contested ? 25 : 0) + ((P.id * 13 + i * 7) % 11);
        if (d < bv) { bv = d; best = z; }
      });
      return best;
    },
    nearestPoint(x, z) { let b = zones[0], bd = Infinity; for (const q of zones) { const d = Math.hypot(q.x - x, q.z - z); if (d < bd) { bd = d; b = q; } } return b; },
  };
  rules.reset();
  return rules;
}
