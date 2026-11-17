// 무기 스킬 (브라우저 쪽): Q = 1번(주무기)에 고른 스킬, E = 2번(보조무기)에 고른 스킬.
//   누르는 스킬(아드레날린·대쉬·유탄)은 들고 있는 무기와 상관없이, 늘 켜진 스킬(질주·과열)은 그 무기를 들고 있을 때만.
//   규칙·수치는 shared/skills.js · content/skills.json. 서버가 같은 규칙으로 확인한다 (server/skills.js).
import { getSkill, newHeat, coolHeat, addHeat } from '/shared/skills.js';
import { me, wp, loadout, net, eff } from './state.js';
import { sfx } from './sfx.js';
import { playFx } from './vfx.js';

// 자리별 지금 스킬 { wi, skill } (출전 무기·고른 스킬이 바뀌면 다시 읽는다)
export const slotSkill = n => { const wi = loadout.slots[n]; return { wi, skill: getSkill(loadout.skills[wi] && loadout.skills[wi][n]) }; };
const effectSlot = e => [0, 1].find(n => { const s = slotSkill(n).skill; return s && s.effect === e; });

export const sk = {
  cd: [0, 0],          // 자리별 남은 쿨타임 (초) — 아드레날린 (대쉬는 이동 상태 me.dashCd)
  adrenT: 0, adrenRate: 0, // 아드레날린 남은 시간 / 공격 속도 증가
  heat: {},            // 무기번호 → 열 상태 (과열)
  gl: { on: false, ammo: 0, t: 0 }, // 유탄 모드 / 남은 유탄 / 채우는 중인 시간
  dashPress: false,    // 대쉬 키를 눌렀다 (다음 이동 입력이 가져간다)
  kickPress: false,    // 밀려나기 무기를 쐈다 (다음 이동 입력이 가져간다)
  shoveArmed: false,   // 밀어내기 준비됨 (다음 사격)
  clock: 0, lastShot: {}, // 차지 샷: 무기번호 → 마지막으로 쏜 시각 (clock 기준, 초)
  flash: ['', ''],     // HUD 에 잠깐 보여 줄 글 (예: "쿨타임")
  flashT: [0, 0],
};

// 이 효과의 스킬이 지금 들고 있는 무기에 적용되는가 (늘 켜진 스킬)
export function heldSkill(effect) {
  const n = loadout.slots.indexOf(wp.cur);
  const s = n >= 0 ? slotSkill(n).skill : null;
  return s && s.effect === effect ? s : null;
}
export const dashSkill = () => { const n = effectSlot('dash'); return n === undefined ? null : slotSkill(n).skill; };
export const glSkill = () => { const n = effectSlot('grenade'); return n === undefined ? null : slotSkill(n); };
export const rpmMul = () => (sk.adrenT > 0 ? 1 + sk.adrenRate : 1);
export const heatOf = wi => sk.heat[wi] || (sk.heat[wi] = newHeat());
// 유탄 모드인가 (유탄 스킬의 무기를 들고 있을 때만)
export const grenadeMode = () => { const g = glSkill(); return !!(g && sk.gl.on && wp.cur === g.wi); };

function say(n, text) { sk.flash[n] = text; sk.flashT[n] = 1.2; }

// Q / E
export function pressSkill(n, switchTo) {
  if (!me.alive) return;
  const { wi, skill } = slotSkill(n);
  if (!skill) { say(n, '스킬 없음'); return; }
  switch (skill.effect) {
    case 'adrenaline':
      if (sk.cd[n] > 0) { say(n, '쿨타임'); sfx.mech('dry'); return; }
      sk.cd[n] = skill.cd; sk.adrenT = skill.dur; sk.adrenRate = skill.rate;
      net.send({ t: 'sk', n }); sfx.mech('bolt'); sfx.whoosh(0);
      playFx('skill_adrenaline', me.pos);
      break;
    case 'shove':
      if (sk.cd[n] > 0) { say(n, '쿨타임'); sfx.mech('dry'); return; }
      sk.cd[n] = skill.cd; sk.shoveArmed = true;
      net.send({ t: 'sk', n }); sfx.mech('pump', 0.9);
      break;
    case 'dash':
      if (me.dashCd > 0) { say(n, '쿨타임'); sfx.mech('dry'); return; }
      sk.dashPress = true;
      break;
    case 'grenade':
      if (sk.gl.on && wp.cur === wi) { sk.gl.on = false; sfx.mech('draw'); return; } // 다시 누르면 총으로
      if (wp.cur !== wi) switchTo(wi);
      sk.gl.on = true; sfx.mech('magin', 0.8);
      break;
    default: say(n, '늘 켜져 있는 스킬'); // 질주·과열
  }
}

// 대쉬 키를 가져간다 (player.js 가 이번 이동 입력에 넣는다)
export function takeDash() { const d = sk.dashPress; sk.dashPress = false; return d; }
export function takeKick() { const d = sk.kickPress; sk.kickPress = false; return d; }
// 밀려나기 수치 (서버 server/motion.js 의 kickSkill 과 같다)
export const kickSkill = () => { const s = heldSkill('kickback'); return s ? { force: s.force, gap: 30 / eff[wp.cur].rpm } : null; };
// 차지 샷이 충전되었는가 (그 무기로 wait 초 동안 쏘지 않음)
export const chargeReady = (wi, s) => !(sk.clock - (sk.lastShot[wi] ?? -Infinity) < s.wait);

// 한 발 쏠 때 (weapon.js): 차지 샷 · 밀어내기 · 밀려나기. 반환: 충전된 한 발이었는가
export function onFire(wi) {
  const ch = heldSkill('charge');
  const charged = !!ch && chargeReady(wi, ch);
  sk.lastShot[wi] = sk.clock;
  sk.shoveArmed = false; // 준비한 밀어내기는 이 한 발로 끝 (서버도 같다)
  if (heldSkill('kickback')) sk.kickPress = true;
  return charged;
}

// 과열 무기로 한 발: 반환 = 쏠 수 있었는가
export function heatShot(s) { const h = heatOf(wp.cur); if (h.over) return false; addHeat(h, s); return true; }

export function updateSkills(dt) {
  sk.clock += dt;
  for (const n of [0, 1]) { sk.cd[n] = Math.max(0, sk.cd[n] - dt); sk.flashT[n] = Math.max(0, sk.flashT[n] - dt); }
  sk.adrenT = Math.max(0, sk.adrenT - dt);
  for (const n of [0, 1]) { const { wi, skill } = slotSkill(n); if (skill && skill.effect === 'overheat') coolHeat(heatOf(wi), skill, dt); }
  const g = glSkill();
  if (g) {
    if (sk.gl.ammo < g.skill.ammo) { sk.gl.t += dt; if (sk.gl.t >= g.skill.recharge) { sk.gl.t = 0; sk.gl.ammo++; } } else sk.gl.t = 0;
    if (sk.gl.on && wp.cur !== g.wi) sk.gl.on = false; // 다른 무기로 바꾸면 유탄 모드도 끝
  } else sk.gl.on = false;
}

// 태어날 때 (서버의 resetSkills 와 같다)
export function resetSkills() {
  sk.cd = [0, 0]; sk.adrenT = 0; sk.dashPress = false; sk.gl.on = false; sk.gl.t = 0;
  sk.kickPress = false; sk.shoveArmed = false; sk.lastShot = {}; // 태어나면 차지 샷은 충전된 상태 (서버와 같다)
  const g = glSkill(); sk.gl.ammo = g ? g.skill.ammo : 0;
  for (const k of Object.keys(sk.heat)) sk.heat[k] = newHeat();
}
