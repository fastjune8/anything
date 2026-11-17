// 무기 스킬 (서버·브라우저 공용). 데이터는 content/skills.json, 칸 설명은 shared/content/schema.js 의 SKILL_SCHEMA.
//  - 출전 무기 2개 중 1번(주무기) 무기에 고른 스킬 = Q, 2번(보조무기) 무기에 고른 스킬 = E
//  - 누르는 스킬(아드레날린·대쉬·유탄)은 들고 있는 무기와 상관없이 쓸 수 있고, 늘 켜진 스킬(질주·과열)은 그 무기를 들고 있을 때만 적용된다
//  - 열(과열)·유탄의 움직임·폭발 피해는 서버와 브라우저가 이 함수들로 같은 결과를 낸다
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

// ───── 과열 ─────
// h = { heat 0~1, since(마지막 사격 뒤 지난 초), over(과열됨) }
export const newHeat = () => ({ heat: 0, since: 9, over: false });
export function coolHeat(h, sk, dt) {
  h.since += dt;
  if (h.since >= sk.coolDelay || h.over) h.heat = Math.max(0, h.heat - sk.cool * dt);
  if (h.over && h.heat <= 0) h.over = false; // 다 식으면 다시 쏠 수 있다
}
export function addHeat(h, sk) {
  h.heat = Math.min(1, h.heat + sk.heat); h.since = 0;
  if (h.heat >= 1) h.over = true;
}
export const heatMul = (h, sk) => 1 + sk.bonus * h.heat; // 피해 배율

// ───── 유탄 ─────
export const GRENADE_GRAVITY = 12;
export const GRENADE_LIFE = 4; // 이 시간이 지나면 공중에서도 터진다
// g = { p: {x,y,z}, v: {x,y,z}, t } 를 dt 만큼 움직인다. 무언가에 닿으면 g.done = true (닿은 자리에서 터진다)
const _d = { x: 0, y: 0, z: 0 };
export function stepGrenade(g, dt, colliders) {
  g.v.y -= GRENADE_GRAVITY * dt;
  const dx = g.v.x * dt, dy = g.v.y * dt, dz = g.v.z * dt, len = Math.hypot(dx, dy, dz);
  g.t += dt;
  if (len > 1e-6) {
    _d.x = dx / len; _d.y = dy / len; _d.z = dz / len;
    const hit = rayWorld(g.p, _d, colliders, len);
    const groundT = dy < 0 && g.p.y + dy <= 0 ? g.p.y / -_d.y : Infinity; // 땅
    const t = Math.min(hit.t < len ? hit.t : Infinity, groundT);
    if (t < Infinity) { g.p.x += _d.x * (t - 0.05); g.p.y += _d.y * (t - 0.05); g.p.z += _d.z * (t - 0.05); g.done = true; return g; }
    g.p.x += dx; g.p.y += dy; g.p.z += dz;
  }
  if (g.t >= GRENADE_LIFE) g.done = true;
  return g;
}
// 폭발 중심에서 dist m 떨어진 곳의 피해 (가운데 = 최대, 가장자리 = 30%)
export function splashDamage(sk, dist) {
  if (dist >= sk.radius) return 0;
  return sk.dmg * (1 - 0.7 * (dist / sk.radius));
}
// 폭발이 대상(몸 가운데)에 닿는가: 사이에 벽이 없어야 한다
const _o = { x: 0, y: 0, z: 0 };
export function blastReaches(c, target, colliders) {
  const dx = target.x - c.x, dy = target.y - c.y, dz = target.z - c.z, len = Math.hypot(dx, dy, dz);
  if (len < 0.05) return true;
  _o.x = c.x; _o.y = c.y; _o.z = c.z;
  return rayWorld(_o, { x: dx / len, y: dy / len, z: dz / len }, colliders, len).t >= len - 0.05;
}
