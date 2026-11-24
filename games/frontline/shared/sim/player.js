// 플레이어 한 명의 1 tick 시뮬레이션 (서버·브라우저 공용, 결정적): 입력(cmd) → 이동 + 무기 + 스킬.
//   서버: 받은 cmd 마다 이걸 돌려 위치·탄약·쿨타임·사격을 확정한다 (권한).
//   브라우저: 같은 cmd 로 먼저 돌려 바로 반응하고(예측), 서버 상태가 오면 그 상태에서 아직 확인 안 된 cmd 를 다시 돌린다(보정).
//   사격은 사건(ev.shots)으로 나온다 — 탄 방향은 결정적 난수라 서버 판정과 브라우저 그림이 같다.
import { WEAPONS, weaponIndex, isMelee, DEFAULT_LOADOUT } from '../weapons.js';
import { pickSkill, skillForSlot } from '../skills.js';
import { newMove, copyMove, stepMove, applyImpulse, eyeY, hSpeed } from './movement.js';
import { resetSkillState, tickSkills, skillReady, activate, NEEDS_HELD, aimDir } from './abilities.js';
import { mulberry32, shotSeed } from './rng.js';
import { BTN, SPAWN, clamp, lerp } from './config.js';
import { stepKunai, resetKunai, copyKunai, isKunai, KUNAI } from './kunai.js';

const DEG = Math.PI / 180;

// ───── 출전 무기 ─────
// raw = [{ id, skill }, { id, skill }] (브라우저가 보낸 값) → [{ wi, w, skill }] (자리별 스킬 수치까지 정리)
// 같은 무기 두 번은 안 된다 (기획 3.2) → 두 번째를 기본 무기로 바꾼다
export function makeLoadout(raw) {
  const ids = [];
  for (let n = 0; n < 2; n++) {
    const r = Array.isArray(raw) ? raw[n] : null;
    let id = r && typeof r.id === 'string' && weaponIndex(r.id) >= 0 ? r.id : DEFAULT_LOADOUT[n];
    if (ids.includes(id)) id = [DEFAULT_LOADOUT[n], ...DEFAULT_LOADOUT, ...WEAPONS.map(w => w.id)].find(x => !ids.includes(x));
    ids.push(id);
  }
  return ids.map((id, n) => {
    const wi = weaponIndex(id), w = WEAPONS[wi], r = Array.isArray(raw) ? raw[n] : null;
    const sk = pickSkill(w, n, r && r.skill);
    return { wi, w, skill: skillForSlot(sk, n) };
  });
}
export const loadoutWire = lo => lo.map(l => ({ id: l.w.id, skill: l.skill ? l.skill.id : null }));

// 들고 있는 무기에 붙은 늘 켜진 스킬
export const passive = (lo, slot, effect) => { const s = lo[slot] && lo[slot].skill; return s && s.type === 'passive' && s.effect === effect ? s : null; };

// ───── 상태 ─────
export function newPlayerSim(id, lo, x = 0, y = 0, z = 0, yaw = 0) {
  const ps = newMove(x, y, z, yaw);
  ps.id = id; ps.alive = true;
  respawnSim(ps, lo, x, y, z, yaw);
  return ps;
}
// 부활: 체력·탄약·쿨타임 처음으로 (기획 5.2), 보호·등장 연출 시작
export function respawnSim(ps, lo, x, y, z, yaw) {
  Object.assign(ps, newMove(x, y, z, yaw));
  ps.alive = true; ps.cur = 0; ps.drawT = lo[0].w.draw; ps.adsT = 0; ps.bloom = 0; ps.fireN = ps.fireN | 0; ps.btn = 0; ps.qsk = -1;
  ps.w = lo.map(l => ({ ammo: l.w.mag, rl: 0, rlT: 0, cd: 0, heat: 0, over: false, heatT: 9, idle: 99, burst: 0, burstCd: 0 }));
  ps.st = { protect: SPAWN.protect, intro: SPAWN.intro, invuln: 0, stealth: 0, dr: 0, adren: 0, shove: 0, bs: 0, slow: 0 }; // slow = 쿠나이 와이어에 걸려 느려짐
  ps.adrenRate = 0; ps.drMul = 1; ps.bsMul = 1; ps.shove = null; ps.fanSpread = 0; ps.fanGap = 0.07;
  resetSkillState(ps, lo);
  resetKunai(ps);
  return ps;
}
// 깊은 복사 (예측 보정에서 서버 상태를 받아 덮어쓸 때)
export function copySim(dst, src) {
  copyMove(dst, src);
  for (const k of ['id', 'alive', 'cur', 'drawT', 'adsT', 'bloom', 'fireN', 'btn', 'qsk', 'adrenRate', 'drMul', 'bsMul', 'fanSpread', 'fanGap']) dst[k] = src[k];
  dst.w = src.w.map(w => ({ ...w })); dst.sk = src.sk.map(s => ({ ...s })); dst.st = { ...src.st };
  dst.shove = src.shove ? { ...src.shove } : null;
  copyKunai(dst, src);
  return dst;
}

// cmd = { fwd, side, btn, yaw, pitch, slot }
export function decodeCmd(a) {
  const n = v => (Number.isFinite(v) ? v : 0);
  return { fwd: clamp(Math.round(n(a[0])), -1, 1), side: clamp(Math.round(n(a[1])), -1, 1), btn: n(a[2]) | 0, yaw: n(a[3]), pitch: clamp(n(a[4]), -1.55, 1.55), slot: a[5] === 1 ? 1 : 0, vt: n(a[6]) };
}
export const encodeCmd = c => [c.fwd, c.side, c.btn, c.yaw, c.pitch, c.slot, c.vt || 0];

// ───── 무기 규칙 ─────
const curW = (ps, lo) => lo[ps.cur].w;
export function canSprintFire(lo, slot) { const w = lo[slot].w; return w.sprintFire || !!passive(lo, slot, 'sprint'); }
// 지금 탄퍼짐 (도). 정조준·속도·공중·슬라이딩·연사(블룸)
export function spreadOf(ps, lo) {
  const w = curW(ps, lo);
  let s = lerp(w.hip, w.ads, ps.adsT) + hSpeed(ps) * 0.12 * (1 - 0.7 * ps.adsT) + (ps.ground ? 0 : 2.5) + ps.bloom * (1 - 0.5 * ps.adsT);
  if (ps.crouch && ps.slide <= 0) s *= 0.8;
  if (ps.slide > 0) s = s * 1.5 + 1.5; // 슬라이딩 중: 명중률 저하 (기획 2.4)
  return s;
}
const interval = (ps, lo) => 60 / (curW(ps, lo).rpm * (ps.st.adren > 0 ? 1 + ps.adrenRate : 1));
const reloadTime = (ps, lo, slot) => lo[slot].w.reload * ((passive(lo, slot, 'fastreload') || { mul: 1 }).mul);
const canAct = ps => ps.alive && ps.stun <= 0 && !ps.vault;
const motionBlocksFire = ps => ps.mo && (ps.mo.k === 'roll' || ps.mo.k === 'slash');

function startReload(ps, lo, slot) {
  const w = lo[slot].w, s = ps.w[slot];
  if (isMelee(w) || s.rl > 0 || s.ammo >= w.mag) return false;
  s.rl = reloadTime(ps, lo, slot); s.rlT = s.rl; s.burst = 0;
  return true;
}

// 한 발 쏘기 → 사건. 탄 방향은 (id, 몇 번째 사격) 씨앗의 결정적 난수
function fire(ps, lo, ev, extraSpread = 0) {
  const slot = ps.cur, w = lo[slot].w, s = ps.w[slot];
  const o = { x: ps.x, y: eyeY(ps), z: ps.z }, f = aimDir(ps.yaw, ps.pitch);
  const n = ps.fireN++;
  const shot = { slot, wi: lo[slot].wi, n, o, dirs: [], mul: 1, headMul: 1, melee: isMelee(w), range: w.range, pierce: 0, pierceMul: 1, knock: null, close: 0, closeMul: 1, bleed: null };
  // 피해 배율 스킬
  const qd = passive(lo, slot, 'quickdraw');
  if (qd && s.idle >= qd.wait) { shot.mul *= 1 + qd.bonus; shot.close = qd.close; shot.closeMul = qd.mul; }
  const ch = passive(lo, slot, 'charge');
  if (ch && s.idle >= ch.wait) { shot.mul *= 1 + ch.bonus; shot.charged = true; }
  const oh = passive(lo, slot, 'overheat');
  if (oh) { shot.mul *= 1 + oh.bonus * s.heat; s.heat = Math.min(1, s.heat + oh.heat); s.heatT = 0; if (s.heat >= 1) s.over = true; }
  if (ps.st.bs > 0) { shot.mul *= ps.bsMul; ps.st.bs = 0; shot.charged = true; }
  if (ps.st.shove > 0 && ps.shove) { shot.knock = { ...ps.shove }; ps.st.shove = 0; }
  const bang = passive(lo, slot, 'bang'); if (bang) shot.headMul = bang.mul;
  const cal = passive(lo, slot, 'caliber'); if (cal) { shot.pierce = cal.pierce; shot.pierceMul = cal.mul; }
  const bl = passive(lo, slot, 'bleed'); if (bl) shot.bleed = { hits: bl.hits, wait: bl.wait, dur: bl.dur, dps: bl.dps };
  // 탄 방향
  const rnd = mulberry32(shotSeed(ps.id, n));
  const tanS = Math.tan((spreadOf(ps, lo) + extraSpread) * DEG);
  const rx = Math.cos(ps.yaw), rz = -Math.sin(ps.yaw);              // 오른쪽
  const ux = -f.y * rz, uy = rz * f.x - rx * f.z, uz = f.y * rx;     // 위 = 오른쪽 × 앞
  for (let i = 0; i < w.pellets; i++) {
    const r = tanS * Math.sqrt(rnd()), th = rnd() * Math.PI * 2, a = r * Math.cos(th), b = r * Math.sin(th);
    let dx = f.x + rx * a + ux * b, dy = f.y + uy * b, dz = f.z + rz * a + uz * b;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    shot.dirs.push({ x: dx, y: dy, z: dz });
  }
  if (!shot.melee) s.ammo--;
  s.idle = 0;
  ps.bloom = Math.min(w.bloomMax, ps.bloom + w.bloom);
  ps.st.protect = 0; // 부활 보호: 공격하면 풀린다
  // 반동 이동 (산탄총 스킬): 조준 반대 방향으로 밀려난다. 공중에서도
  const kb = passive(lo, slot, 'kickback');
  if (kb) applyImpulse(ps, -f.x * kb.force, -f.y * kb.force, -f.z * kb.force, 0.3);
  ev.shots.push(shot);
}

// ───── 1 tick ─────
// lo = makeLoadout 결과, cs = 맵 충돌 박스. 반환 ev = { move, shots, reload, swap, skills, slash, grenade, grapple, dry }
export function stepPlayer(ps, cmd, lo, cs, dt) {
  const ev = { move: null, shots: [], reload: false, swap: false, skills: null, dry: false };
  ps.yaw = cmd.yaw; ps.pitch = cmd.pitch;
  const btn = cmd.btn, prev = ps.btn | 0, press = b => (btn & b) && !(prev & b);
  ps.btn = btn;
  if (!ps.alive) return ev;
  for (const k in ps.st) if (ps.st[k] > 0) ps.st[k] = Math.max(0, ps.st[k] - dt);
  tickSkills(ps, lo, dt);
  const act = canAct(ps);

  // 무기 교체 (기획 2.4: 교체 중에는 쏠 수 없다 — 꺼내는 시간 = 쏠 수 있게 되는 시점)
  if (act && cmd.slot !== ps.cur && lo[cmd.slot]) {
    ps.w[ps.cur].rl = 0; ps.w[ps.cur].burst = 0;
    ps.cur = cmd.slot; ps.drawT = curW(ps, lo).draw; ps.adsT = 0; ps.bloom = 0;
    ps.st.stealth = 0; // 스텔스: 무기를 바꾸면 풀린다
    ev.swap = true;
  }
  // 스킬 (Q = 주무기 자리, E = 보조무기 자리)
  for (const [b, slot] of [[BTN.sk1, 0], [BTN.sk2, 1]]) {
    if (!act || !press(b) || !skillReady(ps, lo, slot)) continue;
    const sk = lo[slot].skill;
    if (NEEDS_HELD.has(sk.effect) && ps.cur !== slot) { ps.qsk = slot; continue; } // 꺼낸 뒤 발동 (아래)
    activate(ps, lo, slot, cs, ev, cmd);
  }
  if (ps.qsk >= 0 && act && ps.cur === ps.qsk && ps.drawT <= 0) { const q = ps.qsk; ps.qsk = -1; if (skillReady(ps, lo, q)) activate(ps, lo, q, cs, ev, cmd); }
  else if (ps.qsk >= 0 && cmd.slot !== ps.qsk) ps.qsk = -1;

  // 쿠나이: 던지기·회수·모드 전환 (들고 있을 때) + 비행·앵커·와이어 수명 (늘)
  const kunai = isKunai(curW(ps, lo));
  stepKunai(ps, lo, cs, dt, ev, kunai, act, press);

  // 이동
  const w = curW(ps, lo), s = ps.w[ps.cur];
  const wantAds = !!(btn & BTN.ads) && !isMelee(w) && !kunai && act; // 쿠나이는 우클릭 = 오른손
  const fireHeld = !!(btn & BTN.fire);
  const sprintFire = canSprintFire(lo, ps.cur);
  const sprint = !!(btn & BTN.sprint) && !wantAds && !(fireHeld && !sprintFire);
  ev.move = stepMove(ps, {
    fwd: cmd.fwd, side: cmd.side, jump: !!(btn & BTN.jump), crouch: !!(btn & BTN.crouch), sprint,
    speedMul: w.move * (1 - 0.35 * ps.adsT) * (ps.st.slow > 0 ? KUNAI.wire.slow : 1), airSprint: !!passive(lo, ps.cur, 'sprint'),
  }, cs, dt);
  if (ev.move.vaultStart) { s.rl = 0; }

  // 무기 상태
  ps.drawT = Math.max(0, ps.drawT - dt);
  for (let i = 0; i < ps.w.length; i++) {
    const ws = ps.w[i], oh = passive(lo, i, 'overheat');
    ws.idle += dt; ws.cd = Math.max(-dt, ws.cd - dt); // 남은 간격의 자투리는 다음 발로 넘긴다 (연사 속도가 tick 에 맞춰 깎이지 않게)
    if (oh) { ws.heatT += dt; if (ws.heatT >= oh.coolDelay || ws.over) ws.heat = Math.max(0, ws.heat - oh.cool * dt); if (ws.over && ws.heat <= 0) ws.over = false; }
  }
  ps.bloom = Math.max(0, ps.bloom - dt * (w.bloomMax || 1) * 3.2);
  const adsOk = wantAds && ps.drawT <= 0 && !(s.rl > 0 && !w.shell) && !ps.sprinting && !ps.mo;
  ps.adsT = clamp(ps.adsT + (adsOk ? dt : -dt) / w.adsTime, 0, 1);

  if (kunai) return ev; // 쿠나이는 탄창·재장전·사격이 없다 (위의 stepKunai 가 맡는다)

  // 재장전
  if (act && press(BTN.reload) && startReload(ps, lo, ps.cur)) ev.reload = true;
  if (s.rl > 0) {
    s.rl -= dt;
    if (s.rl <= 0) {
      if (w.shell) { s.ammo = Math.min(w.mag, s.ammo + 1); if (s.ammo < w.mag) { s.rl = reloadTime(ps, lo, ps.cur); s.rlT = s.rl; ev.shell = true; } else s.rl = 0; }
      else { s.ammo = w.mag; s.rl = 0; }
    }
  }

  // 사격
  const slideBlock = ps.slide > 0 && !w.slideFire;
  const sprintBlock = !sprintFire && ps.sprintOut < 0.12;
  const ready = act && ps.drawT <= 0 && !slideBlock && !sprintBlock && !motionBlocksFire(ps) && !s.over;
  if (s.burst > 0) { // 패닝: 정해진 간격으로 남은 탄을 쏜다
    s.burstCd -= dt;
    if (ready && s.burstCd <= 1e-9 && s.ammo > 0) { fire(ps, lo, ev, ps.fanSpread); s.burst--; s.burstCd += ps.fanGap; if (s.burst <= 0 || s.ammo <= 0) { s.burst = 0; s.cd = interval(ps, lo); } }
    else if (!ready && ps.stun > 0) s.burst = 0;
  } else if (fireHeld && ready && s.cd <= 1e-9) {
    const fresh = press(BTN.fire);
    if (w.auto || fresh) {
      if (s.rl > 0 && w.shell && s.ammo > 0) { s.rl = 0; } // 산탄총: 장전 중 사격으로 끊는다
      if (s.rl <= 0) {
        if (isMelee(w) || s.ammo > 0) { fire(ps, lo, ev); s.cd += interval(ps, lo); }
        else { if (fresh) ev.dry = true; if (startReload(ps, lo, ps.cur)) ev.reload = true; }
      }
    }
  }
  if (!isMelee(w) && s.ammo <= 0 && s.rl <= 0 && s.cd <= 1e-9 && s.burst <= 0 && act && startReload(ps, lo, ps.cur)) ev.reload = true; // 다 쓰면 자동 재장전
  return ev;
}
