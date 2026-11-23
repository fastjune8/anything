// 엔진 단위 테스트 (서버 없이, 1초 안팎): 이동 물리 · 무기 · 스킬 · 결정성 · 점령 규칙 · 스폰 · 판정 · 콘텐츠
import { check, failed } from './helpers.mjs';
import { WEAPONS, calcDamage } from '../shared/weapons.js';
import { SKILLS } from '../shared/skills.js';
import { MODES } from '../shared/modes.js';
import { getMap, MAP_IDS } from '../shared/maps/index.js';
import { makeLoadout, newPlayerSim, stepPlayer, copySim, spreadOf } from '../shared/sim/player.js';
import { newMove, stepMove, applyImpulse, NO_MOVE } from '../shared/sim/movement.js';
import { castRay } from '../shared/sim/hitscan.js';
import { newPoint, stepPoint, scoreTick, judge } from '../shared/sim/domination.js';
import { pickDynamic, scoreSpawn } from '../shared/sim/spawn.js';
import { BTN, DT, MOVE, HEALTH } from '../shared/sim/config.js';
import { sanitizeChat } from '../server/chat.js';

const cs = getMap('outpost').layout.colliders;
const open = [];                     // 아무것도 없는 평지
const run = (ps, lo, n, cmd, world = open) => { const evs = []; for (let i = 0; i < n; i++) evs.push(stepPlayer(ps, { fwd: 0, side: 0, btn: 0, yaw: 0, pitch: 0, slot: 0, ...(typeof cmd === 'function' ? cmd(i) : cmd) }, lo, world, DT)); return evs; };
const shots = evs => evs.reduce((n, e) => n + e.shots.length, 0);
const LO = (a, sa, b, sb) => makeLoadout([{ id: a, skill: sa }, { id: b, skill: sb }]);

console.log('[콘텐츠]');
check(WEAPONS.length === 8 && ['ar', 'smg', 'shotgun', 'sniper', 'melee', 'revolver', 'akimbo', 'lmg'].every(k => WEAPONS.some(w => w.kind === k)), '무기 8종 (기획 3.4)');
const mv = Object.fromEntries(WEAPONS.map(w => [w.kind, w.move]));
check(mv.smg === 1.1 && mv.shotgun === 1.05 && mv.ar === 1 && mv.sniper === 0.9 && mv.lmg === 0.85, '무기별 이동 속도 (기획 2.3)', JSON.stringify(mv));
const sf = k => WEAPONS.find(w => w.kind === k);
check(['smg', 'shotgun'].every(k => sf(k).sprintFire && sf(k).slideFire) && ['ar', 'sniper', 'lmg'].every(k => !sf(k).sprintFire && !sf(k).slideFire), '이동 중 사격 표 (기획 2.4)');
const draws = ['smg', 'shotgun', 'ar', 'sniper'].map(k => sf(k).draw);
check(draws.every((d, i) => i === 0 || d > draws[i - 1]) && sf('lmg').draw > sf('ar').draw, '무기 교체 속도: SMG < 산탄 < AR < 저격·LMG', draws.join(','));
check(SKILLS.length >= 19 && MODES.dom.rules === 'domination' && MODES.dom.goal === 100 && MODES.dom.minutes === 10, '스킬 · 점령전 모드(100점, 10분)');
check(MAP_IDS.includes('outpost') && getMap('outpost').zones.length === 3, '보관 맵: 전초기지 거점 3개');
check(MAP_IDS[0] === 'courtyard' && Object.values(MODES).every(m => m.map === 'courtyard'), '대표 맵: 골목극장 (맵 목록 첫 번째 · 모든 모드 기본 맵)');
check(['courtyard', 'aster', 'shiftcore'].every(id => MAP_IDS.includes(id) && getMap(id).zones.map(z => z.id).join('') === 'ABC'), '레벨 디자인 v2.0 세 맵: 거점 A·B·C');
{ // 대칭 맵: 두 팀 스폰·거점 A/B 가 반대편 짝 (01 좌우 반사, 02·03 180° 회전)
  const flip = { courtyard: ([x, z]) => [-x, z], aster: ([x, z]) => [-x, -z], shiftcore: ([x, z]) => [-x, -z] };
  for (const [id, f] of Object.entries(flip)) {
    const m = getMap(id), [a, b] = m.spawns.team, A = m.zones.find(z => z.id === 'A'), B = m.zones.find(z => z.id === 'B');
    const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
    check(a.every((p, i) => same(f(p), b[i])) && same(f([A.x, A.z]), [B.x, B.z]), `${id}: 두 팀 스폰·거점이 대칭`);
  }
}

console.log('[이동]');
{
  const lo = LO('ar', 'dash', 'revolver', 'roll');
  const ps = newPlayerSim(1, lo);
  run(ps, lo, 120, { fwd: 1 });
  const v = Math.hypot(ps.vx, ps.vz);
  check(Math.abs(v - MOVE.walk) < 0.05, `걷기 속도 ${v.toFixed(2)} ≈ ${MOVE.walk}`);
  run(ps, lo, 90, { fwd: 1, btn: BTN.sprint });
  const vs = Math.hypot(ps.vx, ps.vz);
  check(Math.abs(vs - MOVE.sprint) < 0.05 && ps.sprinting, `달리기 속도 ${vs.toFixed(2)}`);
  const smg = LO('mp5', 'overheat', 'ar', 'dash'), p2 = newPlayerSim(2, smg);
  run(p2, smg, 120, { fwd: 1, btn: BTN.sprint });
  check(Math.abs(Math.hypot(p2.vx, p2.vz) - MOVE.sprint * 1.1) < 0.06, 'SMG 를 들면 110% 속도');
  // 슬라이딩
  let ev = run(ps, lo, 1, { fwd: 1, btn: BTN.sprint | BTN.crouch })[0];
  check(ev.move.slideStart && Math.hypot(ps.vx, ps.vz) > MOVE.sprint + 2, '달리다 C = 슬라이딩 (속도 증가)');
  check(ps.h < 1.5 || ps.slide > 0, '슬라이딩 중 몸이 낮아진다');
  const sp0 = Math.hypot(ps.vx, ps.vz);
  run(ps, lo, 20, { fwd: 1, btn: BTN.sprint | BTN.crouch });
  check(Math.hypot(ps.vx, ps.vz) < sp0 && ps.slide > 0, '슬라이딩 속도는 점점 줄어든다');
  ev = run(ps, lo, 1, { fwd: 1, btn: BTN.sprint | BTN.crouch | BTN.jump })[0];
  check(ev.move.jumped && ev.move.slideEnd && Math.hypot(ps.vx, ps.vz) > MOVE.sprint, '슬라이딩 점프는 속도를 유지한다');
  run(ps, lo, 60, {});
  // 이어 달리기 (Apex 식)
  const ch = LO('m870', 'kickback', 'ar', 'dash');
  const jumpTop = (p, lo2, btn) => { let t = 0; for (let i = 0; i < 80; i++) { stepPlayer(p, { fwd: 1, side: 0, btn: i === 0 ? btn | BTN.jump : btn, yaw: 0, pitch: 0, slot: 0 }, lo2, open, DT); t = Math.max(t, p.y); } return t; };
  {
    const a = newPlayerSim(40, ch); run(a, ch, 60, { fwd: 1, btn: BTN.sprint }); run(a, ch, 1, { fwd: 1, btn: BTN.sprint | BTN.jump });
    let slid = null; for (let i = 0; i < 80 && !slid; i++) { const e = stepPlayer(a, { fwd: 1, side: 0, btn: BTN.sprint | BTN.crouch, yaw: 0, pitch: 0, slot: 0 }, ch, open, DT); if (e.move.slideStart) slid = Math.hypot(a.vx, a.vz); }
    check(slid > MOVE.sprint + 1, `점프 중 C 를 누르고 착지하면 바로 빠른 슬라이딩 (${slid && slid.toFixed(2)}m/s)`);
    const b = newPlayerSim(41, ch); run(b, ch, 60, { fwd: 1, btn: BTN.sprint }); run(b, ch, 2, { fwd: 1, btn: BTN.sprint | BTN.crouch });
    const hi = jumpTop(b, ch, BTN.sprint | BTN.crouch), c = newPlayerSim(42, ch), lo2 = jumpTop(c, ch, 0);
    check(hi > lo2 + 0.2, `슬라이딩 점프가 더 높다 (${hi.toFixed(2)}m > ${lo2.toFixed(2)}m)`);
    const d = newPlayerSim(43, ch); run(d, ch, 60, { fwd: 1, btn: BTN.sprint }); const sp = [];
    for (let k = 0; k < 8; k++) { run(d, ch, 12, { fwd: 1, btn: BTN.sprint | BTN.crouch }); run(d, ch, 1, { fwd: 1, btn: BTN.sprint | BTN.crouch | BTN.jump }); for (let n = 0; n < 120 && (!d.ground || n < 2); n++) stepPlayer(d, { fwd: 1, side: 0, btn: BTN.sprint | BTN.crouch, yaw: 0, pitch: 0, slot: 0 }, ch, open, DT); sp.push(Math.hypot(d.vx, d.vz)); }
    check(sp[0] > MOVE.sprint + 1 && sp[7] <= sp[1] + 0.01, `슬라이딩 점프를 이어 가면 속도가 유지되다 천천히 준다 (무한 가속 없음: ${sp.map(v => v.toFixed(1)).join(' ')})`);
    const e = newPlayerSim(44, ch); run(e, ch, 40, { fwd: 1, btn: BTN.sprint });
    run(e, ch, 1, { fwd: -1, btn: BTN.fire, yaw: Math.PI, pitch: -0.5 }); let ls = 0;
    for (let i = 0; i < 120 && !ls; i++) { const ev = stepPlayer(e, { fwd: -1, side: 0, btn: BTN.crouch, yaw: Math.PI, pitch: -0.5, slot: 0 }, ch, open, DT); if (ev.move.slideStart) ls = Math.hypot(e.vx, e.vz); }
    check(ls > 11, `샷건 반동으로 날아가 착지하면 빠른 슬라이딩으로 이어진다 (${ls.toFixed(2)}m/s)`);
    const f = newPlayerSim(45, ch); run(f, ch, 60, { fwd: 1, btn: BTN.sprint }); run(f, ch, 1, { fwd: 1, btn: BTN.sprint | BTN.crouch }); const s0 = Math.hypot(f.vx, f.vz);
    run(f, ch, 1, { fwd: -1, btn: BTN.crouch | BTN.fire, yaw: Math.PI, pitch: -0.15 });
    check(Math.hypot(f.vx, f.vz) > s0 + 5 && f.slide > 0, '슬라이딩 중 뒤로 쏘면 반동으로 더 빨라진다');
  }
  // 점프 높이·코요테
  const p3 = newPlayerSim(3, lo); let top = 0;
  run(p3, lo, 60, i => ({ btn: i === 0 ? BTN.jump : 0 })).forEach(() => {});
  const p4 = newPlayerSim(4, lo);
  for (let i = 0; i < 60; i++) { stepPlayer(p4, { fwd: 0, side: 0, btn: i === 0 ? BTN.jump : 0, yaw: 0, pitch: 0, slot: 0 }, lo, open, DT); top = Math.max(top, p4.y); }
  check(top > 0.95 && top < 1.2, `점프 높이 ${top.toFixed(2)}m`);
  // 공중에서는 빨라지지 않는다 (버니합 방지)
  const p5 = newPlayerSim(5, lo); run(p5, lo, 60, { fwd: 1 });
  let maxAir = 0;
  for (let i = 0; i < 300; i++) { const e = stepPlayer(p5, { fwd: 1, side: i % 20 < 10 ? 1 : -1, btn: BTN.jump, yaw: Math.sin(i / 10), pitch: 0, slot: 0 }, lo, open, DT); if (!p5.ground) maxAir = Math.max(maxAir, Math.hypot(p5.vx, p5.vz)); void e; }
  check(maxAir <= MOVE.walk * 1.03, `점프·좌우 흔들기를 반복해도 빨라지지 않는다 (공중 최고 ${maxAir.toFixed(2)})`);
  // 질주 스킬: 점프해도 달리는 속도
  const sl = LO('ar', 'sprint', 'revolver', 'roll'), p6 = newPlayerSim(6, sl);
  run(p6, sl, 60, { fwd: 1, btn: BTN.sprint }); run(p6, sl, 1, { fwd: 1, btn: BTN.sprint | BTN.jump });
  check(Math.hypot(p6.vx, p6.vz) > MOVE.sprint - 0.1, '질주 스킬: 점프해도 달리기 속도 유지');
  // 벽 충돌 · 빠른 이동도 뚫지 않는다
  const wall = [{ minX: -5, maxX: 5, minY: 0, maxY: 3, minZ: -6, maxZ: -5.8 }];
  const p7 = newPlayerSim(7, lo); applyImpulse(p7, 0, 0, -60, 0.1);
  for (let i = 0; i < 30; i++) stepPlayer(p7, { fwd: 0, side: 0, btn: 0, yaw: 0, pitch: 0, slot: 0 }, lo, wall, DT);
  check(p7.z > -5.8 + 0.3, `초속 60m 로 밀려도 얇은 벽을 뚫지 않는다 (z=${p7.z.toFixed(2)})`);
  // 계단(턱) 오르기
  const step = [{ minX: -5, maxX: 5, minY: 0, maxY: 0.4, minZ: -10, maxZ: -2 }];
  const p8 = newPlayerSim(8, lo); run(p8, lo, 60, { fwd: 1 }, step);
  check(Math.abs(p8.y - 0.4) < 0.01, '낮은 턱은 걸어서 올라선다');
  // 넉백: 미끄러진다
  const m = newMove(); applyImpulse(m, 10, 3, 0, 0.5);
  for (let i = 0; i < 15; i++) stepMove(m, NO_MOVE, open, DT);
  check(m.x > 1.5, `넉백은 마찰이 줄어 멀리 밀린다 (${m.x.toFixed(2)}m)`);
}

console.log('[무기]');
{
  const lo = LO('ar', 'adrenaline', 'awm', 'grapple'), ps = newPlayerSim(10, lo);
  run(ps, lo, 40, {}); // 꺼내기 끝
  let ev = run(ps, lo, 60, { btn: BTN.fire });
  check(Math.abs(shots(ev) - 650 / 60) <= 1, `AR 1초 사격 수 ${shots(ev)} ≈ 분당 650발`);
  // 교체 중에는 못 쏜다
  ev = run(ps, lo, 1, { btn: BTN.fire, slot: 1 });
  const drawTicks = Math.ceil(WEAPONS.find(w => w.id === 'awm').draw / DT);
  ev = run(ps, lo, drawTicks - 2, { btn: BTN.fire, slot: 1 });
  check(shots(ev) === 0, '교체 중(꺼내는 시간)에는 쏠 수 없다');
  ev = run(ps, lo, 6, i => ({ btn: i % 2 ? BTN.fire : 0, slot: 1 }));
  check(shots(ev) === 1, '꺼낸 뒤에는 쏠 수 있다');
  // 달리기 중 AR 사격 불가 / SMG 가능 / 슬라이딩
  const a = newPlayerSim(11, lo); run(a, lo, 60, { fwd: 1, btn: BTN.sprint });
  ev = run(a, lo, 1, { fwd: 1, btn: BTN.sprint | BTN.fire });
  check(shots(ev) === 0 && !a.sprinting, 'AR: 달리다 쏘면 달리기가 멈추고 바로는 안 나간다');
  ev = run(a, lo, 12, { fwd: 1, btn: BTN.sprint | BTN.fire });
  check(shots(ev) >= 1, 'AR: 잠깐 뒤(달리기 해제) 사격');
  const s = LO('mp5', 'overheat', 'ar', 'dash'), b = newPlayerSim(12, s); run(b, s, 60, { fwd: 1, btn: BTN.sprint });
  ev = run(b, s, 30, { fwd: 1, btn: BTN.sprint | BTN.fire });
  check(shots(ev) >= 7 && b.sprinting, `SMG: 달리면서 사격 (0.5초 ${shots(ev)}발)`);
  const c = newPlayerSim(13, lo); run(c, lo, 60, { fwd: 1, btn: BTN.sprint }); run(c, lo, 1, { fwd: 1, btn: BTN.sprint | BTN.crouch });
  ev = run(c, lo, 10, { fwd: 1, btn: BTN.crouch | BTN.fire });
  check(c.slide > 0 && shots(ev) === 0, 'AR: 슬라이딩 중 사격 불가');
  // 슬라이딩 중 탄퍼짐 증가
  const d = newPlayerSim(14, s); run(d, s, 60, { fwd: 1, btn: BTN.sprint }); const before = spreadOf(d, s);
  run(d, s, 1, { fwd: 1, btn: BTN.sprint | BTN.crouch });
  check(spreadOf(d, s) > before * 1.3, '슬라이딩 중 명중률 저하');
  // 탄창 · 재장전 · 자동 재장전
  const e = newPlayerSim(15, lo); run(e, lo, 40, {});
  run(e, lo, 240, { btn: BTN.fire });
  check(e.w[0].ammo === 30 || e.w[0].rl > 0, '탄창을 다 쓰면 자동 재장전');
  // 결정성: 같은 입력 → 같은 결과 (서버와 브라우저 예측이 같다)
  const x = newPlayerSim(16, lo), y = copySim({}, x);
  const script = i => ({ fwd: 1, side: i % 50 < 25 ? 1 : -1, btn: BTN.fire | (i % 40 === 0 ? BTN.jump : 0) | (i % 90 === 5 ? BTN.sk1 : 0), yaw: i * 0.013, pitch: Math.sin(i / 30) * 0.3, slot: i > 200 ? 1 : 0 });
  const ex = run(x, lo, 400, script, cs), ey = run(y, lo, 400, script, cs);
  const sameShots = JSON.stringify(ex.flatMap(q => q.shots.map(t => t.dirs))) === JSON.stringify(ey.flatMap(q => q.shots.map(t => t.dirs)));
  check(x.x === y.x && x.z === y.z && x.fireN === y.fireN && sameShots, `결정성: 400 tick 뒤 위치·사격·탄 방향이 완전히 같다 (사격 ${x.fireN})`);
}

console.log('[스킬]');
{
  const step = (ps, lo, btn, n = 1, extra = {}) => run(ps, lo, n, { btn, ...extra });
  // 대쉬
  let lo = LO('ar', 'dash', 'revolver', 'roll'), ps = newPlayerSim(20, lo);
  let ev = step(ps, lo, BTN.sk1); const x0 = ps.z;
  run(ps, lo, 12, {});
  check(ev[0].skills && Math.abs(ps.z - x0) > 5, `대쉬: 앞으로 ${Math.abs(ps.z - x0).toFixed(1)}m`);
  check(ps.sk[0].cd > 5, '대쉬 쿨타임');
  // 구르기 = 무적
  step(ps, lo, BTN.sk2);
  check(ps.st.invuln > 0 && ps.mo && ps.mo.k === 'roll', '구르기: 무적');
  // 아드레날린 = 공격 속도 +40%
  lo = LO('ar', 'adrenaline', 'revolver', 'roll'); ps = newPlayerSim(21, lo); run(ps, lo, 40, {});
  step(ps, lo, BTN.sk1);
  ev = run(ps, lo, 60, { btn: BTN.fire });
  check(shots(ev) >= Math.floor(650 * 1.4 / 60) - 1, `아드레날린: 1초 ${shots(ev)}발`);
  // 패닝: 6발 연속
  lo = LO('revolver', 'fanning', 'ar', 'dash'); ps = newPlayerSim(22, lo); run(ps, lo, 30, {});
  ev = run(ps, lo, 40, i => ({ btn: i === 0 ? BTN.sk1 : 0 }));
  check(shots(ev) === 6 && ps.w[0].ammo === 0, '패닝: 6발을 빠르게');
  // 퀵드로우: 3초 쉬면 피해 +30%
  lo = LO('revolver', 'quickdraw', 'ar', 'dash'); ps = newPlayerSim(23, lo); run(ps, lo, 200, {});
  ev = run(ps, lo, 2, i => ({ btn: i === 0 ? BTN.fire : 0 }));
  check(ev[0].shots[0].mul > 1.29 && ev[0].shots[0].close === 8, '퀵드로우: 다음 사격 +30%, 가까우면 추가');
  // 백스텝 → 다음 사격 2배
  lo = LO('awm', 'backstep', 'ar', 'dash'); ps = newPlayerSim(24, lo); run(ps, lo, 60, {});
  step(ps, lo, BTN.sk1); const zb = ps.z; run(ps, lo, 30, {});
  ev = run(ps, lo, 2, i => ({ btn: i === 0 ? BTN.fire : 0 }));
  check(ps.z > zb + 1.5 && ev[0].shots[0].mul >= 2, '백스텝: 뒤로 + 다음 사격 2배');
  // 그래플: 벽에 걸고 끌려간다
  const wall = [{ minX: -10, maxX: 10, minY: 0, maxY: 10, minZ: -20.5, maxZ: -20 }];
  lo = LO('awm', 'grapple', 'ar', 'dash'); ps = newPlayerSim(25, lo);
  ev = run(ps, lo, 1, { btn: BTN.sk1, pitch: 0.15 }, wall); run(ps, lo, 50, { pitch: 0.15 }, wall);
  check(ev[0].grapple && ps.z < -12, `그래플: 끌려갔다 (z=${ps.z.toFixed(1)})`);
  const p2 = newPlayerSim(26, lo); ev = run(p2, lo, 1, { btn: BTN.sk1, pitch: 1 }, wall);
  check(!ev[0].skills && p2.sk[0].cd === 0, '그래플: 닿는 곳이 없으면 쿨타임을 쓰지 않는다');
  // 대구경: 관통
  lo = LO('awm', 'caliber', 'ar', 'dash'); ps = newPlayerSim(27, lo); run(ps, lo, 60, { btn: BTN.ads });
  ev = run(ps, lo, 1, { btn: BTN.fire | BTN.ads });
  const sh = ev[0].shots[0], r = castRay(sh.o, sh.dirs[0], 100, [], [{ id: 1, x: 0, y: 0, z: -5, crouch: 0 }, { id: 2, x: 0, y: 0, z: -9, crouch: 0 }], sh.pierce);
  check(r.hits.length === 2, '대구경: 두 명을 뚫고 맞힌다');
  // 슬래시: 칼을 꺼내고 돌진 + 피해 감소
  lo = LO('ar', 'dash', 'knife', 'slash'); ps = newPlayerSim(28, lo); run(ps, lo, 40, {});
  ev = run(ps, lo, 30, i => ({ btn: i === 0 ? BTN.sk2 : 0, slot: 1 }));
  check(ev.some(e => e.slash) && ps.cur === 1, '슬래시: 칼을 꺼낸 뒤 돌진');
  // 스텔스: 무기를 바꾸면 풀린다
  ps = newPlayerSim(29, LO('knife', 'stealth', 'ar', 'dash')); lo = LO('knife', 'stealth', 'ar', 'dash'); run(ps, lo, 20, {});
  step(ps, lo, BTN.sk1);
  check(ps.st.stealth > 1.4, '스텔스: 1.5초 투명');
  run(ps, lo, 1, { slot: 1 });
  check(ps.st.stealth === 0, '스텔스: 무기를 바꾸면 풀린다');
  // 반동 이동 (산탄총): 아래로 쏘면 뜬다
  lo = LO('m870', 'kickback', 'ar', 'dash'); ps = newPlayerSim(30, lo); run(ps, lo, 40, {});
  run(ps, lo, 1, { btn: BTN.fire, pitch: -1.4 });
  check(ps.vy > 5, '반동 이동: 아래로 쏘면 위로 뜬다');
  // 넉백 준비 → 다음 사격에 실린다
  lo = LO('m870', 'shove', 'ar', 'dash'); ps = newPlayerSim(31, lo); run(ps, lo, 40, {});
  step(ps, lo, BTN.sk1); ev = run(ps, lo, 2, i => ({ btn: i === 0 ? BTN.fire : 0 }));
  check(ev[0].shots[0].knock && ev[0].shots[0].knock.stun === 0.5, '넉백: 다음 사격이 넘어뜨린다(0.5초)');
  // 보조무기 자리 값 (기획 3.3: 같은 스킬이라도 자리에 따라 다르다)
  const l2 = makeLoadout([{ id: 'revolver', skill: 'roll' }, { id: 'ar', skill: 'dash' }]);
  check(l2[1].skill.cd === 5 && l2[1].skill.dist === 5, '대쉬를 보조무기 자리에 두면 값이 다르다');
  // 같은 무기 두 번 금지
  const dup = makeLoadout([{ id: 'ar' }, { id: 'ar' }]);
  check(dup[0].w.id !== dup[1].w.id, '같은 무기를 두 자리에 넣을 수 없다');
  // 부활 보호: 공격하면 풀린다
  lo = LO('ar', 'dash', 'revolver', 'roll'); ps = newPlayerSim(32, lo);
  check(ps.st.protect > 2.9, '부활하면 보호 상태');
  run(ps, lo, 40, {}); run(ps, lo, 1, { btn: BTN.fire });
  check(ps.st.protect === 0, '쏘면 보호가 풀린다');
  ps = newPlayerSim(33, lo); step(ps, lo, BTN.sk1);
  check(ps.st.protect === 0, '액티브 스킬을 쓰면 보호가 풀린다');
}

console.log('[점령 규칙 (기획 7.4)]');
{
  const cfg = MODES.dom.dom;
  const p = newPoint({ id: 'A' });
  stepPoint(p, [1, 0], 1, cfg);
  check(p.team === 0 && Math.abs(p.prog - 1 / cfg.capture) < 1e-9, '중립: 한 팀만 있으면 진행');
  const q = newPoint({ id: 'A' }); stepPoint(q, [2, 0], 1, cfg);
  check(q.prog > p.prog, '두 명이면 더 빠르다');
  stepPoint(p, [1, 1], 3, cfg);
  check(p.contested && Math.abs(p.prog - 1 / cfg.capture) < 1e-9, '양 팀이 있으면 멈춘다 (경합)');
  stepPoint(p, [0, 0], 3, cfg);
  check(Math.abs(p.prog - 1 / cfg.capture) < 1e-9, '아무도 없으면 그대로');
  let cap = -1; for (let i = 0; i < 20 && cap < 0; i++) cap = stepPoint(p, [1, 0], 1, cfg);
  check(cap === 0 && p.owner === 0 && p.prog === 0, '다 차면 그 팀 소유 · 진행도 0');
  stepPoint(p, [1, 3], 2, cfg);
  check(p.owner === 0 && p.prog === 0, '소유 팀이 한 명이라도 있으면 적은 점령을 시작할 수 없다');
  stepPoint(p, [0, 1], 2, cfg);
  check(p.team === 1 && p.prog > 0, '소유 팀이 없으면 적이 점령 진행');
  const before = p.prog; stepPoint(p, [1, 0], 1, cfg);
  check(p.prog < before && p.owner === 0, '소유 팀만 있으면 적의 진행도가 줄어든다');
  const acc = [0, 0], pts = [{ owner: 0 }, { owner: 0 }, { owner: 1 }];
  const sc = scoreTick(pts, acc, 10, cfg);
  check(sc[0] === Math.floor(2 * cfg.scoreRate * 10) && sc[1] === Math.floor(cfg.scoreRate * 10), '점수: 가진 거점 수에 비례');
  check(judge([100, 40], 100, false, false, false).over, '100점 먼저 = 승리');
  const t = judge([50, 50], 100, true, false, false);
  check(!t.over && t.overtime, '시간 끝 동점 = 연장전');
  check(judge([51, 50], 100, true, true, false).winner === 0, '연장전: 점수가 갈리는 순간 끝');
}

console.log('[스폰 · 판정 · 기타]');
{
  const spawns = [[0, 0], [30, 0], [60, 0]];
  const ctx = { enemies: [{ x: 0, z: 2, y: 1.6 }], allies: [], objective: null, used: new Map(), last: null, sees: () => false };
  check(pickDynamic(spawns, ctx, () => 0.5)[0] !== 0, '적 바로 옆 스폰은 피한다');
  const far = scoreSpawn([60, 0], ctx), mid = scoreSpawn([30, 0], ctx);
  check(mid > far, '가장 먼 곳보다 교전에 끼기 좋은 거리를 고른다');
  ctx.used.set(spawns[1], 3);
  check(scoreSpawn(spawns[1], ctx) < mid, '자주 쓴 자리는 점수가 낮다');
  const w = WEAPONS.find(x => x.id === 'ar');
  check(calcDamage(w, 'head', 10) === w.dmg * w.head && calcDamage(w, 'body', 100) < w.dmg, '피해: 헤드샷 배율·거리 감쇠');
  check(Math.ceil(HEALTH.max / w.dmg) >= 6, `AR 몸 ${Math.ceil(HEALTH.max / w.dmg)}발 처치 (체력 ${HEALTH.max})`);
  check(sanitizeChat('  안녕\n하세요  ') === '안녕 하세요' && sanitizeChat('') === null, '채팅 글자 정리');
}

process.exit(failed() ? 1 : 0);
