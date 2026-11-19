// 무기 스킬 데이터 (서버·브라우저 공용). 수치는 content/skills.json, 칸 설명은 shared/content/schema.js 의 SKILL_SCHEMA.
//   기획 3.3: 무기마다 여러 스킬, 무기마다 하나를 고른다. 같은 스킬이라도 장착 자리(주무기/보조무기)에 따라 값이 다를 수 있다
//   → 스킬의 "secondary" 칸에 보조무기 자리일 때 바뀌는 값을 적는다. 동작은 shared/sim/abilities.js
import data from '../content/skills.json' with { type: 'json' };
import { checkSkills } from './content/schema.js';
import { rayWorld } from './collision.js';

{
  const errors = checkSkills(data);
  if (errors.length) throw new Error('스킬 데이터 오류 (content/skills.json):\n  ' + errors.join('\n  '));
}
export const SKILLS = data;
export const SLOT_KEYS = ['primary', 'secondary']; // 출전 자리 0 = 주무기(Q), 1 = 보조무기(E)
export const SKILL_KEYS = ['Q', 'E'];
const byId = new Map(data.map(s => [s.id, s]));
export const getSkill = id => byId.get(id) || null;

// 이 무기를 slot(0/1) 자리에 들고 갈 때 고를 수 있는 스킬
export function skillsFor(weapon, slot) {
  const ids = (weapon && weapon.skills && weapon.skills[SLOT_KEYS[slot]]) || [];
  return ids.map(getSkill).filter(Boolean);
}
// 고른 스킬 (고를 수 없는 것이면 첫 번째, 없으면 null)
export function pickSkill(weapon, slot, id) {
  const list = skillsFor(weapon, slot);
  return list.find(s => s.id === id) || list[0] || null;
}
// 자리에 맞춘 최종 수치 (보조무기 자리면 secondary 값을 덮어쓴다)
export function skillForSlot(sk, slot) {
  if (!sk) return null;
  const { secondary, ...base } = sk;
  return slot === 1 && secondary ? { ...base, ...secondary } : base;
}

// ───── 유탄 (서버가 날리고, 브라우저는 같은 식으로 그린다) ─────
export const GRENADE_GRAVITY = 12;
export const GRENADE_LIFE = 4;
const _d = { x: 0, y: 0, z: 0 };
export function stepGrenade(g, dt, colliders) {
  g.v.y -= GRENADE_GRAVITY * dt;
  const dx = g.v.x * dt, dy = g.v.y * dt, dz = g.v.z * dt, len = Math.hypot(dx, dy, dz);
  g.t += dt;
  if (len > 1e-6) {
    _d.x = dx / len; _d.y = dy / len; _d.z = dz / len;
    const hit = rayWorld(g.p, _d, colliders, len);
    if (hit.t < len) { g.p.x += _d.x * (hit.t - 0.05); g.p.y += _d.y * (hit.t - 0.05); g.p.z += _d.z * (hit.t - 0.05); g.done = true; return g; }
    g.p.x += dx; g.p.y += dy; g.p.z += dz;
  }
  if (g.t >= GRENADE_LIFE) g.done = true;
  return g;
}
export function splashDamage(sk, dist) {
  if (dist >= sk.radius) return 0;
  return sk.dmg * (1 - 0.7 * (dist / sk.radius));
}
const _o = { x: 0, y: 0, z: 0 };
export function blastReaches(c, target, colliders) {
  const dx = target.x - c.x, dy = target.y - c.y, dz = target.z - c.z, len = Math.hypot(dx, dy, dz);
  if (len < 0.05) return true;
  _o.x = c.x; _o.y = c.y; _o.z = c.z;
  return rayWorld(_o, { x: dx / len, y: dy / len, z: dz / len }, colliders, len).t >= len - 0.05;
}
