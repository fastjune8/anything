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

console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(failed() ? 1 : 0);
