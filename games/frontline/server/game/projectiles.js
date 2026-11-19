// 투사체 (유탄). 서버가 날리고 터뜨린다. 폭발은 반경 안 적에게 피해(벽 너머는 안 됨), 모두를 밀어낸다(자기 자신 포함 — 유탄 점프).
import { stepGrenade, splashDamage, blastReaches } from '../../shared/skills.js';
import { applyImpulse } from '../../shared/sim/movement.js';

const SUB = 3;
let nextId = 1;

export function launch(room, P, g, sk, wi) {
  const v = { x: g.d.x * sk.speed, y: g.d.y * sk.speed + 1.5, z: g.d.z * sk.speed };
  const gr = { id: nextId++, by: P, wi, sk, p: { ...g.o }, v, t: 0, done: false };
  room.grenades.push(gr);
  room.emit({ e: 'gl', id: gr.id, by: P.id, o: [g.o.x, g.o.y, g.o.z], v: [v.x, v.y, v.z] });
}
export function tickProjectiles(room, dt) {
  const cs = room.map.layout.colliders;
  for (const g of room.grenades) {
    for (let k = 0; k < SUB && !g.done; k++) {
      stepGrenade(g, dt / SUB, cs);
      if (!g.done) for (const v of room.players.values()) { // 사람에게 직접 닿아도 터진다
        if (!v.alive || v === g.by || !room.isEnemy(g.by, v)) continue;
        const ps = v.ps;
        if (Math.hypot(g.p.x - ps.x, g.p.z - ps.z) < 0.5 && g.p.y > ps.y && g.p.y < ps.y + ps.h) { g.done = true; break; }
      }
    }
    if (g.done) explode(room, g, cs);
  }
  room.grenades = room.grenades.filter(g => !g.done);
}
function explode(room, g, cs) {
  room.emit({ e: 'boom', id: g.id, p: [g.p.x, g.p.y, g.p.z], r: g.sk.radius });
  room.noise(g.by, 'fire', g.p);
  for (const v of room.players.values()) {
    if (!v.alive) continue;
    const ps = v.ps, c = { x: ps.x, y: ps.y + ps.h * 0.5, z: ps.z };
    const dx = c.x - g.p.x, dy = c.y - g.p.y, dz = c.z - g.p.z, dist = Math.hypot(dx, dy, dz);
    if (dist >= g.sk.radius || !blastReaches(g.p, c, cs)) continue;
    const k = 1 - dist / g.sk.radius, l = dist || 1, f = 7 * k;
    applyImpulse(ps, dx / l * f, Math.max(2, dy / l * f + 3 * k), dz / l * f, 0.35);
    v.meDirty = true; v.hitBy = { id: g.by.id, t: room.time };
    if (v !== g.by && room.isEnemy(g.by, v) && room.players.get(g.by.id) === g.by) {
      const dmg = Math.round(splashDamage(g.sk, dist));
      if (dmg > 0) room.damage(g.by, v, dmg, { wi: g.wi, how: 'blast', part: 'body' });
    }
  }
}
