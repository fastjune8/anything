// 듀얼 쿠나이 테스트 (약 30초): 공용 시뮬레이션(결정적) + 실제 서버 판정
//   W1 좌우 독립 발사·비행·앵커·회수 · W2 기동(끌려가기·방향 틀기·점프로 놓기·하나 회수하면 남은 쪽으로) · W3 모드 전환(앵커·와이어 유지)
//   W4 와이어(앵커 2개, 감지·느려짐·총으로 끊기) · W5 수명(앵커 20초·와이어 8초 따로, 앵커가 빠지면 와이어도) · W6 기동 중 부딪힘 공격
//   + 직접 명중 (몸 45 · 머리 110, 처치하면 그 쿠나이가 바로 손으로)
import { check, failed, startServer, connect, sleep } from './helpers.mjs';
import { getMap } from '../shared/maps/index.js';
import { makeLoadout, newPlayerSim, stepPlayer, copySim } from '../shared/sim/player.js';
import { BTN, DT } from '../shared/sim/config.js';
import { KS, KUNAI, segSegDist, pullTarget, wireOn, wireTime, THREAD, planThread, areaValid, areaShape, inArea } from '../shared/sim/kunai.js';
import { segProblem } from '../shared/sim/thread.js';
import { respawnSim } from '../shared/sim/player.js';
import { WEAPONS, calcDamage } from '../shared/weapons.js';

const cs = getMap('courtyard').layout.colliders;
const lo = makeLoadout([{ id: 'kunai' }, { id: 'revolver' }]);
const N = Math.PI, E = -Math.PI / 2, Wd = Math.PI / 2;
const sim = (x, z, yaw) => { const ps = newPlayerSim(1, lo, x, 0, z, yaw); ps.st.protect = 0; return ps; };
const run = (ps, n, c = {}) => { const evs = []; for (let i = 0; i < n; i++) evs.push(stepPlayer(ps, { fwd: 0, side: 0, btn: 0, yaw: ps.yaw, pitch: ps.pitch, slot: 0, ...(typeof c === 'function' ? c(i) : c) }, lo, cs, DT)); return evs; };
const tap = (ps, btn, c = {}) => { run(ps, 1, { ...c, btn }); run(ps, 1, c); };
// 서쪽 길 x = −46, z = −14: 서쪽 큰 건물 벽 x = −49, 동쪽 상점 벽 x = −43 (둘 다 3m)
const WEST = { yaw: Wd, pitch: -0.16 }, EAST = { yaw: E, pitch: -0.16 };

console.log('[무기 데이터]');
const kw = WEAPONS.find(w => w.id === 'kunai');
check(kw && kw.kind === 'kunai' && Math.round(calcDamage(kw, 'body', 10)) === 45 && Math.round(calcDamage(kw, 'head', 10)) === 110, '듀얼 쿠나이: 몸 45 · 머리 110 (거리 감쇠 없음)');
check(lo[0].skill && lo[0].skill.effect === 'kunai', '무기 스킬 = 모드 능력 (실 조종)');

console.log('[W1 좌우 독립 · 비행 · 앵커 · 회수]');
{
  const ps = sim(-46, -14, Wd); run(ps, 40, WEST);
  tap(ps, BTN.fire, WEST);
  check(ps.ku[0].s === KS.FLY && ps.ku[1].s === KS.READY, '좌클릭 = 왼손만 던진다 (오른손은 그대로 준비)');
  run(ps, 10, WEST);
  check(ps.ku[0].s === KS.ANCHOR && Math.abs(ps.ku[0].x + 49) < 0.1 && Math.abs(ps.ku[0].t - KUNAI.anchorLife) < 0.3, `벽에 닿으면 그 자리에 박힌다 (x ${ps.ku[0].x.toFixed(2)}, 남은 ${ps.ku[0].t.toFixed(1)}초)`);
  tap(ps, BTN.ads, EAST); run(ps, 10, EAST);
  check(ps.ku[1].s === KS.ANCHOR && Math.abs(ps.ku[1].x + 43) < 0.1 && ps.ku[0].s === KS.ANCHOR, '한쪽이 박혀 있어도 다른 쪽을 따로 던진다 (우클릭 = 오른손)');
  check(ps.adsT === 0, '쿠나이를 든 동안 우클릭은 정조준이 아니다');
  tap(ps, BTN.fire, EAST);
  check(ps.ku[0].s === KS.RETURN && ps.ku[1].s === KS.ANCHOR, '박힌 쪽을 다시 누르면 그쪽만 회수');
  run(ps, 40);
  check(ps.ku[0].s === KS.READY, '회수가 끝나면 다시 던질 수 있다');
  tap(ps, BTN.reload); run(ps, 40);
  check(ps.ku.every(k => k.s === KS.READY), 'R = 둘 다 회수');
  const far = sim(-46, -14, N); tap(far, BTN.fire, { pitch: 0.02 }); run(far, 70, { pitch: 0.02 });
  check(far.ku[0].s !== KS.ANCHOR && far.ku[0].s !== KS.FLY, `최대 거리(${KUNAI.range}m)까지 아무것도 없으면 돌아온다`);
}

console.log('[W3 모드 전환 · W4 와이어 · W5 수명]');
{
  const ps = sim(-46, -14, Wd); run(ps, 40, WEST);
  tap(ps, BTN.fire, WEST); run(ps, 8, WEST);
  tap(ps, BTN.mode); check(ps.kmode === 1 && ps.ku[0].s === KS.ANCHOR, 'X = 설치 모드 (앵커는 그대로)');
  let ev = run(ps, 1, { btn: BTN.sk1 })[0]; run(ps, 1);
  check(!wireOn(ps) && ev.kunaiFail && ps.sk[0].cd === 0, `노드가 하나면 와이어를 못 만들고 쿨타임도 쓰지 않는다 ("${ev.kunaiFail}")`);
  tap(ps, BTN.ads, EAST); run(ps, 8, EAST);
  ev = run(ps, 1, { btn: BTN.sk1 })[0]; run(ps, 1);
  check(ev.wire && ev.threadKind === 'line' && wireTime(ps) > KUNAI.wireLife - 0.1, `앵커 2개 + 스킬 키 = 두 앵커 사이 와이어 (${KUNAI.wireLife}초)`);
  tap(ps, BTN.mode);
  check(ps.kmode === 0 && wireOn(ps) && ps.ku.every(k => k.s === KS.ANCHOR), '기동 모드로 바꿔도 와이어와 앵커는 남는다');
  run(ps, Math.round(KUNAI.wireLife * 60) + 5);
  check(!wireOn(ps) && ps.ku.every(k => k.s === KS.ANCHOR), '와이어가 먼저 사라져도 앵커는 남는다 (수명 따로)');
  check(!!pullTarget(ps), '…그래서 남은 앵커로 기동할 수 있다');
  tap(ps, BTN.mode); run(ps, 1, { btn: BTN.sk1 }); run(ps, 30);
  tap(ps, BTN.fire, WEST);
  check(!wireOn(ps) && ps.ku[0].s === KS.RETURN, '앵커 하나를 회수하면 와이어도 없어진다');
  run(ps, Math.round(KUNAI.anchorLife * 60) + 5);
  check(ps.ku[1].s !== KS.ANCHOR, `앵커는 ${KUNAI.anchorLife}초 뒤 스스로 돌아온다`);
  // 결정성: 복사한 상태에서 같은 입력 → 같은 결과 (예측 보정)
  const a = sim(-46, -14, Wd), b = sim(-46, -14, Wd);
  run(a, 30, WEST); tap(a, BTN.fire, WEST); run(a, 3, WEST); copySim(b, a);
  run(a, 20, WEST); run(b, 20, WEST);
  check(JSON.stringify(a.ku) === JSON.stringify(b.ku), '비행·앵커가 결정적이다 (서버 판정 = 브라우저 예측)');
}

console.log('[W2 기동]');
{
  const ps = sim(-46, -14, N); run(ps, 30, { pitch: 0.05 });
  const ev = run(ps, 1, { btn: BTN.sk1 })[0];
  check(!ps.mo && ev.kunaiFail, '앵커가 없으면 기동할 수 없다');
  tap(ps, BTN.fire, { yaw: E - 0.25, pitch: 0.1 }); tap(ps, BTN.ads, { yaw: E + 0.25, pitch: 0.1 }); run(ps, 12, { yaw: E });
  const tg = pullTarget(ps);
  check(ps.ku.every(k => k.s === KS.ANCHOR) && Math.abs(tg.x - (ps.ku[0].x + ps.ku[1].x) / 2) < 1e-9, '앵커 2개 → 목표는 두 앵커의 가운데');
  run(ps, 1, { btn: BTN.sk1, yaw: E });
  let maxStep = 0, px = ps.x, pz = ps.z;
  const evs = run(ps, 50, i => { const d = Math.hypot(ps.x - px, ps.z - pz); maxStep = Math.max(maxStep, d); px = ps.x; pz = ps.z; return { yaw: E }; });
  check(maxStep < KUNAI.pull.max * DT + 0.05, `순간이동이 아니라 가속해서 간다 (한 tick 최대 ${maxStep.toFixed(2)}m)`);
  check(evs.some(e => e.move.kpullEnd), '도착하면 기동이 끝난다');
  // 방향 틀기: 같은 앵커로 두 번, 한 번은 왼쪽 키를 누른 채로
  // 북쪽 끝 모서리 벽 (약 33m 앞)
  const go = side => { const p = sim(-46, 0, N); run(p, 20, { pitch: 0.06 }); tap(p, BTN.fire, { pitch: 0.06 }); run(p, 40, { pitch: 0.06 }); run(p, 1, { btn: BTN.sk1 }); run(p, 18, { side }); return p; };
  const straight = go(0), steered = go(-1);
  check(straight.ku[0].s === KS.ANCHOR && Math.abs(steered.x - straight.x) > 0.3, `기동 중 방향키로 궤적을 튼다 (${(steered.x - straight.x).toFixed(2)}m)`);
  const j = sim(-46, 0, N); run(j, 20, { pitch: 0.06 }); tap(j, BTN.fire, { pitch: 0.06 }); run(j, 40, { pitch: 0.06 }); run(j, 1, { btn: BTN.sk1 }); run(j, 10);
  const jev = run(j, 1, { btn: BTN.jump })[0];
  check(jev.move.kpullEnd && !j.mo && j.vy > 4, '점프 = 놓고 뛰어오른다');
  // 둘 중 하나를 회수하면 남은 앵커로 방향이 바뀐다
  const r = sim(-46, 0, N); run(r, 20);
  tap(r, BTN.fire, { yaw: Wd - 0.3, pitch: 0.2 }); tap(r, BTN.ads, { yaw: N, pitch: 0.06 }); run(r, 40);
  run(r, 1, { btn: BTN.sk1 }); run(r, 3);
  tap(r, BTN.fire); run(r, 2);
  check(r.mo && r.mo.k === 'kpull' && Math.abs(r.mo.tx - r.ku[1].x) < 1e-9, '기동 중 왼손을 회수하면 남은 오른손 앵커로 목표가 바뀐다');
}

console.log('[줄 이동: 위도우메이커식 턱 넘기]');
{
  // 문화관 옥상(+3.5m) 남쪽 모서리를 12m 앞에서 — 끝에서 턱을 넘겨 옥상 위에 선다
  const P = Math.atan2(3.35 - 1.52, 12);
  const k = sim(-22, 5, N); run(k, 20, { pitch: P }); tap(k, BTN.fire, { pitch: P }); run(k, 20, { pitch: P });
  const ev = run(k, 1, { btn: BTN.sk1, pitch: P }); let pop = false; for (const e of run(k, 120, { pitch: P })) pop = pop || e.move.ledgePop;
  check(pop && k.ground && Math.abs(k.y - 3.5) < 0.01 && k.z > 17.2, `쿠나이: 모서리에 박으면 끝에서 턱을 넘어 옥상에 선다 (y ${k.y.toFixed(2)})`, JSON.stringify(ev[0].kunaiFail || ''));
  const glo = makeLoadout([{ id: 'awm', skill: 'grapple' }, { id: 'ar' }]), g = newPlayerSim(2, glo, -22, 0, 5, N); g.st.protect = 0;
  const gs = (btn = 0) => stepPlayer(g, { fwd: 0, side: 0, btn, yaw: N, pitch: P, slot: 0 }, glo, cs, DT);
  for (let i = 0; i < 20; i++) gs(); gs(BTN.sk1);
  let v0 = Math.hypot(g.vx, g.vy, g.vz);
  for (let i = 0; i < 120; i++) gs();
  check(v0 > 15 && g.ground && Math.abs(g.y - 3.5) < 0.01, `그래플도 같은 방식: 바로 빠르게 출발(${v0.toFixed(1)} m/s) → 턱 넘어 옥상`);
}

console.log('[W9 와이어 네트워크: 형태 · 노드 · 교차 · 영역]');
{
  // 서쪽 길 (x −46, z −14): 왼손 = 서쪽 벽, 오른손 = 동쪽 상점 벽, 핀 = 바닥 (aimFloor 로 조준)
  const aimFloor = (ps, x, z) => { const dx = x - ps.x, dz = z - ps.z; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(-1.52, Math.hypot(dx, dz)) }; };
  const setup = () => { const ps = sim(-46, -14, Wd); run(ps, 30, WEST); tap(ps, BTN.fire, WEST); run(ps, 8, WEST); tap(ps, BTN.ads, EAST); run(ps, 8, EAST); tap(ps, BTN.mode); return ps; };
  // W9-1 형태: 바닥 핀 + 벽 높은 곳 쿠나이 → 기울어진/세로 와이어 (방향은 실제 좌표 그대로)
  const v = sim(-46, -14, Wd); run(v, 30); tap(v, BTN.fire, { yaw: Wd, pitch: 0.55 }); run(v, 8, { yaw: Wd }); tap(v, BTN.node, aimFloor(v, -48.3, -14)); tap(v, BTN.mode);
  let ev = run(v, 1, { btn: BTN.sk1 })[0]; run(v, 1);
  const [wa, wb] = [v.ku[0], v.pins[0]];
  check(ev.threadKind === 'line' && Math.abs(wa.y - wb.y) > Math.hypot(wa.x - wb.x, wa.z - wb.z), `세로에 가까운 와이어: 벽 위 쿠나이 ↔ 바닥 핀 (높이 차 ${Math.abs(wa.y - wb.y).toFixed(1)}m)`);
  check(segProblem(cs, { x: -46, y: 1, z: -14 }, { x: -40, y: 1, z: -14 }) === '노드 사이가 막혀 있다', '설치 검사: 벽(상점)을 뚫는 와이어는 안 된다');
  check(/까지/.test(segProblem(cs, { x: -46, y: 1, z: -14 }, { x: -46, y: 1, z: 20 }) || ''), `설치 검사: ${THREAD.maxLen}m 넘는 와이어는 안 된다`);
  check(segProblem(cs, { x: -46, y: 1, z: -14 }, { x: -46, y: 1, z: -14.5 }) === '노드가 너무 가깝다', '설치 검사: 너무 짧은 와이어는 안 된다');
  // 핀 노드 (F): 충전식 2개
  const p = setup();
  tap(p, BTN.node, aimFloor(p, -43.6, -8));
  check(p.pins[0].on && p.pinCh === 1 && Math.abs(p.pins[0].y) < 0.05, `F = 조준한 곳에 핀 노드 (남은 충전 ${p.pinCh})`);
  check(p.ku.every(k => k.s === KS.ANCHOR), '핀을 박아도 쿠나이 발사·회수 상태는 그대로');
  // 노드 3개 → 삼각 영역
  ev = run(p, 1, { btn: BTN.sk1 })[0]; run(p, 1);
  check(ev.threadKind === 'area' && p.wires.length === 3 && p.area && p.area.n.length === 3 && areaValid(p), '노드 3개 + 스킬 키 = 삼각 영역 (변 3개)');
  const sh = areaShape(p);
  check(inArea(sh, -45.5, 0, -11) && !inArea(sh, -46, 0, -4) && !inArea(sh, -45.5, 6, -11), '영역 안/밖 판정 (위에서 본 다각형 + 높이 범위)');
  // 노드 4개: 사각 영역 / 교차 와이어
  tap(p, BTN.node, aimFloor(p, -48.4, -8)); run(p, 35); // 스킬 쿨타임 0.5초
  ev = run(p, 1, { btn: BTN.sk1 })[0]; run(p, 1);
  check(ev.threadKind === 'area' && p.wires.length === 4 && p.area.n.length === 4, '노드 4개 = 사각 영역 (변 4개)');
  const c = setup(); tap(c, BTN.node, aimFloor(c, -46, -9)); tap(c, BTN.node, aimFloor(c, -46, -19));
  ev = run(c, 1, { btn: BTN.sk1 })[0]; run(c, 1);
  check(ev.threadKind === 'cross' && c.wires.length === 2 && !c.area, '첫 두 노드 선과 뒤 두 노드 선이 엇갈리면 교차 와이어 2개 (각각 따로 판정)');
  check(p.pinCh === 0 && run(p, 1, { btn: BTN.node, ...aimFloor(p, -46, -10) })[0].kunaiFail, '핀은 충전이 없으면 못 박는다');
  // 일부만 빠질 때: 쿠나이 하나를 회수하면 그 노드의 선분만 빠지고 영역은 풀린다
  tap(p, BTN.fire);
  check(p.wires.length === 2 && !p.area && p.wires.every(w => w.a >= 1 && w.b >= 1), '왼손을 회수하면 그 앵커에 걸린 선분만 없어지고, 나머지 선분은 남고, 영역은 풀린다');
  // 선분 하나가 끊기면 (서버가 지운다) 영역만 풀리고 나머지는 남는다
  const q = setup(); tap(q, BTN.node, aimFloor(q, -43.6, -8)); run(q, 1, { btn: BTN.sk1 }); run(q, 1);
  q.wires.splice(0, 1); run(q, 1);
  check(!q.area && q.wires.length === 2, '선분 하나가 끊기면 영역은 풀리고 남은 선분은 그대로');
  // 무기 교체해도 남고, 핀이 만료되면 그 선분이 빠진다, 죽으면 모두 정리
  run(q, 1, { slot: 1 }); run(q, 30, { slot: 1 });
  check(q.wires.length === 2 && q.pins[0].on, '무기를 바꿔도 노드·와이어는 남는다');
  const r = setup(); tap(r, BTN.node, aimFloor(r, -46, -9)); run(r, 1, { btn: BTN.sk1 }); run(r, 1);
  run(r, Math.round(THREAD.pin.life * 60) + 2);
  check(!r.pins[0].on && !r.area && r.wires.length === 0, `핀은 ${THREAD.pin.life}초 뒤 사라지고, 걸린 선분·영역도 같이 정리 (앵커만 남는다)`);
  respawnSim(q, lo, -46, 0, -14, 0);
  check(!q.wires.length && !q.area && !q.pins.some(x => x.on) && q.pinCh === THREAD.pin.charges, '죽고 다시 태어나면 노드·와이어·영역이 모두 정리된다');
  check(planThread(sim(-46, -14, 0), cs).fail, '노드가 없으면 미리보기에 이유가 나온다');
}

console.log('[기하]');
{
  const d = segSegDist({ x: 0, y: 1, z: -2 }, { x: 0, y: 1, z: 2 }, { x: 0.3, y: 0, z: 0 }, { x: 0.3, y: 1.7, z: 0 });
  check(Math.abs(d.d - 0.3) < 1e-9 && Math.abs(d.s - 0.5) < 1e-9, '와이어 ↔ 몸 거리 (선분-선분)');
}

// ───── 실제 서버 ─────
const servers = [];
const cmd = (o = {}) => [o.fwd || 0, o.side || 0, o.btn || 0, o.yaw || 0, o.pitch || 0, o.slot || 0, o.vt || 0];
const lastMe = c => c.all('me').pop();
try {
  const S = await startServer({ RESPAWN_SECONDS: '1', BOT_FILL: '0' }); servers.push(S);
  const C = await connect(S.port, '쿠나이').ready(), D = await connect(S.port, '표적').ready();
  C.send({ t: 'lo', loadout: [{ id: 'kunai', skill: 'thread' }, { id: 'revolver' }] }); await C.waitFor('lo');
  C.send({ t: 'rcreate', name: '쿠나이 시험', mode: 'ffa', bots: false, lo: null });
  const wc = await C.waitFor('welcome');
  D.send({ t: 'rjoin', code: wc.room.code }); await D.waitFor('welcome');
  check(wc.lo[0].id === 'kunai', '듀얼 쿠나이를 들고 방에 들어간다');
  // 부활 보호가 끝날 때까지 (서버 상태로 확인 — 부하가 있으면 늦어질 수 있다)
  const unprotected = async X => { for (let i = 0; i < 80; i++) { const m = lastMe(X); if (m && m.alive && m.ps.st.protect <= 0) return true; await sleep(100); } return false; };
  await sleep(3000); await unprotected(D);
  const vt = () => C.all('snap').pop().n;
  const hold = (n, o) => Array.from({ length: n }, () => cmd({ ...o, vt: vt() }));

  console.log('[직접 명중 (서버 판정)]');
  C.send({ t: 'tp', p: [-46, 0, 2], y: 0 }); D.send({ t: 'tp', p: [-46, 0, -10], y: N }); await sleep(250);
  let body = null;
  for (let tries = 0; tries < 3 && !body; tries++) { // 회수가 끝난 왼손으로 다시 (부하로 한 번 빗나가도)
    await C.play([...hold(6, { pitch: -0.05 }), cmd({ pitch: -0.05, btn: BTN.fire, vt: vt() }), ...hold(30, { pitch: -0.05 })]);
    body = await C.waitEvent('dmg', e => e.to === D.me && e.from === C.me, 2000);
    if (!body) await C.play([cmd({ btn: BTN.reload }), ...hold(60, {})]);
  }
  check(body && body.d === 45 && body.k === 'normal', `몸에 맞으면 45 (${body && body.d})`);
  await sleep(500);
  const back = lastMe(C).ps.ku[0];
  check(back.s === KS.RETURN || back.s === KS.COOL || back.s === KS.READY, '처치 못 하면 맞은 자리에서 돌아온다');
  await C.play([...hold(4, { pitch: 0.003 }), cmd({ pitch: 0.003, btn: BTN.ads, vt: vt() }), ...hold(8, { pitch: 0.003 })]);
  const kill = await C.waitEvent('kill', e => e.v === D.me && e.k === C.me, 3000);
  check(kill && kill.how === 'head', `머리 110 → 남은 체력 105 처치 (${kill && kill.how})`);
  await sleep(150);
  check(lastMe(C).ps.ku[1].s === KS.READY, '처치하면 그 쿠나이가 바로 손에 돌아온다 (제트 궁처럼 이어 던지기)');

  console.log('[와이어 감지 · 느려짐 · 끊기]');
  await D.waitEvent('spawn', e => e.id === D.me, 3000); await sleep(3000); await unprotected(D);
  C.send({ t: 'tp', p: [-46, 0, -14], y: Wd }); D.send({ t: 'tp', p: [-46, 0, -4], y: N }); await sleep(250);
  await C.play([cmd({ yaw: Wd, pitch: -0.16, btn: BTN.fire, vt: vt() }), ...hold(10, { yaw: Wd, pitch: -0.16 }),
    cmd({ yaw: E, pitch: -0.16, btn: BTN.ads, vt: vt() }), ...hold(10, { yaw: E, pitch: -0.16 }),
    cmd({ btn: BTN.mode }), cmd(), cmd({ btn: BTN.sk1 }), cmd()]);
  await sleep(200);
  const st = lastMe(C).ps;
  check(st.kmode === 1 && st.wires.length === 1 && st.wires[0].t > 7 && st.ku.every(k => k.s === KS.ANCHOR), '설치 모드 + 스킬 키 → 와이어 (서버 상태)');
  check(!!await D.waitEvent('ku', e => e.id === C.me && e.w.length === 1, 2000), '다른 사람에게도 와이어가 보인다 (ku 사건)');
  C.send({ t: 'tp', p: [-46, 0, -21], y: N }); D.send({ t: 'tp', p: [-46, 0, -9], y: 0 }); await sleep(150);
  await D.play(Array.from({ length: 90 }, () => cmd({ fwd: 1, yaw: 0 }))); // D 가 남쪽으로 와이어를 지나간다
  const trip = await C.waitEvent('wtrip', e => e.id === D.me, 2000);
  check(!!trip, '적이 와이어를 지나가면 설치자에게 알리고 위치를 보낸다');
  check(!!await D.waitEvent('wslow', () => true, 1000), '지나간 적은 잠깐 느려진다');
  // D 가 북쪽에서 와이어를 쏴서 끊는다
  const wy = (st.ku[0].y + st.ku[1].y) / 2, wz = st.ku[0].z;
  D.send({ t: 'tp', p: [-46, 0, wz + 6], y: 0 }); await sleep(250);
  const pitch = Math.atan2(wy - 1.52, 6);
  await D.play([...Array.from({ length: 30 }, () => cmd({ yaw: 0, pitch, btn: BTN.ads })), cmd({ yaw: 0, pitch, btn: BTN.ads | BTN.fire }), ...Array.from({ length: 6 }, () => cmd({ yaw: 0, pitch, btn: BTN.ads }))]);
  check(!!await C.waitEvent('wcut', e => e.id === C.me, 2000), '총알이 와이어에 닿으면 끊긴다');

  console.log('[W9 영역 진입 · 이탈 (서버 판정)]');
  C.send({ t: 'tp', p: [-46, 0, -14], y: Wd }); D.send({ t: 'tp', p: [-46, 0, -3], y: N }); await sleep(250);
  await C.play([cmd({ btn: BTN.reload }), ...hold(40, {}),
    cmd({ yaw: Wd, pitch: -0.16, btn: BTN.fire, vt: vt() }), ...hold(10, { yaw: Wd, pitch: -0.16 }),
    cmd({ yaw: E, pitch: -0.16, btn: BTN.ads, vt: vt() }), ...hold(10, { yaw: E, pitch: -0.16 }),
    cmd({ yaw: N, pitch: Math.atan2(-1.52, 6), btn: BTN.node }), cmd({ yaw: N }), cmd({ btn: BTN.sk1 }), cmd(), ...hold(6, {})]);
  await sleep(200);
  const ar = lastMe(C).ps;
  check(ar.area && ar.area.n.length === 3 && ar.wires.length === 3, `쿠나이 2 + 핀 1 → 삼각 영역 (서버 상태)`);
  check(!!await D.waitEvent('ku', e => e.id === C.me && e.w.length === 3 && Array.isArray(e.ar), 2000), '다른 사람에게 노드·선분·영역이 간다 (ku 사건)');
  C.send({ t: 'tp', p: [-46, 0, -24], y: N }); await sleep(150);
  await D.play(Array.from({ length: 200 }, () => cmd({ fwd: 1, yaw: 0 }))); // D 가 북쪽에서 남쪽으로 영역을 가로지른다 (z −3 → 약 −19, 영역은 z −8 ~ −14)
  const ent = await C.waitEvent('aenter', e => e.id === D.me, 2000);
  check(!!ent && ent.p[2] < -7.5 && ent.p[2] > -14.5, `적이 영역에 들어오면 설치자에게 알리고 위치를 보낸다 (z ${ent && ent.p[2]})`);
  check(!!await C.waitEvent('aexit', e => e.id === D.me, 2000), '나가면 나갔다고 알린다');
  check(C.events('aenter', e => e.id === D.me).length === 1, '안에 있는 동안 계속 알리지 않는다 (들어올 때 한 번)');
  await C.play([cmd({ btn: BTN.reload }), ...hold(40, {})]);

  console.log('[W6 기동 중 부딪힘 공격]');
  await C.play([cmd({ btn: BTN.reload }), ...hold(40, {}), cmd({ btn: BTN.mode }), cmd()]);
  C.send({ t: 'tp', p: [-46, 0, 8], y: N }); D.send({ t: 'tp', p: [-46, 0, 17], y: 0 }); await sleep(250);
  await C.play([cmd({ yaw: N, pitch: 0.06, btn: BTN.fire, vt: vt() }), ...hold(36, { yaw: N, pitch: 0.06 })]);
  const anc = lastMe(C).ps.ku[0];
  check(anc.s === KS.ANCHOR, `멀리 박는다 (z ${anc.z.toFixed(1)})`);
  await C.play([cmd({ yaw: N, btn: BTN.sk1, vt: vt() }), ...hold(60, { yaw: N })]);
  const dash = await C.waitEvent('kdash', e => e.id === C.me && e.v === D.me, 3000);
  const dd = await C.waitEvent('dmg', e => e.to === D.me && e.from === C.me && e.d === KUNAI.dash.dmg, 1000);
  check(!!dash && !!dd, `끌려가다 적과 부딪히면 피해 ${KUNAI.dash.dmg} + 밀어냄, 기동은 거기서 끝`);
  C.close(); D.close();
} catch (e) { console.error(e); check(false, '서버 테스트 중 오류', e.message); }
finally { for (const s of servers) s.stop(); }
process.exit(failed() ? 1 : 0);
