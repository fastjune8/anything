// 서버 통합 테스트 (실제 서버 + WebSocket 클라이언트, 약 1분)
//   계정 · 친구 · 파티 · 채팅 · 빠른 매칭 · 커스텀 방(비밀번호) · 서버 권한 이동(속도 핵 차단) ·
//   서버 판정 사격 · 부활 보호 · 처치·자동 부활 · 랙 보정(되감기) · 봇 교전 · 점령전 승리 → 결과 → 재매치/로비
import { check, failed, startServer, connect, sleep } from './helpers.mjs';
import { BTN } from '../shared/sim/config.js';

const servers = [];
const cmd = (o = {}) => [o.fwd || 0, o.side || 0, o.btn || 0, o.yaw || 0, o.pitch || 0, o.slot || 0, o.vt || 0];
const lastMe = c => c.all('me').pop();
// 두 사람이 서로 마주 보게: a 는 (0, z0) 에서 −z 를, b 는 (0, z0 − d) 에 선다
async function face(a, b, z0, d) { // 동쪽 가장자리 길 (x = 50): 사이에 막는 물체가 없다
  a.send({ t: 'tp', p: [50, 0, z0], y: 0 }); b.send({ t: 'tp', p: [50, 0, z0 - d], y: Math.PI });
  await sleep(150);
}

try {
  const S = await startServer({ RESPAWN_SECONDS: '1', BOT_FILL: '0' }); servers.push(S);
  console.log('[계정 · 친구 · 파티 · 채팅]');
  const A = await connect(S.port, '알파').ready(), B = await connect(S.port, '브라보').ready();
  check(A.acc && A.acc.level === 1 && /^\d{4}$/.test(A.acc.tag) && A.find('hi').token, '손님 계정: 레벨 1, 친구 코드(이름#숫자), 토큰');
  const tok = A.find('hi').token, id = A.acc.id;
  A.close(); await sleep(150);
  const A2 = await connect(S.port, '아무거나', tok).ready();
  check(A2.acc.id === id && A2.acc.name === '알파', '같은 토큰으로 다시 들어오면 같은 계정');
  A2.send({ t: 'fr+', tag: `브라보#${B.acc.tag}` });
  const req = await B.waitFor('friends', m => m.inc.some(f => f.id === id));
  check(!!req, '친구 요청이 상대에게 간다');
  B.send({ t: 'fra', id, ok: true });
  const fl = await A2.waitFor('friends', m => m.list.some(f => f.id === B.acc.id && f.status === 'lobby'));
  check(!!fl, '수락하면 친구 목록에 접속 상태와 함께 보인다');
  A2.send({ t: 'pinv', id: B.acc.id });
  const inv = await B.waitFor('pinv');
  B.send({ t: 'pjoin', party: inv.party });
  const party = await A2.waitFor('party', m => m.party && m.party.members.length === 2);
  check(!!party && party.party.leader === id, '파티 초대 → 참가 → 파티장 포함 2명');
  B.send({ t: 'chat', ch: 'party', text: '파티 채팅' });
  check(!!await A2.waitFor('chat', m => m.ch === 'party' && m.text === '파티 채팅'), '파티 채팅');
  A2.send({ t: 'chat', ch: 'lobby', text: '로비 채팅' });
  check(!!await B.waitFor('chat', m => m.ch === 'lobby' && m.text === '로비 채팅'), '로비 채팅');
  B.send({ t: 'qm', mode: 'dom' });
  check(!!B.find('note', m => /파티장/.test(m.text)) || !!await B.waitFor('note', m => /파티장/.test(m.text), 1000), '파티원은 매칭을 시작할 수 없다 (파티장만)');
  A2.send({ t: 'qm', mode: 'dom' });
  const wa = await A2.waitFor('welcome'), wb = await B.waitFor('welcome');
  check(wa && wb && wa.team === wb.team && wa.mode === 'dom', '파티 빠른 매칭: 같은 방 · 같은 팀');
  const fs = await A2.waitFor('friends', m => m.list.some(f => f.status === 'match:dom'));
  check(!!fs, '친구 상태: 경기 중');

  console.log('[서버 권한 이동]');
  await sleep(300);
  A2.send({ t: 'tp', p: [50, 0, -30], y: Math.PI }); await sleep(100);
  await A2.play(Array.from({ length: 60 }, () => cmd({ fwd: 1, yaw: Math.PI })));
  await sleep(200);
  const m1 = lastMe(A2);
  check(m1 && m1.q === 59, '서버가 입력 번호를 확인해 준다 (보정용)');
  const moved = Math.hypot(m1.ps.x - 50, m1.ps.z + 30);
  check(moved > 3 && moved < 5.2, `1초 걷기 → ${moved.toFixed(2)}m (서버 계산)`);
  const before = lastMe(A2).ps;
  A2.cmds(Array.from({ length: 600 }, () => cmd({ fwd: 1, btn: BTN.sprint })));
  await sleep(300);
  const after = lastMe(A2).ps, jump = Math.hypot(after.x - before.x, after.z - before.z);
  check(jump < 5, `10초 분량 입력을 한꺼번에 보내도 실제 시간만큼만 움직인다 (${jump.toFixed(2)}m) — 속도 핵 차단`);
  A2.send({ t: 'leave' }); B.send({ t: 'leave' });
  check(!!await A2.waitFor('lobby'), '방에서 나가면 로비로');

  console.log('[커스텀 방 · 비밀번호]');
  const C = await connect(S.port, '찰리').ready(), D = await connect(S.port, '델타').ready();
  C.send({ t: 'rcreate', name: '시험방', mode: 'ffa', pass: '1234', bots: false, lo: null });
  const wc = await C.waitFor('welcome');
  check(wc && wc.room && wc.room.locked && wc.players.length === 1, '비밀번호 방 만들기 (봇 없음)');
  D.send({ t: 'rjoin', code: wc.room.code, pass: '0000' });
  check(!!await D.waitFor('denied', m => m.reason === 'password'), '비밀번호가 틀리면 못 들어간다');
  D.send({ t: 'lo', loadout: [{ id: 'awm', skill: 'caliber' }, { id: 'ar', skill: 'dash' }] });
  await D.waitFor('lo');
  D.send({ t: 'rjoin', code: wc.room.code, pass: '1234' });
  const wd = await D.waitFor('welcome');
  check(!!wd && wd.lo[0].id === 'awm', '맞으면 들어간다 (로비에서 고른 출전 무기로)');

  console.log('[사격 판정 · 부활 보호 · 처치 · 부활]');
  C.send({ t: 'lo' }); // (경기 중 lo 는 방에 영향 없음)
  await face(C, D, 32, 12);
  // C 가 D 를 쏜다: D 는 아직 부활 보호 중 → 막힌다
  const n0 = C.all('snap').pop().n;
  await C.play([...Array.from({ length: 40 }, () => cmd({ btn: BTN.ads, vt: n0 })), cmd({ btn: BTN.ads | BTN.fire, vt: n0 + 40 })]);
  const blk = await C.waitEvent('blk', e => e.id === D.me, 2000);
  check(!!blk, '부활 보호 중인 적은 피해를 받지 않는다');
  await sleep(3200); // 보호 시간이 끝난다
  const fire = async (n) => { const t = C.all('snap').pop().n; await C.play([cmd({ btn: BTN.ads, vt: t }), ...Array.from({ length: n }, (_, i) => cmd({ btn: BTN.ads | (i % 8 === 0 ? BTN.fire : 0), vt: t + i }))]); };
  await face(C, D, 32, 12);
  await fire(60);
  const dmg = await C.waitEvent('dmg', e => e.to === D.me && e.from === C.me, 3000);
  check(!!dmg && dmg.d > 0, `서버가 판정한 명중: 피해 ${dmg && dmg.d} (${dmg && dmg.k})`);
  const kill = await C.waitEvent('kill', e => e.v === D.me, 4000) || (await fire(120), await C.waitEvent('kill', e => e.v === D.me, 4000));
  check(!!kill && kill.k === C.me && ['head', 'normal'].includes(kill.how), `처치: 킬피드 정보 (처치자·사망자·유형 ${kill && kill.how})`);
  const respawn = await D.waitEvent('spawn', e => e.id === D.me && D.events('kill', k => k.v === D.me).length > 0, 3000);
  check(!!respawn, '사망 후 정해진 시간이 지나면 자동 부활');

  console.log('[랙 보정: 쏜 사람이 보던 순간으로 되감는다]');
  await sleep(3200);
  // D 가 옆으로 달린다. C 는 0.15초 전(9 tick) D 가 있던 곳을 쏘고, 그때 화면 시각(vt)을 붙인다
  C.send({ t: 'tp', p: [50, 0, 32], y: 0 }); D.send({ t: 'tp', p: [47, 0, 22], y: -Math.PI / 2 });
  await sleep(200);
  const hp0 = (D.all('me').pop() || {}).hp;
  await D.play(Array.from({ length: 50 }, () => cmd({ side: 0, fwd: 1, yaw: -Math.PI / 2 })));
  const snaps = C.all('snap').slice(-20);
  const pick = snaps[Math.max(0, snaps.length - 8)], row = pick && pick.p.find(r => r[0] === D.me);
  if (row) {
    const [, x, y, z] = row, ex = 50, ey = 1.52, ez = 32;
    const yaw = Math.atan2(-(x - ex), -(z - ez)), pitch = Math.atan2(y + 1.1 - ey, Math.hypot(x - ex, z - ez));
    await C.play([...Array.from({ length: 20 }, () => cmd({ yaw, pitch, btn: BTN.ads, vt: pick.n })), cmd({ yaw, pitch, btn: BTN.ads | BTN.fire, vt: pick.n })]);
    const hit = await C.waitEvent('dmg', e => e.to === D.me && e.hp < (hp0 ?? 150) && C.events('kill', k => k.v === D.me).length < 2, 2000);
    check(!!hit, '움직이는 적을 "보던 위치" 로 쏘면 맞는다 (되감기 판정)');
  } else check(false, '랙 보정 시험용 스냅샷이 없다');

  console.log('[봇]');
  const E = await connect(S.port, '에코').ready();
  const S2 = await startServer({}); servers.push(S2);
  const F = await connect(S2.port, '폭스트롯').ready();
  F.send({ t: 'qm', mode: 'tdm' });
  const wf = await F.waitFor('welcome');
  await sleep(7000);
  const pj = F.events('pj').length, shots = F.events('shot').length, dm = F.events('dmg').length;
  check(wf && pj >= 9, `봇이 빈자리를 채운다 (${pj}명)`);
  check(shots > 20 && dm > 0, `봇이 사람과 같은 규칙으로 싸운다 (사격 ${shots}, 피해 ${dm})`);
  check(F.events('snd').length > 0, `적의 소리가 방향 정보로 온다 (${F.events('snd').length}개, 위치 좌표 없음)`);
  check(F.events('snd').every(s => !('x' in s) && !('z' in s)), '소리 정보에는 적의 좌표가 없다');
  E.close();

  console.log('[점령전 승리 · 결과 · 재매치/로비]');
  const S3 = await startServer({ GOAL: '1', VICTORY_SECONDS: '1', RESULTS_SECONDS: '2', BOT_FILL: '0' }); servers.push(S3);
  const G = await connect(S3.port, '골프').ready(), H = await connect(S3.port, '호텔').ready();
  G.send({ t: 'rcreate', name: '점령 시험', mode: 'dom', bots: false });
  const wg = await G.waitFor('welcome');
  check(wg.dom && wg.dom.zones.length === 3 && wg.dom.pts.every(p => p[0] === -1), '점령전: 거점 3개, 모두 중립으로 시작');
  H.send({ t: 'rjoin', code: wg.room.code });
  const wh = await H.waitFor('welcome');
  check(wh.team !== wg.team, '두 번째 사람은 다른 팀');
  const za = wg.dom.zones[0];
  G.send({ t: 'tp', p: [za[2], 0, za[3]], y: 0 });
  const cap = await G.waitEvent('cap', e => e.z === 0, 11000);
  check(!!cap && cap.team === wg.team, `혼자 서 있으면 ${8}초 뒤 점령`);
  const end = await G.waitFor('end', () => true, 8000);
  check(!!end && end.wt === wg.team && end.sc[wg.team] >= 1, '거점 점수가 목표에 닿으면 승리');
  check(end && end.me.result === 'win' && end.me.xp > 0 && end.me.profile.stats.wins === 1, `결과: 경험치 +${end && end.me.xp}, 전적에 승리 기록`);
  const he = await H.waitFor('end');
  check(he && he.me.result === 'loss' && he.board.length === 2, '진 쪽: 패배, 결과표에 양 팀');
  G.send({ t: 'rematch', v: true });
  const restart = await G.waitFor('start', () => true, 6000), back = await H.waitFor('lobby', () => true, 6000);
  check(!!restart, '재매치를 고른 사람은 같은 방에서 새 경기');
  check(!!back, '고르지 않은 사람은 로비로 (개인별 선택)');
  for (const c of [A2, B, C, D, F, G, H]) c.close();
} catch (e) {
  console.error(e); check(false, '예외', e.message);
} finally {
  for (const s of servers) s.stop();
}
process.exit(failed() ? 1 : 0);
