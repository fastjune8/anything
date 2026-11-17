// 단위 테스트: 서버를 띄우지 않고 순수 함수만 검사 (1초 이내)
import { sanitizeChat, allowChat } from '../server/chat.js';
import { resolveHits } from '../server/combat.js';
import { calcDamage, WEAPONS } from '../shared/weapons.js';
import { check, failed } from './helpers.mjs';

console.log('[채팅 규칙: sanitizeChat]');
check(sanitizeChat('  안녕  ') === '안녕', '앞뒤 공백을 지운다');
check(sanitizeChat('a\u0000b\nc\u0007d   e') === 'a b c d e', '제어문자/줄바꿈/연속 공백을 한 칸으로 정리한다');
check(sanitizeChat('x'.repeat(300)).length === 120, '120자로 자른다');
check(sanitizeChat('   ') === null && sanitizeChat('') === null, '빈 메시지는 null');
check(sanitizeChat(123) === null && sanitizeChat(undefined) === null && sanitizeChat({}) === null, '문자열이 아니면 null');
check(sanitizeChat('<script>alert(1)</script>') === '<script>alert(1)</script>', 'HTML 은 바꾸지 않는다 (표시 쪽에서 textContent 로 처리)');

console.log('\n[채팅 규칙: allowChat 도배 방지]');
{
  const p = {};
  check(allowChat(p, 1000) === true, '첫 메시지는 허용');
  check(allowChat(p, 1200) === false, '400ms 안의 연속 메시지는 거부');
  check(allowChat(p, 1450) === true, '400ms 이후는 허용');
  check(allowChat(p, 1900) === true && allowChat(p, 2400) === true, '5초 안에 4개까지');
  check(allowChat(p, 2900) === false, '5초 안에 5번째는 거부');
  check(allowChat(p, 6100) === true, '창(5초)이 지나면 다시 허용');
}

console.log('\n[명중 검증: resolveHits]');
{
  const awm = WEAPONS.findIndex(w => w.id === 'awm');
  const m870 = WEAPONS.findIndex(w => w.id === 'm870');
  const me = { alive: true }, foe = { alive: true }, foe2 = { alive: true }, dead = { alive: false };
  const players = new Map([[0, me], [1, foe], [2, foe2], [3, dead]]);

  check(resolveHits(players, me, { w: 999, hits: [] }) === null, '없는 무기 번호는 null');
  check(resolveHits(players, me, { w: awm, hits: 'x' }) === null, 'hits 가 배열이 아니면 null');

  const head = resolveHits(players, me, { w: awm, hits: [['head', 20, 1]] });
  check(head && head.damages.length === 1 && head.damages[0].victim === foe && head.damages[0].head === true, '헤드샷은 대상과 head 표시를 돌려준다');
  check(head && head.damages[0].dmg === Math.round(calcDamage(awm, 'head', 20)), '피해량은 shared/weapons.js 의 calcDamage 와 같다');

  check(resolveHits(players, me, { w: awm, hits: [['body', 5, 0]] }).damages.length === 0, '자기 자신은 맞힐 수 없다');
  check(resolveHits(players, me, { w: awm, hits: [['body', 5, 3]] }).damages.length === 0, '죽은 상대는 맞힐 수 없다');
  check(resolveHits(players, me, { w: awm, hits: [['body', 5, 99]] }).damages.length === 0, '없는 대상 id 는 무시한다');
  check(resolveHits(players, me, { w: m870, hits: [null, 5, 'abc', ['body', 5, 1]] }).damages.length === 1, '형식이 깨진 항목은 건너뛰고 나머지를 처리한다');

  const near = resolveHits(players, me, { w: awm, hits: [['body', -50, 1]] }).damages[0].dmg;
  const base = Math.round(calcDamage(awm, 'body', 0));
  check(near === base, '음수 거리는 0 으로 처리한다');
  const far = resolveHits(players, me, { w: awm, hits: [['body', 99999, 1]] }).damages[0].dmg;
  check(far === Math.round(calcDamage(awm, 'body', 400)), '거리는 400m 로 제한한다');

  const shotgun = WEAPONS[m870];
  const many = resolveHits(players, me, { w: m870, hits: Array.from({ length: 30 }, () => ['body', 3, 1]) });
  check(many.damages[0].dmg === Math.round(shotgun.pellets * calcDamage(m870, 'body', 3)), `한 번에 보낼 수 있는 탄환 수는 무기 한도(${shotgun.pellets}발)까지만 인정한다`);

  const two = resolveHits(players, me, { w: m870, hits: [['body', 3, 1], ['body', 3, 2], ['body', 3, 1]] });
  check(two.damages.length === 2, '여러 대상을 맞히면 대상별로 합산한다');
  const unknownPart = resolveHits(players, me, { w: awm, hits: [['elbow', 5, 1]] }).damages[0];
  check(unknownPart.dmg === Math.round(calcDamage(awm, 'body', 5)) && !unknownPart.head, '알 수 없는 부위는 body 로 처리한다');
}

console.log('\n[총기 파츠: 성능과 트레이드오프]');
{
  const { SLOTS, PARTS, partsFor, applyParts, describePart, sanitizeParts, sanitizeLoadout } = await import('../shared/parts.js');
  const byId = id => WEAPONS.find(w => w.id === id);
  const m4 = byId('ar'), awmW = byId('awm'); // m4 = 기본 돌격소총 (예전 M4A1 자리)

  // 규칙: 어떤 파츠도 장점만 있거나 단점만 있으면 안 된다 (달 수 있는 모든 무기에서)
  const oneSided = [];
  let combos = 0;
  for (const w of WEAPONS) for (const s of SLOTS) for (const p of partsFor(w.id, s.id)) {
    combos++;
    const d = describePart(w, p);
    if (!d.pros.length || !d.cons.length) oneSided.push(`${w.name}+${p.name}`);
  }
  check(combos > 40 && oneSided.length === 0, `모든 파츠가 무기마다 장점과 단점을 함께 가진다 (${combos}가지 조합)`, oneSided.join(', '));
  check(SLOTS.length === 5 && SLOTS.every(s => PARTS[s.id].length >= 2), '자리 5곳(조준경·총열·손잡이·탄창·개머리판)마다 고를 파츠가 2개 이상 있다');
  check(WEAPONS.every(w => SLOTS.filter(s => partsFor(w.id, s.id).length).length >= 3), '모든 무기에 파츠를 달 수 있는 자리가 3곳 이상 있다');

  const before = JSON.stringify(m4);
  const ext = applyParts(m4, { mag: 'ext' });
  check(ext.mag === 40 && ext.reload > m4.reload && JSON.stringify(m4) === before, '확장 탄창: 30 → 40발, 재장전은 느려진다 (원본 무기 데이터는 바뀌지 않는다)');
  const sup = applyParts(m4, { barrel: 'suppressor' });
  check(sup.quiet === true && sup.falloff[0] < m4.falloff[0] && sup.snd.vol < m4.snd.vol && sup.dmg === m4.dmg, '소음기: 조용해지고 사거리가 줄어든다 (기본 피해는 그대로)');
  check(calcDamage(sup, 'body', 60) < calcDamage(m4, 'body', 60) && calcDamage(sup, 'body', 5) === calcDamage(m4, 'body', 5), '소음기를 단 총은 먼 거리 피해가 더 작고, 가까운 거리는 같다');
  check(applyParts(awmW, { barrel: 'suppressor' }).falloff === null, '거리별 피해 감소가 없는 무기는 사거리 파츠의 영향을 받지 않는다');
  const all = applyParts(m4, { optic: 'acog', barrel: 'comp', grip: 'vertical', mag: 'fast', stock: 'heavy' });
  check(all.adsFov < m4.adsFov && all.recoilV < m4.recoilV * 0.7 && all.mag === 25 && all.adsTime > m4.adsTime, '다섯 자리의 파츠가 함께 적용된다');
  check(applyParts(m4, { optic: 'scope_hi', grip: 'nope' }).adsFov === m4.adsFov, '달 수 없는 파츠·없는 파츠는 성능을 바꾸지 않는다');

  check(JSON.stringify(sanitizeParts('m9', { optic: 'acog', barrel: 'suppressor', stock: 'heavy', grip: 5, hack: 'x' })) === '{"barrel":"suppressor"}', 'sanitizeParts: 그 무기에 달 수 없는 것, 형식이 틀린 것은 버린다');
  const ids = lo => lo.map(l => l.id).join(',');
  check(ids(sanitizeLoadout(undefined)) === 'ar,m9' && ids(sanitizeLoadout('x')) === 'ar,m9' && ids(sanitizeLoadout([null, 7])) === 'ar,m9', 'sanitizeLoadout: 값이 없거나 깨졌으면 기본 무기(기본 돌격소총, M9)');
  check(ids(sanitizeLoadout([{ id: 'awm' }, { id: 'awm' }])) === 'awm,ar', '같은 무기를 두 번 넣으면 하나만 인정하고 기본 무기로 채운다');
  check(ids(sanitizeLoadout([{ id: 'm249' }, { id: 'mp5' }, { id: 'awm' }])) === 'm249,mp5', '무기는 2개까지만 들고 갈 수 있다');
  const lo = sanitizeLoadout([{ id: 'm249', parts: { mag: 'ext', optic: 'scope_hi' } }, { id: 'nothing' }]);
  check(lo[0].wi === WEAPONS.indexOf(byId('m249')) && JSON.stringify(lo[0].parts) === '{"mag":"ext"}' && lo[1].id === 'ar', '무기 번호(wi)와 정리된 파츠를 돌려주고, 없는 무기는 기본 무기로 바꾼다', JSON.stringify(lo));
  check(ids(sanitizeLoadout([{ id: 'm4' }, { id: 'ak' }])) === 'ar,m9' && !WEAPONS.some(w => w.id === 'm4' || w.id === 'ak'), 'M4A1·AK-47 은 기본 돌격소총으로 합쳐졌다 (예전에 저장한 출전 무기는 기본 돌격소총으로)');
  const sk = sanitizeLoadout([{ id: 'ar', skill: 'dash' }, { id: 'awm', skill: 'dash' }]);
  check(sk[0].skill === 'dash' && sk[1].skill === null, '스킬: 그 자리에서 고를 수 있는 것만 (돌격소총 1번 = 대쉬 OK, 스킬이 없는 무기는 null)', JSON.stringify(sk.map(l => l.skill)));
  const sk2 = sanitizeLoadout([{ id: 'm9' }, { id: 'ar', skill: 'nope' }]);
  check(sk2[1].skill === byId('ar').skills.secondary[0], '없는 스킬을 고르면 그 자리의 첫 번째 스킬로', sk2[1].skill);

  // 서버 명중 검증: 들고 온 무기로만 맞힐 수 있고, 파츠가 반영된 성능으로 계산한다
  const mi = WEAPONS.indexOf(m4), ai = WEAPONS.indexOf(awmW);
  const shooter = { alive: true, wstats: { [mi]: sup } }, foe = { alive: true };
  const players = new Map([[0, shooter], [1, foe]]);
  check(resolveHits(players, shooter, { w: ai, hits: [['head', 5, 1]] }) === null, '들고 오지 않은 무기의 명중 신고는 무효(null)');
  check(resolveHits(players, shooter, { w: mi, hits: [['body', 60, 1]] }).damages[0].dmg === Math.round(calcDamage(sup, 'body', 60)), '피해는 파츠가 반영된 성능으로 계산한다');
}

console.log('\n[무기 스킬: 대쉬 · 질주 · 과열 · 유탄]');
{
  const { advanceMovement, newMoveState, NO_INPUT, SPEED } = await import('../shared/movement.js');
  const { getSkill, skillsFor, newHeat, addHeat, coolHeat, heatMul, stepGrenade, splashDamage, blastReaches } = await import('../shared/skills.js');
  const { buildLayout } = await import('../shared/maps/build.js');
  const ar = WEAPONS.find(w => w.id === 'ar');
  check(['adrenaline', 'sprint', 'overheat', 'grenade', 'dash'].every(id => skillsFor(ar, 0).some(s => s.id === id) && skillsFor(ar, 1).some(s => s.id === id)), '기본 돌격소총은 주무기·보조무기 모두에서 스킬 5개를 고를 수 있다');
  const dash = getSkill('dash'), run = (s, i, sec) => { for (let t = 0; t < sec - 1e-9; t += 1 / 60) advanceMovement(s, i, [], 1 / 60); return s; };
  const d1 = newMoveState(); d1.yaw = Math.PI; // 앞 = +z
  run(d1, { ...NO_INPUT, dash: true, dashSkill: dash }, 1 / 60); run(d1, NO_INPUT, dash.dur + 0.02);
  check(Math.abs(d1.pos.z - dash.dist) < 0.6 && d1.dashCd > dash.cd - 0.5, `대쉬: 가만히 있으면 앞으로 약 ${dash.dist}m, 쿨타임이 걸린다`, `z ${d1.pos.z.toFixed(2)} cd ${d1.dashCd.toFixed(2)}`);
  const z0 = d1.pos.z; run(d1, { ...NO_INPUT, dash: true, dashSkill: dash }, 0.3);
  check(d1.pos.z - z0 < 1, '쿨타임 중에는 대쉬가 나가지 않는다');
  const d2 = newMoveState(); d2.yaw = Math.PI; run(d2, { ...NO_INPUT, side: 1, dash: true, dashSkill: dash }, 1 / 60); run(d2, NO_INPUT, dash.dur);
  check(Math.abs(d2.pos.x) > dash.dist * 0.8 && Math.abs(d2.pos.z) < 0.5, '움직이는 방향(옆)으로 대쉬한다', `x ${d2.pos.x.toFixed(2)}`);
  const air = (airSprint) => { const s = newMoveState(); s.yaw = Math.PI; run(s, { ...NO_INPUT, fwd: 1, sprint: true, speedMul: 1 }, 1); run(s, { ...NO_INPUT, fwd: 1, sprint: true, jump: true, speedMul: 1, airSprint }, 0.1); run(s, { ...NO_INPUT, fwd: 1, sprint: true, speedMul: 1, airSprint }, 0.3); return Math.hypot(s.vel.x, s.vel.z); };
  check(air(true) > SPEED.sprint - 0.1 && air(false) < air(true) - 0.3, '질주: 뛰어올라도 달리는 속도가 유지된다 (없으면 줄어든다)', `${air(true).toFixed(2)} / ${air(false).toFixed(2)}`);
  const oh = getSkill('overheat'), h = newHeat();
  let shots = 0; while (!h.over && shots < 200) { addHeat(h, oh); shots++; }
  check(shots === Math.ceil(1 / oh.heat) && heatMul(h, oh) === 1 + oh.bonus, `과열: ${shots}발 연사하면 과열, 그때 피해 +${Math.round(oh.bonus * 100)}%`);
  coolHeat(h, oh, 0.5);
  check(h.over && h.heat < 1, '과열되면 바로 다시 쏠 수 없다 (식는 중)');
  coolHeat(h, oh, 1 / oh.cool + 0.1);
  check(!h.over && h.heat === 0, '다 식으면 다시 쏠 수 있다');
  const h2 = newHeat(); addHeat(h2, oh); coolHeat(h2, oh, oh.coolDelay * 0.5);
  check(h2.heat === oh.heat, '쏘기를 멈추고 잠깐은 식지 않는다 (연사를 이어 가면 열이 쌓인다)');
  const gl = getSkill('grenade');
  const wall = buildLayout({ objects: [{ type: 'box', x: 0, y: 0, z: 10, w: 6, h: 4, d: 1, mat: 'concrete' }] }).colliders;
  const g = { p: { x: 0, y: 1.5, z: 0 }, v: { x: 0, y: 0, z: gl.speed }, t: 0 };
  while (!g.done) stepGrenade(g, 1 / 80, wall);
  check(Math.abs(g.p.z - 9.5) < 0.2, '유탄은 벽에 닿으면 그 자리에서 터진다', g.p.z.toFixed(2));
  const g2 = { p: { x: 0, y: 1.5, z: 0 }, v: { x: 0, y: 4, z: -gl.speed }, t: 0 };
  while (!g2.done) stepGrenade(g2, 1 / 80, wall);
  check(g2.p.y < 0.1 && g2.p.z < -10, '포물선으로 날아가 땅에 떨어지면 터진다', `z ${g2.p.z.toFixed(1)}`);
  check(splashDamage(gl, 0) === gl.dmg && splashDamage(gl, gl.radius * 0.5) < gl.dmg && splashDamage(gl, gl.radius + 0.1) === 0, '폭발 피해: 가운데가 가장 크고, 반경 밖은 0');
  check(!blastReaches({ x: 0, y: 1, z: 8 }, { x: 0, y: 1, z: 12 }, wall) && blastReaches({ x: 0, y: 1, z: 8 }, { x: 2, y: 1, z: 6 }, wall), '벽 너머에는 폭발 피해가 닿지 않는다');

  // 기본 산탄총: 차지 샷 · 밀어내기 · 밀려나기
  const { knockBack } = await import('../shared/movement.js');
  const sg = WEAPONS.find(w => w.id === 'm870');
  check(sg.name === '기본 산탄총' && ['charge', 'shove', 'kickback'].every(id => skillsFor(sg, 0).some(x => x.id === id) && skillsFor(sg, 1).some(x => x.id === id)), 'M870 은 "기본 산탄총" 이 되었고, 주무기·보조무기 모두에서 차지 샷 · 밀어내기 · 밀려나기를 고를 수 있다');
  const shove = getSkill('shove'), k = newMoveState(); k.yaw = 0;
  knockBack(k, 1, 0, shove.force, shove.stun);
  run(k, { ...NO_INPUT, fwd: 1, jump: true, speedMul: 1 }, shove.stun * 0.8);
  const atStun = { x: k.pos.x, z: k.pos.z, stun: k.stunT };
  check(atStun.x > 2 && Math.abs(atStun.z) < 0.05 && atStun.stun > 0, '밀어내기에 맞으면 밀려나고, 넘어진 동안은 앞으로 가려 해도 움직이지 못한다', JSON.stringify(atStun));
  run(k, { ...NO_INPUT, fwd: 1, speedMul: 1 }, 0.6);
  check(k.stunT === 0 && k.pos.z < atStun.z - 0.5, `${shove.stun}초 뒤에는 다시 움직일 수 있다`, k.pos.z.toFixed(2));
  const kb = getSkill('kickback'), kick = { force: kb.force, gap: 0.4 };
  const k1 = newMoveState(); k1.yaw = Math.PI; // 앞 = +z
  run(k1, { ...NO_INPUT, kick: true, kickSkill: kick, pitch: 0 }, 1 / 60); run(k1, NO_INPUT, 0.3);
  check(k1.pos.z < -0.6 && k1.onGround, '밀려나기: 앞으로 쏘면 뒤로 밀려난다', k1.pos.z.toFixed(2));
  const k2 = newMoveState(); k2.yaw = Math.PI;
  run(k2, { ...NO_INPUT, kick: true, kickSkill: kick, pitch: -1.4 }, 1 / 60); run(k2, NO_INPUT, 0.15);
  check(k2.pos.y > 0.4 && !k2.onGround, '아래를 보고 쏘면 위로 뜬다', k2.pos.y.toFixed(2));
  const k3 = newMoveState(); k3.yaw = Math.PI; k3.pos.y = 5; k3.onGround = false;
  run(k3, { ...NO_INPUT, kick: true, kickSkill: kick, pitch: 0 }, 1 / 60); run(k3, NO_INPUT, 0.2);
  check(k3.pos.z < -0.8, '공중에서도 밀려난다', k3.pos.z.toFixed(2));
  const k4 = newMoveState(); k4.yaw = Math.PI;
  run(k4, { ...NO_INPUT, kick: true, kickSkill: kick, pitch: 0 }, 0.2);
  check(Math.abs(k4.vel.z) < kb.force * 1.05, '연사 간격보다 빨리 밀려나기가 겹치지 않는다', k4.vel.z.toFixed(2));
}

console.log('\n[넘어가기 / 오르기: findVault]');
{
  const { findVault } = await import('../shared/vault.js');
  const { getMap } = await import('../shared/maps/index.js');
  const cs = getMap('frontline').layout.colliders;
  const opts = { radius: 0.35, standH: 1.75, crouchH: 1.2, minH: 0.45 };
  const N = { x: 0, z: 1 }; // +z 방향을 보고 있다
  const go = (x, z, c = cs, o = opts) => findVault(c, { x, y: 0, z }, N, o);

  const win = go(3, -7); // 중앙 폐허 남쪽 벽의 창문 (턱 1.0m, 위 2.0m 부터 벽)
  check(win && win.type === 'vault' && win.to[2] > -5.4 && win.to[1] === 0, '창문 앞에서: 창문을 넘어 건물 안쪽 바닥에 내려선다', JSON.stringify(win));
  check(win && win.duck < 1.0 && Math.abs(win.top - 1.0) < 1e-6, '창문을 지날 때는 틈(1.0m)보다 낮게 몸을 숙인다', win && `duck ${win.duck}`);
  check(go(0, -7) === null, '창문이 없는 벽 앞에서는 넘지 않는다 (그냥 점프)');
  const bags = go(0, -16); // 모래주머니 (높이 1.0, 두께 0.6)
  check(bags && bags.type === 'vault' && bags.to[2] >= -14.36 && bags.to[1] === 0, '모래주머니를 넘어 반대편에 내려선다', JSON.stringify(bags));
  const box = go(-1.2, 2.2); // 상자 (1.1m 정육면체)
  check(box && box.type === 'vault' && box.to[2] >= 4.39, '상자(1.1m)는 넘어간다', JSON.stringify(box));
  check(go(-16, -14) === null, '컨테이너(2.6m)처럼 높은 것은 넘지 못한다');
  check(go(30, 20) === null, '앞에 아무것도 없으면 null');

  const slab = [{ minX: -2, maxX: 2, minY: 0, maxY: 1, minZ: 0.8, maxZ: 5 }];
  const up = go(0, 0, slab);
  check(up && up.type === 'mantle' && up.to[1] === 1 && !up.crouch, '넓고 낮은 구조물(두께 4.2m)은 넘지 않고 위로 올라선다', JSON.stringify(up));
  const lowGap = [...slab.map(c => ({ ...c, maxZ: 1.1 })), { minX: -2, maxX: 2, minY: 1.5, maxY: 3, minZ: 0.8, maxZ: 1.1 }];
  check(go(0, 0, lowGap) === null, '위가 막혀 틈이 좁으면(0.5m) 넘지 않는다');
  const blocked = [{ minX: -2, maxX: 2, minY: 0, maxY: 1, minZ: 0.8, maxZ: 1.1 }, { minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: 1.3, maxZ: 1.6 }];
  check(go(0, 0, blocked) === null, '넘어갈 반대편이 벽으로 막혀 있으면 넘지 않는다');
  check(go(0, 0, [{ minX: -2, maxX: 2, minY: 0, maxY: 0.4, minZ: 0.6, maxZ: 1 }]) === null, '발목 높이 턱(0.4m)은 넘기 동작 없이 그냥 올라선다');
  const air = findVault(cs, { x: 0, y: 0.5, z: -16 }, N, { ...opts, minH: 0.1 });
  check(air && air.to[2] >= -14.36, '점프해 공중에 뜬 상태에서도 넘을 수 있다');
  check([win, bags, box, up].every(v => v.dur > 0.25 && v.dur <= 0.9), '넘는 데 걸리는 시간은 0.25~0.9초', [win, bags, box, up].map(v => v.dur.toFixed(2)).join(','));
}

console.log('\n[스폰 지점]');
{
  const { Room } = await import('../server/room.js');
  const { getMap, MAP_IDS } = await import('../shared/maps/index.js');
  const { navFor } = await import('../server/bots/nav.js');
  for (const id of MAP_IDS) {
    const map = getMap(id), nav = navFor(id), all = map.spawns.ffa;
    check(all.every(s => !nav.isBlocked(s[0], s[1])), `[${map.name}] 스폰 지점 ${all.length}곳이 모두 장애물과 겹치지 않는다`);
    check(all.every(s => nav.findPath(s[0], s[1], 0, 0)), `[${map.name}] 모든 스폰 지점에서 맵 중앙까지 길이 이어진다`);
    if (map.spawns.team) {
      const [t0, t1] = map.spawns.team;
      check(!!nav.findPath(t0[0][0], t0[0][1], t1[0][0], t1[0][1]), `[${map.name}] 양 팀 진영 사이에 길이 이어진다`);
      check(t0.length === t1.length && t0.every(([x, z], i) => x === -t1[i][0] && z === -t1[i][1]), `[${map.name}] 양 팀 스폰이 대칭이다 (조건이 같다)`);
    }
  }

  const room = new Room({ number: 1 });
  const p = room.newPlayer(0, 'me', null);
  const foe = room.newPlayer(1, 'foe', null); foe.alive = true; foe.pos = [0, 0, -54];
  room.players.set(0, p); room.players.set(1, foe);
  const seen = new Set(); let repeats = 0, tooClose = 0;
  for (let i = 0; i < 300; i++) {
    const s = room.pickSpawn(p);
    if (s === p.lastSpawn) repeats++;
    if (Math.hypot(s[0] - foe.pos[0], s[1] - foe.pos[2]) < 25) tooClose++;
    p.lastSpawn = s; seen.add(s);
  }
  room.destroy();
  check(seen.size >= 12, '태어나는 곳이 고르게 무작위다', `300번 중 ${seen.size}곳 사용`);
  check(repeats === 0, '직전에 태어난 곳에서 연달아 태어나지 않는다');
  check(tooClose === 0, '적과 25m 안쪽인 지점에서는 태어나지 않는다');
}

console.log('\n[미니맵 좌표]');
{
  const { toMini, inMini, enemyVisible } = await import('../client/js/minimath.js');
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  // 게임 규칙: yaw=0 이면 앞은 -z, 오른쪽은 +x
  const fwd = toMini(0, 0, 0, 0, -10, 2), right = toMini(0, 0, 0, 10, 0, 2);
  check(near(fwd.x, 0) && near(fwd.y, -20), '앞(-z)에 있는 사람은 미니맵 위쪽에 보인다', JSON.stringify(fwd));
  check(near(right.x, 20) && near(right.y, 0), '오른쪽(+x)에 있는 사람은 미니맵 오른쪽에 보인다', JSON.stringify(right));
  // yaw 를 돌리면 지도가 같이 돈다: 시선 방향 (-sin, -cos) 에 있는 점은 언제나 위쪽
  for (const yaw of [0.7, 2.1, -1.3, Math.PI]) {
    const ahead = toMini(5, -3, yaw, 5 - Math.sin(yaw) * 10, -3 - Math.cos(yaw) * 10, 1);
    const rightPt = toMini(5, -3, yaw, 5 + Math.cos(yaw) * 10, -3 - Math.sin(yaw) * 10, 1);
    check(near(ahead.x, 0) && near(ahead.y, -10) && near(rightPt.x, 10) && near(rightPt.y, 0), `시선(yaw=${yaw.toFixed(1)})이 어느 쪽이든 앞은 위, 오른쪽은 오른쪽이다`);
  }
  check(toMini(3, 4, 1.2, 3, 4, 5).x === 0 && toMini(3, 4, 1.2, 3, 4, 5).y === 0, '내 위치는 항상 가운데(0,0)다');
  check(inMini({ x: 30, y: 30 }, 85) && !inMini({ x: 80, y: 40 }, 85), '원 밖의 점은 그리지 않는다');
  check(enemyVisible(1000, 0, 2000) === true && enemyVisible(2500, 0, 2000) === false && enemyVisible(0, -1e9) === false, '적은 총을 쏜 뒤 2초 동안만 보이고, 한 번도 안 쐈으면 보이지 않는다');
}

console.log('\n[이동 물리: shared/movement.js]');
{
  const { stepMovement, advanceMovement, newMoveState, NO_INPUT, SPEED, BODY } = await import('../shared/movement.js');
  const box = (x0, x1, y0, y1, z0, z1) => ({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 });
  const run = (s, input, cs, sec, fps) => { for (let t = 0; t < sec - 1e-9; t += 1 / fps) advanceMovement(s, input, cs, 1 / fps); return s; };
  const fwd = { ...NO_INPUT, fwd: 1 };

  const a = run(newMoveState(), fwd, [], 2, 60);
  check(a.pos.z < -8 && a.pos.z > -SPEED.walk * 2 - 0.01 && Math.abs(a.pos.x) < 1e-9, '앞으로(yaw 0 = -z) 걷는다, 걷는 속도를 넘지 않는다', a.pos.z.toFixed(2));
  const slow = run(newMoveState(), fwd, [], 2, 4), fast = run(newMoveState(), fwd, [], 2, 120);
  check(Math.abs(slow.pos.z - fast.pos.z) < 0.15, '화면이 1초에 4장이어도 120장일 때와 같은 거리를 간다 (게임 시간이 늦게 흐르지 않는다)', `${slow.pos.z.toFixed(2)} vs ${fast.pos.z.toFixed(2)}`);

  const wall = [box(-5, 5, 0, 3, -2.2, -2)];
  const b = run(newMoveState(), fwd, wall, 2, 60);
  check(b.pos.z > -2 + BODY.RADIUS - 0.01 && b.pos.z < -1.5, '벽에 막힌다 (몸 반지름만큼 떨어져서)', b.pos.z.toFixed(2));
  const stair = [box(-5, 5, 0, 0.3, -10, -1)];
  const c = run(newMoveState(), fwd, stair, 1, 60);
  check(Math.abs(c.pos.y - 0.3) < 1e-6 && c.pos.z < -1.2, '낮은 턱(0.3m)은 걸어서 올라선다', `${c.pos.y} ${c.pos.z.toFixed(2)}`);

  const j = newMoveState(); let top = 0;
  stepMovement(j, { ...NO_INPUT, jump: true }, [], 1 / 60);
  for (let i = 0; i < 120; i++) { stepMovement(j, NO_INPUT, [], 1 / 60); top = Math.max(top, j.pos.y); }
  check(top > 0.9 && top < 1.2 && j.onGround && j.pos.y === 0, '점프는 1m 남짓 올라갔다 내려와 착지한다', top.toFixed(2));

  const win = [box(-3, 3, 0, 1.0, -1.3, -1.0), box(-3, 3, 2.0, 3, -1.3, -1.0)]; // 창문 (턱 1.0m, 위 2.0m)
  const v = newMoveState(); v.pos.z = -0.3;
  const ev = stepMovement(v, { ...NO_INPUT, fwd: 1, jump: true }, win, 1 / 60);
  check(ev.vaultStart && v.vault && v.vault.type === 'vault', '창문 앞에서 점프 키를 누르면 넘어가기가 시작된다');
  run(v, NO_INPUT, win, 1.2, 60);
  check(!v.vault && v.pos.z < -1.3, '넘어가기가 끝나면 창문 건너편에 있다', v.pos.z.toFixed(2));
}

console.log('\n[높이 요소: 경사로 · 계단 · 발판]');
{
  const { advanceMovement, newMoveState, NO_INPUT } = await import('../shared/movement.js');
  const { buildLayout, expandObject } = await import('../shared/maps/build.js');
  const { rayWorld } = await import('../shared/collision.js');
  const cs = objs => buildLayout({ objects: objs }).colliders;
  const walk = (s, input, c, sec) => { for (let t = 0; t < sec - 1e-9; t += 1 / 60) advanceMovement(s, input, c, 1 / 60); return s; };
  const fwd = { ...NO_INPUT, fwd: 1, speedMul: 1 };

  // 경사로: 북(z+)으로 6m 동안 3m 오른다. yaw = π → 앞 = +z
  const ramp = cs([{ type: 'ramp', x: 0, z: 5, y: 0, dir: 'n', len: 6, w: 3, h: 3, mat: 'concrete' }, { type: 'platform', x: 0, z: 11, y: 3, w: 3, d: 6, mat: 'concrete' }]);
  const up = newMoveState(); up.yaw = Math.PI;
  walk(up, fwd, ramp, 1.2);
  check(up.pos.z > 3 && up.pos.z < 8 && up.pos.y > 0.4 && up.pos.y < 3 && up.onGround, '경사로를 걸어 오르면 높이가 따라 올라간다 (땅에 붙은 채)', `z ${up.pos.z.toFixed(2)} y ${up.pos.y.toFixed(2)}`);
  const slope = (up.pos.y) / (up.pos.z - 2);
  check(Math.abs(slope - 0.5) < 0.12, '오른 높이가 경사(3m/6m)와 맞는다', slope.toFixed(2));
  walk(up, fwd, ramp, 1.5);
  check(Math.abs(up.pos.y - 3) < 0.01 && up.pos.z > 8, '끝까지 오르면 3m 발판 위에 선다', `z ${up.pos.z.toFixed(2)} y ${up.pos.y.toFixed(2)}`);
  const down = up; down.yaw = 0; // 뒤로 돌아 내려간다
  walk(down, fwd, ramp, 4);
  check(down.pos.y < 0.05 && down.onGround, '경사로를 걸어 내려오면 바닥까지 붙어서 내려온다', `y ${down.pos.y.toFixed(2)}`);

  // 계단: 같은 크기 → 0.3m 단 10개, 걸어 오른다
  const st = cs([{ type: 'stairs', x: 0, z: 5, y: 0, dir: 'n', len: 6, w: 2, h: 3, mat: 'concrete' }]);
  check(expandObject({ type: 'stairs', x: 0, z: 0, dir: 'n', len: 6, w: 2, h: 3 }).boxes.length === 10, '계단은 한 단 0.3m 이하로 나뉜다 (3m → 10단)');
  const s2 = newMoveState(); s2.yaw = Math.PI;
  walk(s2, fwd, st, 1.8);
  check(s2.pos.y > 2.6, '계단을 걸어 오른다', `y ${s2.pos.y.toFixed(2)}`);

  // 발판 아래는 지나갈 수 있고, 위에 선 사람은 떨어지지 않는다
  const pl = cs([{ type: 'platform', x: 0, z: 5, y: 3, w: 6, d: 6, pillars: true }]);
  const under = newMoveState(); under.yaw = Math.PI;
  walk(under, fwd, pl, 1);
  check(under.pos.z > 4 && under.pos.y === 0, '높은 발판 밑으로 지나갈 수 있다 (기둥 사이)', `z ${under.pos.z.toFixed(2)}`);
  const on = newMoveState({ x: 0, y: 3, z: 5 }); walk(on, NO_INPUT, pl, 0.5);
  check(Math.abs(on.pos.y - 3) < 0.01, '발판 위에 서 있으면 떨어지지 않는다');

  // 총알: 경사로 낮은 쪽 위의 공기는 지나가고, 경사면에 맞는다
  const lowAir = rayWorld({ x: 0, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, ramp, 30); // 높이 1m 로 북쪽으로
  check(Math.abs(lowAir.t - (5 + 2 + 2)) < 0.05, '높이 1m 로 쏘면 경사면(높이 1m 지점)에 맞는다 (상자 모양으로 막히지 않는다)', lowAir.t.toFixed(2));
  const over = rayWorld({ x: 0, y: 3.5, z: -5 }, { x: 0, y: 0, z: 1 }, cs([{ type: 'ramp', x: 0, z: 5, dir: 'n', len: 6, w: 3, h: 3 }]), 30);
  check(over.t === 30, '경사로보다 높이 쏘면 맞지 않는다');
  // 회전·대칭: 경사 방향도 같이 돈다
  const r90 = expandObject({ type: 'ramp', x: 0, z: 0, dir: 'n', len: 6, w: 3, h: 3, rot: 90 }).boxes[0].ramp;
  const mir = expandObject({ type: 'ramp', x: 2, z: 2, dir: 'e', len: 6, w: 3, h: 3, sym: true }).boxes[1].ramp;
  check(r90.axis === 'x' && r90.up === -1 && mir.axis === 'x' && mir.up === -1, '경사로를 돌리거나 대칭으로 놓으면 오르는 방향도 바뀐다', JSON.stringify({ r90, mir }));
  const lifted = expandObject({ type: 'wall', axis: 'x', at: 0, from: 0, to: 4, h: 2, y: 3 }).boxes[0];
  check(lifted.y === 3, '벽·건물 등에 바닥 높이(y)를 주면 그 높이에 놓인다 (2층 벽)');
}

console.log('\n[콘텐츠 데이터: 스키마 검사, 맵 펼치기, 저장 형식]');
{
  const fs = await import('node:fs');
  const { checkMap, checkWeapons, checkParts } = await import('../shared/content/schema.js');
  const { expandObject, buildLayout } = await import('../shared/maps/build.js');
  const { formatContent } = await import('../shared/content/format.js');
  const { MAP_IDS, getMap } = await import('../shared/maps/index.js');
  const { WEAPONS } = await import('../shared/weapons.js');
  const read = f => JSON.parse(fs.readFileSync(new URL(`../content/${f}`, import.meta.url), 'utf8'));
  for (const id of MAP_IDS) check(checkMap(read(`maps/${id}.json`)).length === 0, `content/maps/${id}.json 이 검사를 통과한다`);
  check(checkWeapons(read('weapons.json')).length === 0 && checkParts(read('parts.json'), WEAPONS.map(w => w.id)).length === 0, '무기·파츠 데이터가 검사를 통과한다');

  const good = { id: 'm', name: 'm', half: 20, spawns: { ffa: [[0, 0], [1, 1]] }, objects: [{ type: 'crate', x: 1, z: 1 }] };
  check(checkMap(good).length === 0, '(준비) 최소한의 맵은 통과');
  const errs = d => checkMap({ ...good, ...d }).join(' / ');
  check(errs({ objects: [{ type: 'ufo', x: 0, z: 0 }] }).includes('모르는 물체 종류'), '모르는 물체 종류를 잡아낸다');
  check(errs({ objects: [{ type: 'crate', x: 0 }] }).includes('objects[0].z'), '빠진 칸을 위치와 함께 알려 준다', errs({ objects: [{ type: 'crate', x: 0 }] }));
  check(errs({ objects: [{ type: 'box', x: 0, z: 0, w: 1, h: 1, d: 1, mat: 'gold' }] }).includes('고를 수 없는 값'), '없는 재질을 잡아낸다');
  check(errs({ objects: [{ type: 'crate', x: 0, z: 0, size: 3 }] }).includes('모르는 칸'), '오타 난 칸 이름을 잡아낸다');
  check(errs({ spawns: { ffa: [[0, 0], [50, 0]] } }).includes('맵 밖'), '맵 밖 스폰을 잡아낸다');

  const one = expandObject({ type: 'box', x: 3, y: 0, z: 1, w: 4, h: 1, d: 2, mat: 'concrete', rot: 90 }).boxes[0];
  check(one.x === 3 && one.z === 1 && one.w === 2 && one.d === 4, '90도 회전하면 너비와 깊이가 바뀐다 (중심은 그대로)', JSON.stringify(one));
  const sym = expandObject({ type: 'crate', x: 3, z: 5, s: 1, sym: true }).boxes;
  check(sym.length === 2 && sym[1].x === -3 && sym[1].z === -5, '대칭 물체는 맵 중심 반대편에 하나 더 생긴다');
  const tower = expandObject({ type: 'tower', x: 10, z: 0, rot: 180 }).boxes;
  const stairs = tower.filter(b => b.d === 1.2);
  check(stairs.length === 10 && stairs.every(b => b.x > 10), '감시탑을 180도 돌리면 계단이 반대쪽(동쪽)으로 간다');
  check(buildLayout(getMap('warehouse')).colliders.length === getMap('warehouse').layout.colliders.length, '맵 펼치기는 몇 번을 해도 같다');

  const data = read('maps/warehouse.json');
  check(formatContent(data) === fs.readFileSync(new URL('../content/maps/warehouse.json', import.meta.url), 'utf8'), '저장 형식은 안정적이다 (다시 써도 파일이 바뀌지 않는다)');
}

console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(failed() ? 1 : 0);
