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

console.log('\n[스폰 지점]');
{
  const { Room } = await import('../server/room.js');
  const { SPAWNS } = await import('../shared/spawns.js');
  const { isBlocked, findPath } = await import('../server/bots/nav.js');
  check(SPAWNS.every(s => !isBlocked(s[0], s[1])), `스폰 지점 ${SPAWNS.length}곳이 모두 장애물과 겹치지 않는다`);
  check(SPAWNS.every(s => findPath(s[0], s[1], 0, 0)), '모든 스폰 지점에서 맵 중앙까지 길이 이어진다');

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

console.log('\n[마우스 튐 필터]');
{
  const { createMouseFilter } = await import('../client/js/mousefilter.js');
  const f = createMouseFilter();
  for (let i = 0; i < 30; i++) f.apply(4, -2);
  check(JSON.stringify(f.apply(5, 3)) === '[5,3]', '평소 움직임은 그대로 통과한다');
  check(f.apply(380, 0) === null, '천천히 움직이다 갑자기 튄 값(380px)은 버린다');
  check(JSON.stringify(f.apply(4, 1)) === '[4,1]', '튄 값 다음의 정상 움직임은 통과한다');

  const g = createMouseFilter();
  for (let i = 0; i < 10; i++) g.apply(3, 0);
  const flick = [20, 45, 80, 120, 150, 150, 120].map(v => g.apply(v, 0));
  check(flick.every(v => v !== null), '점점 빨라지는 실제 휘두르기는 버리지 않는다');

  const h = createMouseFilter();
  for (let i = 0; i < 10; i++) h.apply(2, 0);
  const sudden = [200, 200, 200].map(v => h.apply(v, 0));
  check(sudden[0] === null && sudden[1] !== null && sudden[2] !== null, '정지 상태에서 급히 휘두르면 첫 값 하나만 버리고 이어서 통과한다');

  const k = createMouseFilter();
  for (let i = 0; i < 20; i++) k.apply(200, 0);
  check(k.apply(600, 0)[0] === 250, '한 번에 인정하는 이동량은 250px 로 제한한다');

  const r = createMouseFilter(); r.reset();
  check(r.apply(50, 50) === null && r.apply(50, 50) === null && r.apply(5, 5) !== null, '마우스 잠금 직후 2개는 버린다');
}

console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(failed() ? 1 : 0);
