// 채팅 규칙: 글자 정리와 도배 방지 (순수 함수라 따로 테스트하기 쉽다)
import { CHAT_MAX_LEN } from '../shared/constants.js';

const WINDOW_MS = 5000;     // 이 시간 안에
const MAX_IN_WINDOW = 4;    // 최대 이만큼
const MIN_GAP_MS = 400;     // 연속 전송 최소 간격

// 제어문자/줄바꿈/연속 공백을 정리하고 길이를 자른다. 보낼 게 없으면 null.
export function sanitizeChat(text) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
  return clean || null;
}

// 도배 방지. 허용되면 전송 기록을 남기고 true.
export function allowChat(player, now) {
  const times = (player.chatTimes || []).filter(t => now - t < WINDOW_MS);
  player.chatTimes = times;
  if (times.length >= MAX_IN_WINDOW) return false;
  if (times.length && now - times[times.length - 1] < MIN_GAP_MS) return false;
  times.push(now);
  return true;
}
