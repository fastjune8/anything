// 무기 스킬 (서버 쪽). 규칙과 수치는 shared/skills.js · content/skills.json.
//   - 아드레날린: `sk` 를 받으면 쿨타임을 확인하고 다른 사람에게 알린다 (공격 속도는 브라우저가 쏘는 간격)
//   - 대쉬: 이동 입력의 플래그로 온다 → server/motion.js 가 이동 계산에 넣는다 (쿨타임도 이동 상태에 있다)
//   - 과열: 사격(`shot`)마다 서버가 열을 계산하고, 명중 피해에 열만큼 배율을 곱한다 (브라우저가 보낸 값을 믿지 않는다)
//   - 유탄: `gl` 을 받으면 유탄 수를 확인하고 서버가 날아가는 길과 폭발 피해를 계산한다. 모두에게 `gl`(날아감) · `boom`(터짐)
import { getSkill, newHeat, coolHeat, addHeat, heatMul, stepGrenade, splashDamage, blastReaches } from '../shared/skills.js';
import { ORIGIN_TOL } from './lagcomp.js';

const SUB = 4; // tick 하나를 이만큼 나눠 유탄을 움직인다 (벽을 뚫지 않게)

// 입장할 때: 출전 자리별 스킬 (0 = 주무기 Q, 1 = 보조무기 E)
export function initSkills(p) {
  p.skills = p.loadout.map(l => ({ wi: l.wi, skill: getSkill(l.skill) }));
  p.heat = {};      // 무기번호 → 열 상태 (과열 스킬을 고른 무기만)
  for (const s of p.skills) if (s.skill && s.skill.effect === 'overheat') p.heat[s.wi] = newHeat();
  resetSkills(p);
}
// 태어날 때: 쿨타임·유탄·열을 처음 상태로
export function resetSkills(p) {
  if (!p.skills) return;
  p.skCd = [0, 0];  // 자리별로 다시 쓸 수 있는 시각 (ms)
  const g = p.skills.find(s => s.skill && s.skill.effect === 'grenade');
  p.gl = g ? { slot: p.skills.indexOf(g), ammo: g.skill.ammo, t: 0 } : null;
  for (const h of Object.values(p.heat || {})) Object.assign(h, newHeat());
  p.heatAt = Date.now();
}

// 이 무기를 든 채 쏜 한 발: 열을 올린다. 반환: 이 사격을 받아 줄까 (과열 중이면 false)
export function onShotHeat(p, wi, now = Date.now()) {
  const h = p.heat && p.heat[wi];
  if (!h) return true;
  const sk = p.skills.find(s => s.wi === wi).skill;
  coolHeat(h, sk, (now - (h.at || now)) / 1000); h.at = now;
  if (h.over) return false;
  addHeat(h, sk);
  return true;
}
// 명중 피해 배율 (과열 스킬: 열이 높을수록 크다)
export function damageMul(p, wi) {
  const h = p.heat && p.heat[wi];
  if (!h) return 1;
  return heatMul(h, p.skills.find(s => s.wi === wi).skill);
}

// `sk` = { n: 자리 } 누르는 스킬 사용 (지금은 아드레날린)
export function useSkill(room, p, m, now = Date.now()) {
  const n = m.n === 1 ? 1 : 0, s = p.skills && p.skills[n];
  if (!p.alive || !s || !s.skill || s.skill.effect !== 'adrenaline' || now < p.skCd[n]) return false;
  p.skCd[n] = now + s.skill.cd * 1000;
  room.broadcast({ t: 'sk', id: p.id, e: s.skill.effect, d: s.skill.dur });
  return true;
}

// `gl` = { o: [쏜 눈 위치], d: [방향] } 유탄 발사
let nextId = 1;
export function fireGrenade(room, p, m) {
  const g = p.gl;
  if (!p.alive || !g || g.ammo <= 0 || !p.pos) return false;
  const sk = p.skills[g.slot].skill, wi = p.skills[g.slot].wi;
  const o = m.o, d = m.d;
  if (!Array.isArray(o) || o.length !== 3 || !o.every(Number.isFinite) || !Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return false;
  const eye = p.pos[1] + (p.crouch ? 1.07 : 1.62);
  if (Math.hypot(o[0] - p.pos[0], o[1] - eye, o[2] - p.pos[2]) > ORIGIN_TOL) return false; // 쏜 곳은 내 눈 근처여야 한다
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.5 || len > 1.5) return false;
  g.ammo--;
  p.invulnUntil = 0;
  const v = { x: d[0] / len * sk.speed, y: d[1] / len * sk.speed, z: d[2] / len * sk.speed };
  const gr = { id: nextId++, by: p, wi, sk, p: { x: o[0], y: o[1], z: o[2] }, v, t: 0 };
  (room.grenades || (room.grenades = [])).push(gr);
  room.broadcast({ t: 'gl', id: gr.id, by: p.id, o: [o[0], o[1], o[2]], v: [v.x, v.y, v.z] });
  return true;
}

// 방의 tick 마다: 유탄 움직이기·터뜨리기, 유탄 채우기
export function tickSkills(room, dt) {
  const cs = room.map.layout.colliders;
  if (room.grenades && room.grenades.length) {
    for (const g of room.grenades) {
      for (let k = 0; k < SUB && !g.done; k++) stepGrenade(g, dt / SUB, cs);
      if (g.done) explode(room, g, cs);
    }
    room.grenades = room.grenades.filter(g => !g.done);
  }
  for (const p of room.players.values()) {
    const g = p.gl;
    if (!g || !p.alive) continue;
    const sk = p.skills[g.slot].skill;
    if (g.ammo < sk.ammo) { g.t += dt; if (g.t >= sk.recharge) { g.t = 0; g.ammo++; } } else g.t = 0;
  }
}
function explode(room, g, cs) {
  room.broadcast({ t: 'boom', id: g.id, p: [g.p.x, g.p.y, g.p.z], r: g.sk.radius });
  const by = g.by;
  if (room.players.get(by.id) !== by) return; // 쏜 사람이 나갔다
  for (const v of room.players.values()) {
    if (!v.alive || !v.pos || !room.isEnemy(by, v)) continue; // 아군·자신은 피해 없음
    const c = { x: v.pos[0], y: v.pos[1] + (v.crouch ? 0.6 : 0.9), z: v.pos[2] };
    const dist = Math.hypot(c.x - g.p.x, c.y - g.p.y, c.z - g.p.z);
    const dmg = Math.round(splashDamage(g.sk, dist));
    if (dmg > 0 && blastReaches(g.p, c, cs)) room.applyDamage(by, v, g.wi, dmg, false);
  }
}
